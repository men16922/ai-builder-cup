"""Signed human approvals. The gateway signs after a verified person approves one exact action; the ops agent verifies.

The model never holds the key, so it cannot create, extend or reuse an approval. An approval covers one action digest,
one actor and a short time window.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass


class ApprovalError(Exception):
    """The approval is missing, forged, expired or for a different action."""


def action_digest(action: dict) -> str:
    """Stable digest of the exact change that was shown to the person."""
    canonical = json.dumps(action, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode()).hexdigest()


@dataclass(frozen=True)
class Approval:
    digest: str
    actor: str
    expires_at: int
    signature: str

    def to_dict(self) -> dict:
        return {"digest": self.digest, "actor": self.actor, "expires_at": self.expires_at, "signature": self.signature}


def _mac(key: bytes, digest: str, actor: str, expires_at: int) -> str:
    message = json.dumps([digest, actor, expires_at], separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(hmac.new(key, message, hashlib.sha256).digest()).decode().rstrip("=")


def sign_approval(key: bytes, action: dict, actor: str, ttl_seconds: int = 300, now: float | None = None) -> Approval:
    if not key:
        raise ApprovalError("approval signing is not configured")
    expires_at = int((time.time() if now is None else now) + ttl_seconds)
    digest = action_digest(action)
    return Approval(digest, actor, expires_at, _mac(key, digest, actor, expires_at))


def verify_approval(key: bytes, action: dict, approval: dict | None, now: float | None = None) -> Approval:
    if not key:
        raise ApprovalError("approval verification is not configured")
    if not isinstance(approval, dict):
        raise ApprovalError("a signed human approval is required")
    try:
        digest, actor, expires_at, signature = str(approval["digest"]), str(approval["actor"]), int(approval["expires_at"]), str(approval["signature"])
    except (KeyError, TypeError, ValueError) as error:
        raise ApprovalError("the approval is malformed") from error
    if not hmac.compare_digest(_mac(key, digest, actor, expires_at), signature):
        raise ApprovalError("the approval signature is invalid")
    if digest != action_digest(action):
        raise ApprovalError("the approval was granted for a different action")
    if expires_at <= (time.time() if now is None else now):
        raise ApprovalError("the approval has expired")
    return Approval(digest, actor, expires_at, signature)
