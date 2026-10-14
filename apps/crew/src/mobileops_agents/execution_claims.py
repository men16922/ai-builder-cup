"""Redeem a gateway-issued single-action capability exactly once, before Cloud Run dispatch.

The gateway owns the durable store and checks current membership. Ops receives no Firestore/IAM
permission. An uncertain claim response never permits dispatch or retries.
"""
from __future__ import annotations

from typing import Protocol
from urllib.parse import urlsplit

import httpx

from .approval import Approval


class ClaimError(Exception):
    def __init__(self, status: str, reason: str):
        super().__init__(reason)
        self.status = status


class ExecutionClaims(Protocol):
    async def claim(self, approval: Approval) -> None: ...


class DisabledExecutionClaims:
    async def claim(self, approval: Approval) -> None:
        raise ClaimError("refused", "durable execution claims are not configured")


class GatewayExecutionClaims:
    def __init__(self, origin: str, client: httpx.AsyncClient):
        parsed = urlsplit(origin)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None, 443) or parsed.path or parsed.query or parsed.fragment:
            raise ValueError("A fixed HTTPS gateway origin is required")
        self._origin, self._url, self._client = origin, origin + "/api/gcp/crew/execution-claims", client

    async def claim(self, approval: Approval) -> None:
        try:
            response = await self._client.post(self._url, headers={"Origin": self._origin, "Authorization": "Bearer " + approval.signature}, json={"approval": approval.to_dict()}, timeout=10.0, follow_redirects=False)
        except httpx.HTTPError as error:
            raise ClaimError("unknown", "execution claim could not be confirmed; no change was dispatched and it is not retried") from error
        if response.status_code == 409:
            raise ClaimError("refused", "this approval was already used; ask again for a new decision")
        if response.status_code in (400, 401, 403, 404):
            raise ClaimError("refused", "the execution grant or current membership was refused")
        try:
            body = response.json() if response.status_code == 200 and len(response.content) <= 8192 else None
            valid = isinstance(body, dict) and set(body) == {"claimed"} and body["claimed"] is True
        except ValueError:
            valid = False
        if not valid:
            raise ClaimError("unknown", "execution claim outcome is unknown; no change was dispatched and it is not retried")
