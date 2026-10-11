"""Guardian policy: deterministic rules that sit outside the model.

The Guardian agent explains a verdict in words, but the verdict itself comes from this table so it is testable and
cannot be talked out of a decision.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Verdict(str, Enum):
    ALLOW = "allow"  # read-only; may run without a person
    REQUIRE_HUMAN = "require_human"  # a person must approve this exact action on the phone
    REFUSE = "refuse"  # never allowed through the crew


@dataclass(frozen=True)
class Decision:
    verdict: Verdict
    risk: str  # low | medium | high
    reason: str

    def to_dict(self) -> dict:
        return {"verdict": self.verdict.value, "risk": self.risk, "reason": self.reason}


READ_ACTIONS = {"inspect_service", "read_error_logs", "read_request_metrics", "list_registered_services"}
# Reversible, narrowly scoped changes that still need a human decision.
CHANGE_ACTIONS = {"rollback_traffic": "medium"}
# Permanent or identity-changing operations are outside the crew's remit.
FORBIDDEN_ACTIONS = {"delete_service", "delete_revision", "set_iam_policy", "set_service_account", "disable_api", "delete_data"}


def evaluate(action: str, params: dict | None = None, *, registered: set[str]) -> Decision:
    """Classify one proposed action. Unknown actions are refused: the default is deny."""
    params = params or {}
    if action in FORBIDDEN_ACTIONS:
        return Decision(Verdict.REFUSE, "high", f"'{action}' is permanent or changes identity; the crew never performs it.")
    service = params.get("service")
    if action in READ_ACTIONS:
        if service is not None and service not in registered:
            return Decision(Verdict.REFUSE, "high", f"'{service}' is not a registered service.")
        return Decision(Verdict.ALLOW, "low", "Read-only within the registered scope.")
    if action in CHANGE_ACTIONS:
        if service not in registered:
            return Decision(Verdict.REFUSE, "high", f"'{service}' is not a registered service.")
        if action == "rollback_traffic" and not params.get("revision"):
            return Decision(Verdict.REFUSE, "high", "A rollback needs an explicit target revision.")
        return Decision(Verdict.REQUIRE_HUMAN, CHANGE_ACTIONS[action], "A change to a running service needs a person's approval of this exact action.")
    return Decision(Verdict.REFUSE, "high", f"'{action}' is not a known action.")
