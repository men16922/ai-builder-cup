"""Writes docs/EVALUATION.md from the recorded result files. Numbers come straight from the JSON; nothing is typed by hand."""
from __future__ import annotations

import json
from pathlib import Path

root = Path(__file__).parent
docs = root.parents[2] / "docs" / "EVALUATION.md"


def load(name: str) -> dict | None:
    path = root / "results" / name
    return json.loads(path.read_text()) if path.exists() else None


def row(scenario: dict) -> str:
    runs = scenario["runs"]
    return f"| `{scenario['id']}` | {sum(r['passed'] for r in runs)}/{len(runs)} | {scenario['median_seconds']} s |"


def table(report: dict) -> str:
    return "| Scenario | Passed | Median time |\n| --- | --- | --- |\n" + "\n".join(row(s) for s in report["scenarios"])


def failures(report: dict) -> list[str]:
    lines = []
    for scenario in report["scenarios"]:
        for index, run in enumerate(scenario["runs"]):
            if run["passed"]:
                continue
            hard = [name for name, ok in run["hard_checks"].items() if not ok]
            unmet = [text for text, ok in zip(scenario["expectations"], run["judge"]["expectations"]) if not ok]
            lines.append(f"- `{scenario['id']}` run {index + 1}: " + ("rule checks failed: " + ", ".join(hard) + "; " if hard else "") + ("expectation not met: " + "; ".join(unmet) if unmet else ""))
    return lines


def total(report: dict) -> str:
    runs = [r for s in report["scenarios"] for r in s["runs"]]
    return f"{sum(r['passed'] for r in runs)}/{len(runs)}"


# Every recorded round is shown, oldest first, so improvements cannot hide earlier failures.
rounds = [("First run", load("baseline-run1.json")), ("After the first instruction fix", load("after-tightening-run2.json")), ("After the second instruction fix", load("after-tightening-run3.json")), ("After the third instruction fix", load("latest.json"))]
rounds = [(name, report) for name, report in rounds if report]
seen: list[str] = []
out = ["# Agent evaluation", "",
       "Six scenarios run the real Gemini crew (Chief, Ops, Diagnosis, Guardian) against fixed, synthetic Google API data. Each scenario runs several times because model behavior varies.", "",
       "- **Rule checks** are exact: which tool calls and arguments the Chief made, whether any change was applied without an approval, and whether any request touched a service or revision it must not.",
       "- **Expectations** in plain language are graded by a different, stronger model than the crew, with a strict rubric.",
       "- A run passes only when every rule check and every expectation passes.", "",
       "Reproduce with `cd agents && python -m evals.run --runs 3` (needs Vertex AI access) and `python -m evals.report`.", ""]
for name, report in rounds:
    fingerprint = json.dumps([[r["final"] for r in s["runs"]] for s in report["scenarios"]])
    if fingerprint in seen:
        continue
    seen.append(fingerprint)
    out += [f"## {name}: {total(report)} passed", "", f"Crew model `{report['crew_model']}`, judge `{report['judge_model']}`, {report['runs_per_scenario']} runs per scenario.", "", table(report), ""]
    miss = failures(report)
    out += (["What failed, as recorded:", ""] + miss + [""]) if miss else ["Every recorded run passed.", ""]
out += ["## Limits", "",
        "- Six scenarios and a few runs each are a smoke test of safety behavior, not a benchmark.",
        "- The agent instructions were tightened between rounds using these same scenarios, so later scores are not held-out results. They show that the recorded failures were fixed, not how the crew performs on unseen cases.",
        "- The judge is a model; its verdicts can be wrong in either direction. The rule checks are the hard evidence.",
        "- The data is fixed and synthetic. Real services return messier evidence.", ""]
docs.write_text("\n".join(out))
print(f"wrote {docs}")
