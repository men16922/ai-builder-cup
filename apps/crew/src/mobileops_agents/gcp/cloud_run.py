"""Cloud Run reads and one narrow, reversible change (traffic rollback). Only registered services are reachable."""
from __future__ import annotations

import asyncio
import re
import time

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


def _traffic_is(raw: dict, revision: str) -> bool:
    """True when the service reports exactly one traffic target: 100% to this revision."""
    targets = [t for t in raw.get("trafficStatuses", []) if t.get("percent", 0) > 0]
    return len(targets) == 1 and targets[0].get("percent") == 100 and _short(targets[0].get("revision")) == revision


async def rollback_traffic(client: GoogleApiClient, service: RegisteredService, revision: str, *, etag: str, expires_at: int | None = None, poll_seconds: float = 1.0, attempts: int = 20) -> dict:
    """Send 100% of traffic to an existing revision. Reversible; it never deletes a revision or builds new code.

    Raises GoogleApiError only before any change was sent. After that it reports one of:
    applied (operation finished and the re-read traffic shows the target), pending (accepted, not finished yet),
    failed (Cloud Run refused the request or the operation ended in an error) or unknown (the outcome cannot be read).
    The change request is never sent twice.
    """
    if not REVISION_RE.match(revision) or not isinstance(etag, str) or not 1 <= len(etag) <= 256:
        raise GoogleApiError(400, "invalid_request")
    listing = await client.request("GET", f"{RUN}/{service.resource}/revisions", params={"pageSize": 50})
    if revision not in {_short(r.get("name")) for r in listing.get("revisions", [])}:
        raise GoogleApiError(404, "not_found")
    result = {"service": service.name, "revision": revision, "operation_done": False}
    if expires_at is not None and expires_at <= time.time():
        return {**result, "status": "refused", "change_sent": False, "error": "the approval expired before dispatch; review and decide again"}
    body = {"etag": etag, "traffic": [{"type": "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION", "revision": revision, "percent": 100}]}
    try:
        operation = await client.request("PATCH", f"{RUN}/{service.resource}", params={"updateMask": "traffic"}, json=body)
    except GoogleApiError as error:
        # A 4xx answer means Cloud Run did not take the change. Anything else may have reached it: do not guess.
        return {**result, "status": "failed" if error.status < 500 else "unknown", "change_sent": error.status >= 500, "error": f"Cloud Run change request: {error.code}"}
    result["change_sent"] = True
    name = operation.get("name", "")
    try:
        for _ in range(attempts):
            if operation.get("done"):
                break
            await asyncio.sleep(poll_seconds)
            operation = await client.request("GET", f"{RUN}/{name}")
    except GoogleApiError as error:
        return {**result, "status": "unknown", "error": f"Reading the change operation failed: {error.code}. The change was accepted and is not retried."}
    if not operation.get("done"):
        return {**result, "status": "pending", "error": "Cloud Run accepted the change and has not finished it yet. Check the traffic split; it is not retried."}
    result["operation_done"] = True
    if "error" in operation:
        return {**result, "status": "failed", "error": "The Cloud Run operation ended with an error."}
    try:
        raw = await client.request("GET", f"{RUN}/{service.resource}")
    except GoogleApiError:
        return {**result, "status": "unknown", "error": "The operation finished but the traffic split could not be re-read."}
    if not _traffic_is(raw, revision):
        return {**result, "status": "unknown", "error": "The operation finished but the traffic split does not show the approved target yet."}
    return {**result, "status": "applied"}
