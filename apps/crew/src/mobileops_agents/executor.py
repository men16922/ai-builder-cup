"""How the Chief hands an approved change to the Ops agent, which is the only component allowed to apply it."""
from __future__ import annotations

from typing import Protocol

import httpx

from .tools import OpsTools


class Executor(Protocol):
    async def execute_rollback(self, service: str, revision: str, approval: dict | None) -> dict: ...


class LocalExecutor:
    """In-process executor for tests and local runs."""

    def __init__(self, tools: OpsTools):
        self._tools = tools

    async def execute_rollback(self, service: str, revision: str, approval: dict | None) -> dict:
        return await self._tools.execute_approved_rollback(service, revision, approval or {})


class RemoteExecutor:
    """Calls the Ops service's /execute endpoint with a Cloud Run identity token. The Ops service re-checks policy and the approval."""

    def __init__(self, base_url: str, client: httpx.AsyncClient):
        self._url = base_url.rstrip("/") + "/execute"
        self._client = client

    async def execute_rollback(self, service: str, revision: str, approval: dict | None) -> dict:
        try:
            response = await self._client.post(self._url, json={"action": "rollback_traffic", "service": service, "revision": revision, "approval": approval}, timeout=60.0)
        except httpx.HTTPError:
            return {"executed": False, "error": "The Ops service could not be reached; the outcome is unknown and the change was not retried."}
        try:
            body = response.json()
        except ValueError:
            body = {}
        if response.status_code != 200:
            # The Ops service returns only fixed, safe reason strings (never upstream bodies or credentials).
            reason = str(body.get("error", "no reason given"))[:240] if isinstance(body, dict) else "no reason given"
            return {"executed": False, "error": f"The Ops service refused the request ({response.status_code}): {reason}"}
        return body
