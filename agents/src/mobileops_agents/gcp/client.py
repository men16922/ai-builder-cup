"""A small bounded Google REST client. No raw upstream body or credential ever reaches a model or a log line."""
from __future__ import annotations

import asyncio
from typing import Any

import httpx

SCOPE = "https://www.googleapis.com/auth/cloud-platform"


class GoogleApiError(Exception):
    """A failed Google API call, reduced to a status and a stable code."""

    def __init__(self, status: int, code: str):
        super().__init__(f"{status} {code}")
        self.status, self.code = status, code


def _code(status: int) -> str:
    return {400: "invalid_request", 401: "unauthenticated", 403: "access_denied", 404: "not_found", 409: "conflict", 429: "throttled"}.get(status, "unavailable")


class GoogleApiClient:
    def __init__(self, *, credentials: Any = None, transport: httpx.AsyncBaseTransport | None = None, timeout: float = 10.0):
        self._credentials, self._lock = credentials, asyncio.Lock()
        self._http = httpx.AsyncClient(transport=transport, timeout=timeout, follow_redirects=False)

    async def _token(self) -> str | None:
        if self._credentials is None:
            return None
        async with self._lock:
            if not self._credentials.valid:
                import google.auth.transport.requests as requests

                await asyncio.to_thread(self._credentials.refresh, requests.Request())
            return self._credentials.token

    async def request(self, method: str, url: str, *, params: dict | None = None, json: dict | None = None) -> dict:
        if not url.startswith("https://") or ".googleapis.com/" not in url.split("?")[0][:60]:
            raise GoogleApiError(400, "invalid_request")
        headers = {}
        if token := await self._token():
            headers["Authorization"] = f"Bearer {token}"
        try:
            response = await self._http.request(method, url, params=params, json=json, headers=headers)
        except httpx.HTTPError as error:
            raise GoogleApiError(503, "unavailable") from error
        if response.status_code >= 400:
            raise GoogleApiError(response.status_code, _code(response.status_code))
        if len(response.content) > 1_000_000:
            raise GoogleApiError(502, "response_too_large")
        return response.json() if response.content else {}

    async def close(self) -> None:
        await self._http.aclose()


def default_client() -> GoogleApiClient:
    """Application Default Credentials: the runtime service account on Cloud Run, the developer's login locally."""
    import google.auth

    credentials, _ = google.auth.default(scopes=[SCOPE])
    return GoogleApiClient(credentials=credentials)
