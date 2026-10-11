from __future__ import annotations

import json

from google.adk.agents import LlmAgent

from ..config import Settings, model_config
from ..policy import evaluate


def build_guardian_agent(settings: Settings) -> LlmAgent:
    registered = {s.name for s in settings.services}

    def check_action(action: str, service: str = "", revision: str = "") -> str:
        """Classify a proposed action with the deterministic policy. Returns the verdict, risk and reason as JSON."""
        params = {key: value for key, value in {"service": service, "revision": revision}.items() if value}
        return json.dumps(evaluate(action, params, registered=registered).to_dict())

    instruction = """You are the Guardian agent. Every proposed action must be classified by calling check_action; you never decide a verdict yourself.
Explain the verdict to a busy person in two short sentences: what would change, why it needs (or does not need) their approval, and the risk.
If the verdict is refuse, say so plainly and do not suggest a workaround."""
    return LlmAgent(name="guardian", model=settings.model, description="Classifies a proposed action as allow, require_human or refuse using the policy table.",
                    instruction=instruction, generate_content_config=model_config(), tools=[check_action])
