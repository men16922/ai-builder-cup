"""The Chief's approval gate, exercised with a scripted model and an in-memory Google API. No network and no real Gemini."""
import json
import time

import pytest
from google.adk.agents import LlmAgent
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import InMemoryRunner
from google.genai import types

from mobileops_agents.agents.chief import build_chief_agent
from mobileops_agents.approval import sign_approval
from mobileops_agents.config import RegisteredService, Settings
from mobileops_agents.executor import LocalExecutor
from mobileops_agents.tools import OpsTools, canonical_action

from conftest import SERVICE

KEY = b"approval-key-for-tests-0123456789"
SETTINGS = Settings(project="example-project", services=(RegisteredService("shop-api", "example-project", "asia-northeast3"),), approval_key=KEY)
BASE = f"/v2/{SERVICE.resource}"


class ScriptedModel(BaseLlm):
    """Plays a fixed script: call propose_rollback once, then answer with whatever the tool returned."""

    model: str = "scripted"
    revision: str = "shop-api-00001"
    service: str = "shop-api"

    async def generate_content_async(self, llm_request, stream=False):
        last = llm_request.contents[-1]
        responses = [p.function_response for p in last.parts if p.function_response]
        if responses:
            yield LlmResponse(content=types.Content(role="model", parts=[types.Part(text=json.dumps(responses[0].response, default=str))]))
        else:
            call = types.FunctionCall(name="propose_rollback", args={"service": self.service, "revision": self.revision, "reason": "v2 fails"})
            yield LlmResponse(content=types.Content(role="model", parts=[types.Part(function_call=call)]))


def make_chief(api, revision="shop-api-00001", service="shop-api"):
    recorder, client = api
    tools = OpsTools(SETTINGS, client)
    stub = LlmAgent(name="stub", model="gemini-3.8-flash", instruction="unused")
    chief = build_chief_agent(SETTINGS, stub, LlmAgent(name="stub2", model="gemini-3.8-flash", instruction="unused"),
                              LlmAgent(name="stub3", model="gemini-3.8-flash", instruction="unused"), LocalExecutor(tools))
    chief.model = ScriptedModel(revision=revision, service=service)
    return chief, recorder


async def drive(chief, message, session=None, runner=None):
    runner = runner or InMemoryRunner(agent=chief, app_name="test")
    session = session or await runner.session_service.create_session(app_name="test", user_id="u")
    seen, final = [], None
    async for event in runner.run_async(user_id="u", session_id=session.id, new_message=message):
        seen += event.get_function_calls()
        if event.is_final_response() and event.content and event.content.parts:
            final = event.content.parts[0].text
    return runner, session, seen, final


def answer(call, confirmed, approval=None):
    response = {"confirmed": confirmed, "payload": {"approval": approval} if approval else {}}
    return types.Content(role="user", parts=[types.Part(function_response=types.FunctionResponse(id=call.id, name="adk_request_confirmation", response=response))])


def rollback_routes(recorder):
    recorder.add("GET", BASE + "/revisions", {"json": {"revisions": [{"name": f"{SERVICE.resource}/revisions/shop-api-00001"}]}})
    recorder.add("PATCH", BASE, {"json": {"name": "projects/p/locations/l/operations/o", "done": True, "response": {}}})


async def start(chief):
    runner, session, seen, _ = await drive(chief, types.Content(role="user", parts=[types.Part(text="fix it")]))
    pause = next(call for call in seen if call.name == "adk_request_confirmation")
    return runner, session, pause


def patches(recorder):
    return [call for call in recorder.calls if call[0] == "PATCH"]


async def test_a_change_pauses_for_a_person_and_nothing_is_applied(api):
    chief, recorder = make_chief(api)
    _, _, pause = await start(chief)
    payload = pause.args["toolConfirmation"]["payload"]
    assert payload["action"] == canonical_action("rollback_traffic", "shop-api", "shop-api-00001") and payload["risk"] == "medium"
    assert recorder.calls == []


async def test_rejection_never_reaches_cloud_run(api):
    chief, recorder = make_chief(api)
    runner, session, pause = await start(chief)
    _, _, _, final = await drive(chief, answer(pause, False), session, runner)
    assert "rejected_by_person" in final and recorder.calls == []


async def test_a_valid_signed_approval_applies_exactly_the_approved_rollback(api):
    chief, recorder = make_chief(api)
    rollback_routes(recorder)
    runner, session, pause = await start(chief)
    approval = sign_approval(KEY, pause.args["toolConfirmation"]["payload"]["action"], "user-1").to_dict()
    _, _, _, final = await drive(chief, answer(pause, True, approval), session, runner)
    assert '"status": "executed"' in final and "user-1" in final
    assert len(patches(recorder)) == 1 and patches(recorder)[0][3]["traffic"][0]["revision"] == "shop-api-00001"


@pytest.mark.parametrize("kind", ["missing", "forged", "other_action", "expired"])
async def test_a_person_saying_yes_without_a_valid_approval_changes_nothing(api, kind):
    chief, recorder = make_chief(api)
    rollback_routes(recorder)
    runner, session, pause = await start(chief)
    action = pause.args["toolConfirmation"]["payload"]["action"]
    approval = {"missing": None,
                "forged": {**sign_approval(KEY, action, "user-1").to_dict(), "actor": "attacker"},
                "other_action": sign_approval(KEY, {**action, "revision": "shop-api-00009"}, "user-1").to_dict(),
                "expired": sign_approval(KEY, action, "user-1", ttl_seconds=30, now=time.time() - 300).to_dict()}[kind]
    _, _, _, final = await drive(chief, answer(pause, True, approval), session, runner)
    assert '"status": "not_executed"' in final and patches(recorder) == []


async def test_unregistered_services_are_refused_before_anyone_is_asked(api):
    chief, recorder = make_chief(api, service="payments-prod")
    _, _, seen, final = await drive(chief, types.Content(role="user", parts=[types.Part(text="fix it")]))
    assert not [call for call in seen if call.name == "adk_request_confirmation"]
    assert '"status": "refused"' in final and recorder.calls == []


async def test_the_ops_executor_refuses_on_its_own_even_if_the_chief_is_bypassed(api):
    recorder, client = api
    tools = OpsTools(SETTINGS, client)
    assert (await tools.execute_approved_rollback("payments-prod", "r1", {}))["executed"] is False
    assert (await tools.execute_approved_rollback("shop-api", "shop-api-00001", {}))["executed"] is False
    assert recorder.calls == []
