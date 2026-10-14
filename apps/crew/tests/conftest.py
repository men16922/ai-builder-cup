import json
from datetime import datetime, timezone

import httpx
import pytest

from mobileops_agents.config import RegisteredService
from mobileops_agents.gcp.client import GoogleApiClient
from mobileops_agents.execution_claims import ClaimError

SERVICE = RegisteredService(name="shop-api", project="example-project", region="asia-northeast3")

def reviewed_state():
    return {"uid":"synthetic-service-uid","etag":"synthetic-etag-v1","update_time":"2020-01-01T00:00:00Z","observed_at":datetime.now(timezone.utc).isoformat().replace("+00:00","Z")}

class MemoryClaims:
    """Only an injected offline claim fixture, never a production adapter/default."""
    def __init__(self):
        self.used=set()
    async def claim(self, approval):
        if approval.grant_id in self.used:
            raise ClaimError("refused","this approval was already used; ask again for a new decision")
        self.used.add(approval.grant_id)


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


def service_state(revision: str, update_time: str = "2020-01-01T00:00:00Z", percent: int = 100) -> dict:
    """What GET service returns: when it was last updated and where its traffic goes."""
    return {"json": {"uid":"synthetic-service-uid","etag":"synthetic-etag-v1","updateTime": update_time, "trafficStatuses": [{"type": "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION", "revision": revision, "percent": percent}]}}


@pytest.fixture
def api():
    recorder = Recorder()
    client = GoogleApiClient(transport=recorder.transport())
    yield recorder, client
