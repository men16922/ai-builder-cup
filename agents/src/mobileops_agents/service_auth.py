"""Service-to-service authentication on Cloud Run: callers present a Google-signed identity token for the callee."""
from __future__ import annotations

import asyncio
import os
from urllib.parse import urlsplit

import httpx


def running_on_cloud_run() -> bool:
    return bool(os.environ.get("K_SERVICE"))


class IdTokenAuth(httpx.Auth):
    """Adds `Authorization: Bearer <id token>` with the callee's origin as audience. A no-op outside Cloud Run."""

    requires_response_body = False

    def __init__(self, enabled: bool | None = None):
        self._enabled = running_on_cloud_run() if enabled is None else enabled

    async def async_auth_flow(self, request: httpx.Request):
        if self._enabled:
            parts = urlsplit(str(request.url))
            audience = f"{parts.scheme}://{parts.netloc}"
            import google.auth.transport.requests as requests
            from google.oauth2 import id_token

            token = await asyncio.to_thread(id_token.fetch_id_token, requests.Request(), audience)
            request.headers["Authorization"] = f"Bearer {token}"
        yield request


def peer_client(timeout: float = 120.0) -> httpx.AsyncClient:
    return httpx.AsyncClient(auth=IdTokenAuth(), timeout=timeout, follow_redirects=False)
