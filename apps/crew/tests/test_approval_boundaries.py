"""Execution authority must survive worker concurrency and bind to the reviewed state."""
import asyncio
import copy
import json
import time
from datetime import datetime, timezone

import httpx

from mobileops_agents.approval import sign_approval
from mobileops_agents.config import Settings
from mobileops_agents.gcp.client import GoogleApiClient
from mobileops_agents.tools import OpsTools, canonical_action

from conftest import SERVICE, MemoryClaims, reviewed_state

KEY = b"synthetic-approval-boundary-key-0123456789"
SETTINGS = Settings(project="example-project", services=(SERVICE,), approval_key=KEY)
ACTION = canonical_action("rollback_traffic", SERVICE.name, "shop-api-good")
BASE = f"/v2/{SERVICE.resource}"


async def test_two_workers_using_one_approval_dispatch_exactly_once():
    reads, patches = 0, []
    barrier = asyncio.Event()
    state = {"uid":"synthetic-service-uid","etag":"synthetic-etag-v1","updateTime": "2020-01-01T00:00:00Z", "trafficStatuses": [{"revision": "shop-api-bad", "percent": 100}]}

    async def handle(request):
        nonlocal reads
        if request.method == "GET" and request.url.path == BASE:
            snapshot = copy.deepcopy(state)
            if not patches:
                reads += 1
                if reads == 2:
                    barrier.set()
                await barrier.wait()
            return httpx.Response(200, json=snapshot)
        if request.method == "GET" and request.url.path == BASE + "/revisions":
            return httpx.Response(200, json={"revisions": [{"name": SERVICE.resource + "/revisions/shop-api-good"}]})
        if request.method == "PATCH":
            assert json.loads(request.content)["etag"]=="synthetic-etag-v1"
            patches.append(request)
            state["trafficStatuses"] = [{"revision": "shop-api-good", "percent": 100}]
            return httpx.Response(200, json={"done": True})
        return httpx.Response(404, json={})

    client = GoogleApiClient(transport=httpx.MockTransport(handle))
    granted = sign_approval(KEY, ACTION, "synthetic-reviewer",reviewed_state=reviewed_state()).to_dict()
    claims=MemoryClaims()
    results = await asyncio.wait_for(asyncio.gather(*(OpsTools(SETTINGS, client,claims).execute_approved_rollback(SERVICE.name, "shop-api-good", granted) for _ in range(2))), 2)
    assert len(patches) == 1
    assert any(result["status"] == "applied" for result in results)


async def test_a_deploy_between_proposal_and_tap_sends_no_change():
    patches = []

    async def handle(request):
        if request.method == "GET" and request.url.path == BASE:
            return httpx.Response(200, json={"uid":"synthetic-service-uid","etag":"synthetic-etag-v2","updateTime": datetime.fromtimestamp(time.time() - 10, timezone.utc).isoformat(), "trafficStatuses": [{"revision": "shop-api-good", "percent": 100}]})
        if request.method == "GET" and request.url.path == BASE + "/revisions":
            return httpx.Response(200, json={"revisions": [{"name": SERVICE.resource + "/revisions/shop-api-good"}]})
        if request.method == "PATCH":
            patches.append(request)
            return httpx.Response(200, json={"done": True})
        return httpx.Response(404, json={})

    client = GoogleApiClient(transport=httpx.MockTransport(handle))
    # The person reviewed before the deploy and tapped afterwards. The timestamp-only V1
    # implementation accepted this; V2 must compare the reviewed etag, not the tap timestamp.
    review={**reviewed_state(),"update_time":datetime.fromtimestamp(time.time()-20,timezone.utc).isoformat(),"observed_at":datetime.fromtimestamp(time.time()-15,timezone.utc).isoformat()}
    granted = sign_approval(KEY, ACTION, "synthetic-reviewer",reviewed_state=review).to_dict()
    result = await OpsTools(SETTINGS, client,MemoryClaims()).execute_approved_rollback(SERVICE.name, "shop-api-good", granted)
    assert result["status"] == "refused" and not patches
