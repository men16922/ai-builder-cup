import json

import httpx
import pytest

from mobileops_agents.config import RegisteredService
from mobileops_agents.gcp.client import GoogleApiClient

SERVICE = RegisteredService(name="shop-api", project="example-project", region="asia-northeast3")


class Recorder:
    """An in-memory Google API. Tests register canned responses by (method, path) and inspect the calls afterwards."""

    def __init__(self):
        self.routes: dict[tuple[str, str], list[dict]] = {}
        self.calls: list[tuple[str, str, dict, dict | None]] = []

    def add(self, method: str, path: str, *responses: dict):
        self.routes.setdefault((method, path), []).extend(responses)

    def transport(self) -> httpx.MockTransport:
        def handle(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content) if request.content else None
            self.calls.append((request.method, request.url.path, dict(request.url.params), body))
            queue = self.routes.get((request.method, request.url.path))
            if not queue:
                return httpx.Response(404, json={"error": "unrouted"})
            item = queue[0] if len(queue) == 1 else queue.pop(0)
            return httpx.Response(item.get("status", 200), json=item.get("json", {}))
        return httpx.MockTransport(handle)


@pytest.fixture
def api():
    recorder = Recorder()
    client = GoogleApiClient(transport=recorder.transport())
    yield recorder, client
