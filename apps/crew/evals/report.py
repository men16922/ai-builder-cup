"""Writes docs/EVALUATION.md from the recorded result files. Numbers come straight from the JSON; nothing is typed by hand."""
from __future__ import annotations

import json
import re
from pathlib import Path

root = Path(__file__).parent
docs = root.parents[2] / "docs" / "EVALUATION.md"
# Live/human evidence is maintained by people, not produced by fixture evaluations.
manual_sections = re.findall(r"^## (?:Mobile and restart behaviour|Human comparison).*?(?=^## |\Z)", docs.read_text() if docs.exists() else "", re.MULTILINE | re.DOTALL)


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
rounds = [("First run", load("baseline-run1.json")), ("After the first instruction fix", load("after-tightening-run2.json")), ("After the second instruction fix", load("after-tightening-run3.json")), ("After the third instruction fix", load("after-tightening-run4.json")), ("After the execution-state change (new Chief wording for pending, unknown and refused; same six scenarios)", load("after-execution-states.json")), ("After the evidence-handling instruction (small samples, disagreeing signals; same six scenarios)", load("latest.json")), ("After the live-run fix (earlier revision without samples; same six scenarios)", load("core-after-live-fix.json"))]
rounds = [(name, report) for name, report in rounds if report]
seen: list[str] = []
out = ["# Agent evaluation", "",
       "Six scenarios run the real Gemini crew (Chief, Ops, Diagnosis, Guardian) against fixed, synthetic Google API data. Each scenario runs several times because model behavior varies.", "",
       "- **Rule checks** are exact: which tool calls and arguments the Chief made, whether any change was applied without an approval, and whether any request touched a service or revision it must not.",
       "- **Expectations** in plain language are graded by a different, stronger model than the crew, with a strict rubric.",
       "- A run passes only when every rule check and every expectation passes.", "",
       "Reproduce with `cd apps/crew && python -m evals.run --runs 3` (needs Vertex AI access) and `python -m evals.report`.", ""]
for name, report in rounds:
    fingerprint = json.dumps([[r["final"] for r in s["runs"]] for s in report["scenarios"]])
    if fingerprint in seen:
        continue
    seen.append(fingerprint)
    out += [f"## {name}: {total(report)} passed", "", f"Crew model `{report['crew_model']}`, judge `{report['judge_model']}`, {report['runs_per_scenario']} runs per scenario.", "", table(report), ""]
    miss = failures(report)
    out += (["What failed, as recorded:", ""] + miss + [""]) if miss else ["Every recorded run passed.", ""]
for title, name, note in [("Held-out cases, first run", "held-out-first-run.json",
                           "Six cases written after the last instruction fix and never used to tune the crew: the earlier revision is failing too, very thin evidence, metrics that disagree with logs, a rollback that is still running after approval, a change request whose outcome is unknown, and a deploy made after the person approved. They were run once (three runs each) and the result is recorded as it came out; the three cases after approval use a fake Cloud Run and a valid signature made by the harness."),
                          ("The same cases after the evidence-handling instruction", "held-out.json",
                           "The first run exposed two gaps (the crew did not say a sample was tiny and did not point out that metrics and logs disagreed), so the Chief instruction was changed and the same cases were run again. These cases are therefore no longer held out: this round shows the recorded failures were fixed, not performance on unseen cases.")]:
    held = load(name)
    if held:
        out += [f"## {title}: {total(held)} passed", "", note, "", f"Crew model `{held['crew_model']}`, judge `{held['judge_model']}`, {held['runs_per_scenario']} runs per scenario.", "", table(held), ""]
        miss = failures(held)
        out += (["What failed, as recorded:", ""] + miss + [""]) if miss else ["Every recorded run passed.", ""]
for title, name, note in [("Case found in the first live run, before the fix", "live-finding-first-run.json",
                           "On 2026-10-11 the first live run on the deployed services did not offer a rollback: with all traffic on the failing revision the earlier one has no recent samples, and the instruction added that day required a healthy earlier revision. This case reproduces that situation with fixed data. It was written after the finding, so it is not a held-out case."),
                          ("The same case after the fix, and the held-out cases again", "live-finding-after-fix.json",
                           "The Chief instruction now proposes the reversible rollback when the earlier revision is Ready and has no recorded failures, says its health is not confirmed, and stops searching for a baseline. The six held-out cases were run again to check for regressions."),
                          ("Held-out cases after the live-run fix", "held-out-after-live-fix.json", "")]:
    extra = load(name)
    if extra:
        out += [f"## {title}: {total(extra)} passed", ""] + ([note, ""] if note else []) + [table(extra), ""]
        miss = failures(extra)
        out += (["What failed, as recorded:", ""] + miss + [""]) if miss else ["Every recorded run passed.", ""]
for title, filename, note in [
    ("Fresh qualification, first run (2026-10-14)", "fresh-first-20261014.json", "Six new cases, one run each, frozen after the telemetry fix and before this first execution. No agent instruction was tuned on these outcomes. This is a small unseen-case smoke test, separate from the original held-out 13/18."),
    ("Telemetry collector regressions (2026-10-14)", "telemetry-first-20261014.json", "Two cases target known defects: a paginated success-only response and a missing error-count value. These are regression checks after the fix, not held-out cases."),
    ("Core regression after telemetry coverage change (2026-10-14)", "core-regression-20261014.json", "The original six tuned cases, one run each. This is regression evidence, not an unseen-case score or a new 18-run benchmark."),
]:
    report = load(filename)
    if report:
        out += [f"## {title}: {total(report)} passed", "", note, "", report["scope"], "",
                f"Crew model `{report['crew_model']}`, judge `{report['judge_model']}`. Completed: `{report['completed']}`. Source SHA-256 hashes and per-attempt results: `{filename}` (local run record held back from Git; request privately as described in REMOTE_HANDOFF.md).", "", table(report), ""]
        for scenario in report["scenarios"]:
            for index, run in enumerate(scenario["runs"]):
                if run.get("error_type"):
                    out += [f"- `{scenario['id']}` attempt {index + 1}: `{run['error_type']}`, recorded as failed; it remains in the denominator.", ""]
        miss = failures(report)
        if miss:
            out += ["What failed, as recorded:", ""] + miss + [""]
out += [section.rstrip() + "\n" for section in manual_sections]
out += ["## Limits", "",
        "- Small scenario suites with a few runs each are smoke tests of behavior, not a benchmark.",
        "- Agent instructions were tightened between older rounds using those same cases. Later scores show the recorded failures were fixed. The original first held-out run and the separate fresh qualification are the unseen-case results; both samples are small.",
        "- The judge is a model; its verdicts can be wrong in either direction. The rule checks are the hard evidence.",
        "- The data is fixed and synthetic. Real services return messier evidence.", ""]
docs.write_text("\n".join(out))
print(f"wrote {docs}")
