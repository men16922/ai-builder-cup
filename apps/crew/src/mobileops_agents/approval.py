"""V2 human approval: exact action, reviewer, lease, durable grant and reviewed service state.

Only the authenticated gateway signs live approvals. Models never receive the signing key.
Legacy approvals have no reviewed-state fence and are refused.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from uuid import UUID, uuid4

APPROVAL_TTL_SECONDS = 300
CLOCK_SKEW_SECONDS = 30


class ApprovalError(Exception):
    """Missing, forged, expired or out-of-scope authority."""


def action_digest(action: dict) -> str:
    canonical = json.dumps(action, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode()).hexdigest()


@dataclass(frozen=True)
class ReviewedState:
    uid: str
    etag: str
    update_time: str
    observed_at: str

    @classmethod
    def parse(cls, value: dict) -> ReviewedState:
        try:
            if not isinstance(value, dict) or set(value) != {"uid", "etag", "update_time", "observed_at"}:
                raise ValueError()
            if not all(isinstance(item, str) for item in value.values()):
                raise ValueError()
            if not 1 <= len(value["uid"]) <= 128 or not 1 <= len(value["etag"]) <= 256:
                raise ValueError()
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}", value["uid"]) or not re.fullmatch(r"[\x21-\x7e]{1,256}", value["etag"]):
                raise ValueError()
            times = {}
            for key in ("update_time", "observed_at"):
                parsed = datetime.fromisoformat(value[key].replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    raise ValueError()
                times[key] = parsed.timestamp()
            if times["update_time"] > times["observed_at"] + CLOCK_SKEW_SECONDS:
                raise ValueError()
            return cls(**value)
        except (TypeError, ValueError) as error:
            raise ApprovalError("the reviewed service state is malformed") from error


@dataclass(frozen=True)
class Approval:
    digest: str
    actor: str
    expires_at: int
    grant_id: str
    reviewed_state: ReviewedState
    signature: str
    version: int = 2

    def to_dict(self) -> dict:
        return asdict(self)


def _mac(key: bytes, digest: str, actor: str, expires_at: int, grant_id: str, state: ReviewedState) -> str:
    message = json.dumps(["aide-approval-v2", digest, actor, expires_at, grant_id, state.uid, state.etag, state.update_time, state.observed_at], separators=(",", ":"), ensure_ascii=False).encode()
    return base64.urlsafe_b64encode(hmac.new(key, message, hashlib.sha256).digest()).decode().rstrip("=")


def sign_approval(key: bytes, action: dict, actor: str, ttl_seconds: int = 300, now: float | None = None, *, reviewed_state: dict, grant_id: str | None = None) -> Approval:
    """Test/offline signing seam; real approval signing is only in the authenticated gateway."""
    if len(key) < 16:
        raise ApprovalError("approval signing is not configured")
    state = ReviewedState.parse(reviewed_state)
    grant_id = str(UUID(grant_id)) if grant_id else str(uuid4())
    expires_at = int((time.time() if now is None else now) + ttl_seconds)
    digest = action_digest(action)
    return Approval(digest, actor, expires_at, grant_id, state, _mac(key, digest, actor, expires_at, grant_id, state))


def verify_approval(key: bytes, action: dict, approval: dict | None, now: float | None = None) -> Approval:
    if len(key) < 16:
        raise ApprovalError("approval verification is not configured")
    if not isinstance(approval, dict):
        raise ApprovalError("a signed human approval is required")
    try:
        if set(approval) != {"version", "digest", "actor", "expires_at", "grant_id", "reviewed_state", "signature"} or approval["version"] != 2:
            raise ValueError()
        digest, actor, expires_at, grant_id, signature = (approval[key] for key in ("digest", "actor", "expires_at", "grant_id", "signature"))
        if not isinstance(expires_at, int) or isinstance(expires_at, bool) or not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise ValueError()
        if not isinstance(actor, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}", actor):
            raise ValueError()
        if not isinstance(signature, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", signature) or str(UUID(grant_id)) != grant_id:
            raise ValueError()
        state = ReviewedState.parse(approval["reviewed_state"])
    except (KeyError, TypeError, ValueError) as error:
        raise ApprovalError("the approval is malformed or has no reviewed-state fence") from error
    if not hmac.compare_digest(_mac(key, digest, actor, expires_at, grant_id, state), signature):
        raise ApprovalError("the approval signature is invalid")
    if digest != action_digest(action):
        raise ApprovalError("the approval was granted for a different action")
    current = time.time() if now is None else now
    if expires_at <= current:
        raise ApprovalError("the approval has expired")
    if expires_at - current > APPROVAL_TTL_SECONDS + CLOCK_SKEW_SECONDS:
        raise ApprovalError("the approval window is longer than allowed")
    observed_at = datetime.fromisoformat(state.observed_at.replace("Z", "+00:00")).timestamp()
    if observed_at > current + CLOCK_SKEW_SECONDS or observed_at < current - 13 * 60:
        raise ApprovalError("the reviewed service state is too old or in the future")
    return Approval(digest, actor, expires_at, grant_id, state, signature)
