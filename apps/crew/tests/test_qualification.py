"""Evidence cannot erase a first result or drop a failed model call from the denominator."""
import json

import pytest

from evals import qualification
from evals.scenarios import Scenario
from mobileops_agents.config import Settings


@pytest.fixture
def evidence(tmp_path, monkeypatch):
    (tmp_path / "evals" / "results").mkdir(parents=True)
    monkeypatch.setattr(qualification, "ROOT", tmp_path)
    monkeypatch.setattr(qualification, "load_settings", lambda: Settings(project="example-project"))
    monkeypatch.setattr(qualification, "FRESH", [Scenario("fixture", "Inspect only.", [], ["reports the evidence"], {"propose": None})])
    return tmp_path / "evals" / "results" / "first.json"


async def test_existing_evidence_refuses_before_any_model_call(evidence, monkeypatch):
    evidence.write_text("original evidence")

    async def must_not_call(*args):
        pytest.fail("an existing result must be checked before any paid call")

    monkeypatch.setattr(qualification, "run_once", must_not_call)
    with pytest.raises(FileExistsError):
        await qualification.main("fresh", 1, "first.json", 30)
    assert evidence.read_text() == "original evidence"


async def test_model_failure_is_saved_and_included_in_the_denominator(evidence, monkeypatch):
    async def fails(*args):
        raise RuntimeError("private upstream project or credential must not enter evidence")

    monkeypatch.setattr(qualification, "run_once", fails)
    assert await qualification.main("fresh", 1, "first.json", 30) == 1
    report = json.loads(evidence.read_text())
    run = report["scenarios"][0]["runs"][0]
    assert report["completed"] and not run["passed"] and run["error_type"] == "RuntimeError"
    assert "private upstream" not in evidence.read_text()


async def test_rule_violation_fails_even_when_the_model_judge_passes(evidence, monkeypatch):
    async def violates(*args):
        return {"seconds": 1, "proposals": [{"revision": "invented"}], "api_calls": [], "paused_for_person": True, "final": "Looks good."}

    async def accepts(*args):
        return {"expectations": [True], "reason": "Accepted by model judge."}

    monkeypatch.setattr(qualification, "run_once", violates)
    monkeypatch.setattr(qualification, "judge", accepts)
    assert await qualification.main("fresh", 1, "first.json", 30) == 1
    run = json.loads(evidence.read_text())["scenarios"][0]["runs"][0]
    assert not run["hard_checks"]["no_change_proposed"] and not run["passed"]
