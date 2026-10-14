from conftest import MemoryClaims
from conftest import reviewed_state
"""The Ops service's /execute endpoint, attacked over HTTP. Whatever the caller sends, Cloud Run must not change unless a valid signed approval covers exactly this action."""
import time

import pytest
from starlette.applications import Starlette
from starlette.testclient import TestClient

from mobileops_agents.approval import sign_approval
from mobileops_agents.config import RegisteredService, Settings
from mobileops_agents.serve import execute_route
from mobileops_agents.tools import OpsTools, canonical_action

from conftest import SERVICE, service_state

KEY = b"approval-key-for-tests-0123456789"
SETTINGS = Settings(project="example-project", services=(RegisteredService("shop-api", "example-project", "asia-northeast3"),), approval_key=KEY)
BASE = f"/v2/{SERVICE.resource}"


@pytest.fixture
def endpoint(api):
    recorder, client = api
    recorder.add("GET", BASE + "/revisions", {"json": {"revisions": [{"name": f"{SERVICE.resource}/revisions/shop-api-good"}, {"name": f"{SERVICE.resource}/revisions/shop-api-bad"}]}})
    recorder.add("PATCH", BASE, {"json": {"name": "projects/p/locations/l/operations/o", "done": True, "response": {}}})
    recorder.add("GET", BASE, service_state("shop-api-good"))
    return TestClient(Starlette(routes=[execute_route(OpsTools(SETTINGS, client, claims=MemoryClaims()))])), recorder


def approval(service="shop-api", revision="shop-api-good", actor="reviewer-1", **kwargs):
    kwargs.setdefault("reviewed_state", reviewed_state())
    return sign_approval(KEY, canonical_action("rollback_traffic", service, revision), actor, **kwargs).to_dict()


def body(approval_value, service="shop-api", revision="shop-api-good", action="rollback_traffic"):
    return {"action": action, "service": service, "revision": revision, "approval": approval_value}


def changes(recorder):
    return [call for call in recorder.calls if call[0] in ("PATCH", "POST", "PUT", "DELETE")]


def test_a_valid_approval_applies_exactly_one_rollback_and_names_the_approver(endpoint):
    client, recorder = endpoint
    reply = client.post("/execute", json=body(approval()))
    assert reply.status_code == 200 and reply.json()["executed"] is True and reply.json()["status"] == "applied" and reply.json()["approved_by"] == "reviewer-1"
    assert len(changes(recorder)) == 1


@pytest.mark.parametrize("payload", [b"not json", b"[]", b'{"action":"rollback_traffic"}', b'{"service":"shop-api","revision":"shop-api-good"}'])
def test_malformed_requests_are_rejected_without_touching_cloud_run(endpoint, payload):
    client, recorder = endpoint
    assert client.post("/execute", content=payload, headers={"content-type": "application/json"}).status_code == 400
    assert recorder.calls == []


@pytest.mark.parametrize("action", ["delete_service", "set_iam_policy", "update_service", "ROLLBACK_TRAFFIC", ""])
def test_any_other_action_is_unsupported_even_with_a_valid_signature_for_it(endpoint, action):
    client, recorder = endpoint
    assert client.post("/execute", json=body(approval(), action=action)).status_code == 400
    assert recorder.calls == []


def test_missing_forged_expired_and_borrowed_approvals_change_nothing(endpoint):
    client, recorder = endpoint
    good = approval()
    cases = {
        "none": None, "empty": {}, "string": "approved", "wrong key": sign_approval(b"x" * 32, canonical_action("rollback_traffic", "shop-api", "shop-api-good"), "attacker", reviewed_state=reviewed_state()).to_dict(),
        "tampered actor": {**good, "actor": "someone-else"}, "tampered expiry": {**good, "expires_at": good["expires_at"] + 86400},
        "expired": approval(now=time.time() - 3600), "for another revision": approval(revision="shop-api-bad"), "for another service": approval(service="payments-prod"),
        "missing signature": {key: value for key, value in good.items() if key != "signature"},
    }
    for name, value in cases.items():
        reply = client.post("/execute", json=body(value))
        assert reply.status_code == 403 and reply.json()["executed"] is False, name
    assert changes(recorder) == []


def test_an_unregistered_service_is_refused_even_with_a_signature_for_it(endpoint):
    client, recorder = endpoint
    reply = client.post("/execute", json=body(approval(service="payments-prod"), service="payments-prod"))
    assert reply.status_code == 403 and reply.json()["executed"] is False
    assert changes(recorder) == []


def test_refusals_use_fixed_reasons_and_never_echo_the_caller_or_upstream(endpoint):
    client, _ = endpoint
    reply = client.post("/execute", json=body(None, revision="shop-api-good'; DROP TABLE x;--"))
    assert reply.status_code == 403 and "DROP" not in reply.text


def test_a_refusal_says_nothing_was_sent(endpoint):
    client, recorder = endpoint
    reply = client.post("/execute", json=body(None))
    assert reply.status_code == 403 and reply.json()["status"] == "refused" and reply.json()["change_sent"] is False


def test_an_approval_works_once_and_the_second_try_is_refused_without_a_second_change(endpoint):
    client, recorder = endpoint
    once = approval()
    assert client.post("/execute", json=body(once)).status_code == 200
    again = client.post("/execute", json=body(once))
    assert again.status_code == 403 and again.json()["status"] == "refused" and "already used" in again.json()["error"]
    assert len(changes(recorder)) == 1


def test_an_approval_is_refused_when_the_service_changed_after_it_was_issued(api):
    recorder, client = api
    recorder.add("GET", BASE + "/revisions", {"json": {"revisions": [{"name": f"{SERVICE.resource}/revisions/shop-api-good"}]}})
    recorder.add("GET", BASE, service_state("shop-api-new", update_time="2099-01-01T00:00:00Z"))  # someone deployed after the person approved
    recorder.add("PATCH", BASE, {"json": {"done": True}})
    route = TestClient(Starlette(routes=[execute_route(OpsTools(SETTINGS, client, claims=MemoryClaims()))]))
    reply = route.post("/execute", json=body(approval(now=time.time())))
    assert reply.status_code == 403 and "changed since the reviewed state" in reply.json()["error"] and reply.json()["change_sent"] is False
    assert changes(recorder) == []


def test_an_approval_window_longer_than_allowed_is_refused(endpoint):
    client, recorder = endpoint
    reply = client.post("/execute", json=body(approval(ttl_seconds=3600)))
    assert reply.status_code == 403 and changes(recorder) == []


def test_an_unfinished_change_is_reported_as_pending_not_as_a_refusal(api, monkeypatch):
    recorder, client = api
    recorder.add("GET", BASE + "/revisions", {"json": {"revisions": [{"name": f"{SERVICE.resource}/revisions/shop-api-good"}]}})
    recorder.add("GET", BASE, service_state("shop-api-bad"))
    recorder.add("PATCH", BASE, {"json": {"name": "projects/p/locations/l/operations/o", "done": False}})
    recorder.add("GET", "/v2/projects/p/locations/l/operations/o", {"json": {"done": False}})
    monkeypatch.setattr("mobileops_agents.gcp.cloud_run.asyncio.sleep", lambda _: _noop())
    route = TestClient(Starlette(routes=[execute_route(OpsTools(SETTINGS, client, claims=MemoryClaims()))]))
    reply = route.post("/execute", json=body(approval()))
    assert reply.status_code == 202 and reply.json()["status"] == "pending" and reply.json()["executed"] is False and reply.json()["change_sent"] is True
    assert len(changes(recorder)) == 1


async def _noop():
    return None
