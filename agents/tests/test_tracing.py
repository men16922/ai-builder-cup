from mobileops_agents.tracing import setup_tracing


def test_tracing_is_off_unless_explicitly_enabled(monkeypatch):
    monkeypatch.delenv("OPS_TRACE_TO_CLOUD", raising=False)
    assert setup_tracing() is False
    monkeypatch.setenv("OPS_TRACE_TO_CLOUD", "0")
    assert setup_tracing() is False
