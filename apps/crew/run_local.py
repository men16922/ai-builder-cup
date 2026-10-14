"""Local harness: run the Chief against real Google APIs with the developer's login. Not shipped in the image."""
import asyncio, json, sys

from google.adk.runners import InMemoryRunner
from google.genai import types

from mobileops_agents.agents.chief import build_chief_agent
from mobileops_agents.agents.diagnosis import build_diagnosis_agent
from mobileops_agents.agents.guardian import build_guardian_agent
from mobileops_agents.agents.ops import build_ops_agent
from mobileops_agents.config import load_settings
from mobileops_agents.executor import LocalExecutor
from mobileops_agents.gcp.client import default_client
from mobileops_agents.tools import OpsTools


async def drive(runner, session, message):
    """Print events; return the confirmation request (call id + args) if the run paused for a person."""
    pending = None
    async for event in runner.run_async(user_id="dev", session_id=session.id, new_message=message):
        for call in event.get_function_calls():
            if call.name == "adk_request_confirmation":
                pending = call
                print("PAUSED FOR PERSON:", json.dumps(dict(call.args or {}), default=str)[:500])
            else:
                print("CALL", call.name, json.dumps(dict(call.args or {}), default=str)[:140])
        for response in event.get_function_responses():
            print("RESULT", response.name, json.dumps(response.response, default=str)[:160])
        if event.is_final_response() and event.content and event.content.parts and event.content.parts[0].text:
            print("FINAL:\n" + event.content.parts[0].text)
    return pending


async def main(prompt: str, approve: bool):
    if approve:
        raise SystemExit("Local mutation approval is disabled. Use the authenticated gateway.")
    settings = load_settings()
    tools = OpsTools(settings, default_client())
    chief = build_chief_agent(settings, build_ops_agent(settings, tools), build_diagnosis_agent(settings), build_guardian_agent(settings), LocalExecutor(tools))
    runner = InMemoryRunner(agent=chief, app_name="local")
    session = await runner.session_service.create_session(app_name="local", user_id="dev")
    pending = await drive(runner, session, types.Content(role="user", parts=[types.Part(text=prompt)]))
    if pending:
        print("Use the authenticated Aide gateway to review and approve. Local signing cannot issue a durable live grant.")
    _ = approve

asyncio.run(main(sys.argv[1], "--approve" in sys.argv))
