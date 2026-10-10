"""Cloud Run reads and one narrow, reversible change (traffic rollback). Only registered services are reachable."""
from __future__ import annotations

import asyncio
import re

from ..config import RegisteredService
from .client import GoogleApiClient, GoogleApiError

RUN = "https://run.googleapis.com/v2"
REVISION_RE = re.compile(r"^[a-z][a-z0-9-]{0,62}$")


def _short(name: str | None) -> str | None:
    return name.rsplit("/", 1)[-1] if name else None


async def inspect_service(client: GoogleApiClient, service: RegisteredService, revisions: int = 5) -> dict:
    raw = await client.request("GET", f"{RUN}/{service.resource}")
    listing = await client.request("GET", f"{RUN}/{service.resource}/revisions", params={"pageSize": max(1, min(revisions, 10))})
    traffic = [{"revision": _short(t.get("revision")) or t.get("type", "").replace("TRAFFIC_TARGET_ALLOCATION_TYPE_", "").lower(), "percent": t.get("percent", 0)}
               for t in raw.get("trafficStatuses", [])]
    items = []
    for rev in listing.get("revisions", []):
        containers = rev.get("containers") or [{}]
        ready = next((c for c in rev.get("conditions", []) if c.get("type") == "Ready"), {})
        items.append({"name": _short(rev.get("name")), "created": rev.get("createTime"), "ready": _short(ready.get("state")) or "unknown",
                      "image": containers[0].get("image"), "env_var_names": sorted(e.get("name", "") for e in containers[0].get("env", []))[:20]})
    return {
        "service": service.name, "region": service.region, "generation": raw.get("generation"), "observed_generation": raw.get("observedGeneration"),
        # The v2 API omits a boolean when it is false, so absence is reported as "not reported" rather than assumed.
        "reconciling": raw.get("reconciling") if "reconciling" in raw else "not_reported",
        "latest_ready_revision": _short(raw.get("latestReadyRevision")), "latest_created_revision": _short(raw.get("latestCreatedRevision")),
        "traffic": traffic, "recent_revisions": items,
        "note": "Readiness is not health. Use logs and request metrics to judge health.",
    }


async def rollback_traffic(client: GoogleApiClient, service: RegisteredService, revision: str, *, poll_seconds: float = 1.0, attempts: int = 20) -> dict:
    """Send 100% of traffic to an existing revision. Reversible; it never deletes a revision or builds new code."""
    if not REVISION_RE.match(revision):
        raise GoogleApiError(400, "invalid_request")
    listing = await client.request("GET", f"{RUN}/{service.resource}/revisions", params={"pageSize": 50})
    if revision not in {_short(r.get("name")) for r in listing.get("revisions", [])}:
        raise GoogleApiError(404, "not_found")
    body = {"traffic": [{"type": "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION", "revision": revision, "percent": 100}]}
    operation = await client.request("PATCH", f"{RUN}/{service.resource}", params={"updateMask": "traffic"}, json=body)
    name = operation.get("name", "")
    for _ in range(attempts):
        if operation.get("done"):
            break
        await asyncio.sleep(poll_seconds)
        operation = await client.request("GET", f"{RUN}/{name}")
    done = bool(operation.get("done")) and "error" not in operation
    return {"service": service.name, "revision": revision, "applied": done, "operation_done": bool(operation.get("done"))}
