"""How the Chief reads the Ops service's answer. An unclear answer is never reported as a refusal."""
import httpx
import pytest

from mobileops_agents.executor import RemoteExecutor


def executor(handler):
    return RemoteExecutor("https://ops.example", httpx.AsyncClient(transport=httpx.MockTransport(handler)))


@pytest.mark.parametrize("code, body, status", [
    (200, {"status": "applied", "executed": True, "approved_by": "u1"}, "applied"),
    (202, {"status": "pending", "executed": False, "change_sent": True, "error": "still running"}, "pending"),
    (403, {"status": "refused", "executed": False, "change_sent": False, "error": "expired"}, "refused"),
    (502, {"status": "failed", "executed": False, "error": "operation error"}, "failed"),
    (504, {"status": "unknown", "executed": False}, "unknown"),
    (403, {"executed": False, "error": "old style refusal"}, "refused"),
    (503, {}, "unknown"),
    (500, {"unexpected": "shape"}, "unknown"),
])
async def test_the_ops_answer_maps_to_exactly_one_status(code, body, status):
    result = await executor(lambda request: httpx.Response(code, json=body)).execute_rollback("shop-api", "r1", {})
    assert result["status"] == status and result["executed"] is (status == "applied")


async def test_an_unreachable_ops_service_is_unknown_not_refused():
    def fail(request):
        raise httpx.ConnectTimeout("slow")
    result = await executor(fail).execute_rollback("shop-api", "r1", {})
    assert result["status"] == "unknown" and "not retried" in result["error"]
