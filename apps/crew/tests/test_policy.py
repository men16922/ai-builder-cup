import time

import pytest

from mobileops_agents.approval import ApprovalError, action_digest, sign_approval, verify_approval
from mobileops_agents.policy import Verdict, evaluate

KEY = b"k" * 32
REGISTERED = {"shop-api"}
ACTION = {"action": "rollback_traffic", "service": "shop-api", "revision": "shop-api-00001"}


def test_reads_are_allowed_only_inside_the_registered_scope():
    assert evaluate("read_error_logs", {"service": "shop-api"}, registered=REGISTERED).verdict is Verdict.ALLOW
    assert evaluate("read_error_logs", {"service": "other"}, registered=REGISTERED).verdict is Verdict.REFUSE


def test_changes_need_a_person_and_dangerous_or_unknown_actions_are_refused():
    assert evaluate("rollback_traffic", {"service": "shop-api", "revision": "r1"}, registered=REGISTERED).verdict is Verdict.REQUIRE_HUMAN
    assert evaluate("rollback_traffic", {"service": "shop-api"}, registered=REGISTERED).verdict is Verdict.REFUSE
    for action in ("delete_service", "set_iam_policy", "drop_everything"):
        assert evaluate(action, {"service": "shop-api"}, registered=REGISTERED).verdict is Verdict.REFUSE


def test_a_valid_approval_verifies_for_exactly_the_approved_action():
    approval = sign_approval(KEY, ACTION, "user-1").to_dict()
    assert verify_approval(KEY, ACTION, approval).actor == "user-1"
    with pytest.raises(ApprovalError, match="different action"):
        verify_approval(KEY, {**ACTION, "revision": "shop-api-00009"}, approval)


def test_forged_expired_and_missing_approvals_are_rejected():
    approval = sign_approval(KEY, ACTION, "user-1", ttl_seconds=60, now=time.time() - 120).to_dict()
    with pytest.raises(ApprovalError, match="expired"):
        verify_approval(KEY, ACTION, approval)
    fresh = sign_approval(KEY, ACTION, "user-1").to_dict()
    with pytest.raises(ApprovalError, match="signature"):
        verify_approval(KEY, ACTION, {**fresh, "actor": "attacker"})
    with pytest.raises(ApprovalError, match="signature"):
        verify_approval(b"x" * 32, ACTION, fresh)
    for bad in (None, {}, "approved", {"digest": "x"}):
        with pytest.raises(ApprovalError):
            verify_approval(KEY, ACTION, bad)
    with pytest.raises(ApprovalError):
        verify_approval(b"", ACTION, fresh)
    assert action_digest(ACTION) == action_digest(dict(reversed(list(ACTION.items()))))
