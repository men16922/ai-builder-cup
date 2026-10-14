"""The fixed gateway claim broker fails closed, including ambiguous transport outcomes."""
import copy
import json

import httpx
import pytest

from conftest import MemoryClaims, SERVICE, reviewed_state, service_state
from mobileops_agents.approval import ApprovalError, sign_approval, verify_approval
from mobileops_agents.config import Settings
from mobileops_agents.execution_claims import ClaimError, DisabledExecutionClaims, GatewayExecutionClaims
from mobileops_agents.gcp.client import GoogleApiClient
from mobileops_agents.tools import OpsTools, canonical_action

KEY = b"synthetic-claim-broker-key-0123456789"
ACTION = canonical_action("rollback_traffic", SERVICE.name, "shop-api-good")
ORIGIN = "https://gateway.example.invalid"


def grant():
    return sign_approval(KEY, ACTION, "synthetic-reviewer", reviewed_state=reviewed_state())


async def test_fixed_broker_accepts_only_the_exact_boolean_ack_and_never_follows_a_redirect():
    calls = []

    async def handle(request):
        calls.append(request)
        assert str(request.url) == ORIGIN + "/api/gcp/crew/execution-claims"
        assert request.headers["Origin"] == ORIGIN
        assert request.headers["Authorization"] == "Bearer " + approved.signature
        assert json.loads(request.content) == {"approval": approved.to_dict()}
        return httpx.Response(200, json={"claimed": True})

    approved = grant()
    async with httpx.AsyncClient(transport=httpx.MockTransport(handle), follow_redirects=True) as client:
        claims = GatewayExecutionClaims(ORIGIN, client)
        await claims.claim(approved)
    assert len(calls) == 1


@pytest.mark.parametrize("status,body,expected", [
    (409, {}, "refused"), (400, {}, "refused"), (401, {}, "refused"), (403, {}, "refused"), (404, {}, "refused"),
    (500, {}, "unknown"), (202, {"claimed": True}, "unknown"), (200, {"claimed": 1}, "unknown"),
    (200, {"claimed": False}, "unknown"), (200, {"claimed": True, "extra": "ignored"}, "unknown"),
    (200, {"claimed": True, "padding": "x" * 8192}, "unknown"), (307, {}, "unknown"),
])
async def test_refused_or_ambiguous_claim_never_retries(status, body, expected):
    calls = []
    async def handle(request):
        calls.append(request)
        return httpx.Response(status, json=body, headers={"Location": "https://attacker.example.invalid"})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handle), follow_redirects=True) as client:
        with pytest.raises(ClaimError) as error:
            await GatewayExecutionClaims(ORIGIN, client).claim(grant())
    assert error.value.status == expected and len(calls) == 1


async def test_a_lost_claim_reply_is_unknown_and_dispatches_no_cloud_run_change():
    claims, google_calls = [], []
    async def broker(request):
        claims.append(request)
        raise httpx.ReadTimeout("synthetic reply lost after claim", request=request)
    async def google(request):
        google_calls.append(request)
        return httpx.Response(200, json=service_state("shop-api-bad")["json"])
    async with httpx.AsyncClient(transport=httpx.MockTransport(broker)) as client:
        tools = OpsTools(Settings(project=SERVICE.project, services=(SERVICE,), approval_key=KEY), GoogleApiClient(transport=httpx.MockTransport(google)), GatewayExecutionClaims(ORIGIN, client))
        result = await tools.execute_approved_rollback(SERVICE.name, "shop-api-good", grant().to_dict())
    assert result["status"] == "unknown" and result["change_sent"] is False
    assert len(claims) == 1 and [request.method for request in google_calls] == ["GET"]


async def test_an_absent_durable_broker_refuses_execution():
    with pytest.raises(ClaimError) as error:
        await DisabledExecutionClaims().claim(grant())
    assert error.value.status == "refused"


@pytest.mark.parametrize("origin", ["http://localhost", ORIGIN + "/", ORIGIN + "/path", ORIGIN + "?query", ORIGIN + "#fragment", "https://user:password@gateway.example.invalid", ORIGIN + ":8443"])
def test_broker_configuration_cannot_select_a_path_credential_or_insecure_origin(origin):
    with pytest.raises(ValueError):
        GatewayExecutionClaims(origin, None)


def test_the_reviewed_state_is_signed_and_legacy_approvals_are_refused():
    approved = grant().to_dict()
    for field, value in [("uid", "replacement-uid"), ("etag", "different-etag"), ("update_time", "2021-01-01T00:00:00Z")]:
        tampered = copy.deepcopy(approved); tampered["reviewed_state"][field] = value
        with pytest.raises(ApprovalError):
            verify_approval(KEY, ACTION, tampered)
    legacy = {key: approved[key] for key in ("digest", "actor", "expires_at", "signature")}
    with pytest.raises(ApprovalError):
        verify_approval(KEY, ACTION, legacy)


async def test_approval_expiring_after_claim_but_before_patch_is_not_dispatched(api, monkeypatch):
    recorder, client = api
    approved = grant()
    recorder.add("GET", f"/v2/{SERVICE.resource}", service_state("shop-api-bad"))
    recorder.add("GET", f"/v2/{SERVICE.resource}/revisions", {"json": {"revisions": [{"name": SERVICE.resource + "/revisions/shop-api-good"}]}})
    class SlowClaims(MemoryClaims):
        async def claim(self, approval):
            await super().claim(approval)
            monkeypatch.setattr("mobileops_agents.gcp.cloud_run.time.time", lambda: approved.expires_at + 1)
    result = await OpsTools(Settings(project=SERVICE.project, services=(SERVICE,), approval_key=KEY), client, SlowClaims()).execute_approved_rollback(SERVICE.name, "shop-api-good", approved.to_dict())
    assert result["status"] == "refused" and result["change_sent"] is False
    assert all(method == "GET" for method, *_ in recorder.calls)


async def test_cloud_run_rejecting_a_changed_etag_is_not_retried(api):
    recorder, client = api
    recorder.add("GET", f"/v2/{SERVICE.resource}", service_state("shop-api-bad"))
    recorder.add("GET", f"/v2/{SERVICE.resource}/revisions", {"json": {"revisions": [{"name": SERVICE.resource + "/revisions/shop-api-good"}]}})
    recorder.add("PATCH", f"/v2/{SERVICE.resource}", {"status": 409, "json": {"error": {"status": "ABORTED"}}})
    result = await OpsTools(Settings(project=SERVICE.project, services=(SERVICE,), approval_key=KEY), client, MemoryClaims()).execute_approved_rollback(SERVICE.name, "shop-api-good", grant().to_dict())
    assert result["status"] == "failed" and result["change_sent"] is False
    patches = [call for call in recorder.calls if call[0] == "PATCH"]
    assert len(patches) == 1 and patches[0][3]["etag"] == "synthetic-etag-v1"
