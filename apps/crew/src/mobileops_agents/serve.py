"""Entry point for every agent service. `AGENT` selects one of: ops, diagnosis, guardian, chief."""
from __future__ import annotations

import logging
import os
from urllib.parse import urlsplit

from google.adk.agents.remote_a2a_agent import RemoteA2aAgent
from a2a.server.tasks import InMemoryTaskStore  # noqa: F401  (documented extension point for a durable task store)
from google.adk.a2a.utils.agent_to_a2a import to_a2a
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from .agents.chief import build_chief_agent
from .agents.diagnosis import build_diagnosis_agent
from .agents.guardian import build_guardian_agent
from .agents.ops import build_ops_agent
from .config import Settings, load_settings
from .executor import RemoteExecutor
from .gcp.client import default_client
from .service_auth import peer_client
from .tools import OpsTools
from .tracing import setup_tracing

log = logging.getLogger("mobileops")
CARD_PATH = "/.well-known/agent-card.json"


def _remote(name: str, url: str, description: str) -> RemoteA2aAgent:
    return RemoteA2aAgent(name=name, agent_card=url.rstrip("/") + CARD_PATH, description=description, httpx_client=peer_client())


def build_agent(kind: str, settings: Settings, tools: OpsTools | None):
    if kind == "ops":
        return build_ops_agent(settings, tools)
    if kind == "diagnosis":
        return build_diagnosis_agent(settings)
    if kind == "guardian":
        return build_guardian_agent(settings)
    if kind == "chief":
        for label, url in (("OPS_AGENT_URL", settings.ops_url), ("DIAGNOSIS_AGENT_URL", settings.diagnosis_url), ("GUARDIAN_AGENT_URL", settings.guardian_url)):
            if not url:
                raise RuntimeError(f"{label} is required for the chief agent")
        return build_chief_agent(
            settings,
            _remote("ops", settings.ops_url, "Reads Cloud Run state, request metrics and error logs for registered services."),
            _remote("diagnosis", settings.diagnosis_url, "Turns collected evidence into ranked hypotheses, unknowns and a next step."),
            _remote("guardian", settings.guardian_url, "Classifies a proposed action as allow, require_human or refuse using the policy table."),
            RemoteExecutor(settings.ops_url, peer_client()),
        )
    raise RuntimeError(f"unknown AGENT '{kind}'")


EXECUTE_HTTP = {"applied": 200, "pending": 202, "refused": 403, "failed": 502, "unknown": 504}


def execute_route(tools: OpsTools) -> Route:
    """The Ops service's only way to change anything. Deterministic: no model, and it re-checks policy and the signed approval itself."""
    async def execute(request: Request) -> JSONResponse:
        try:
            body = await request.json()
            action, service, revision = body["action"], str(body["service"]), str(body["revision"])
        except (ValueError, KeyError, TypeError):
            return JSONResponse({"executed": False, "status": "refused", "change_sent": False, "error": "malformed request"}, status_code=400)
        if action != "rollback_traffic":
            return JSONResponse({"executed": False, "status": "refused", "change_sent": False, "error": "unsupported action"}, status_code=400)
        result = await tools.execute_approved_rollback(service, revision, body.get("approval") or {})
        # Audit line: who approved what, or why it was refused. Reasons are fixed strings, never upstream bodies.
        log.info("execute %s %s -> status=%s approved_by=%s reason=%s", service, revision, result.get("status"), result.get("approved_by"), result.get("error"))
        # 403 only for a refusal (nothing was sent). An accepted but unfinished change is 202, never a refusal.
        return JSONResponse(result, status_code=EXECUTE_HTTP.get(result.get("status"), 502))

    return Route("/execute", execute, methods=["POST"])


def create_app(kind: str | None = None, settings: Settings | None = None):
    kind = kind or os.environ.get("AGENT", "")
    setup_tracing()
    settings = settings or load_settings()
    tools = OpsTools(settings, default_client()) if kind == "ops" else None
    public = urlsplit(os.environ.get("PUBLIC_URL", "http://localhost:8080"))
    app = to_a2a(build_agent(kind, settings, tools), host=public.hostname or "localhost", port=public.port or (443 if public.scheme == "https" else 80), protocol=public.scheme)

    async def healthz(_: Request) -> JSONResponse:
        return JSONResponse({"agent": kind, "status": "ready"})

    app.router.routes.append(Route("/healthz", healthz))
    if kind == "ops":
        app.router.routes.append(execute_route(tools))
    log.info("agent %s ready", kind)
    return app


def main() -> None:
    import uvicorn

    logging.basicConfig(level=logging.INFO)
    uvicorn.run(create_app(), host="0.0.0.0", port=int(os.environ.get("PORT", "8080")), log_level="info")


if __name__ == "__main__":
    main()
