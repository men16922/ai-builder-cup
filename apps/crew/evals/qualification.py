"""Bounded, append-only evidence runs. Real Gemini; synthetic Google API tools; no cloud changes.

Example: python -m evals.qualification --suite fresh --runs 1 --out fresh-first-20261014.json
An existing result file is never overwritten. Timeouts/errors are recorded as failures, not discarded.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import statistics
from datetime import datetime, timezone
from pathlib import Path

from evals.fresh_scenarios import FRESH, TELEMETRY_REGRESSIONS
from evals.run import JUDGE_MODEL, hard_checks, judge, run_once
from evals.scenarios import SCENARIOS
from mobileops_agents.config import RegisteredService, Settings, load_settings

ROOT = Path(__file__).resolve().parents[1]


def source_hashes() -> dict[str, str]:
    paths = sorted((ROOT / "src").rglob("*.py")) + sorted((ROOT / "evals").glob("*.py"))
    return {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}


async def main(suite: str, runs: int, out_name: str, timeout: int) -> int:
    base = load_settings()
    if not base.project:
        raise ValueError("GOOGLE_CLOUD_PROJECT must be explicitly configured")
    settings = Settings(project=base.project, model=base.model, reasoning_model=base.reasoning_model,
                        services=(RegisteredService("shop-api", "example-project", "asia-northeast3"),),
                        approval_key=b"eval-approval-key-0123456789abcdef")
    out = ROOT / "evals" / "results" / out_name
    report = {"suite": suite, "started_at": datetime.now(timezone.utc).isoformat(), "completed": False,
              "crew_model": settings.model, "judge_model": JUDGE_MODEL, "runs_per_scenario": runs,
              "scope": "Real Gemini with in-process agents and synthetic Google API responses. No live A2A, cloud mutation, human baseline or MTTR measurement.",
              "timeout_seconds_per_run": timeout, "max_concurrency": 2, "source_sha256": source_hashes(), "scenarios": []}
    # Claim the filename before any paid call. Never overwrite first results, even after interruption.
    with out.open("x") as handle:
        handle.write(json.dumps(report, indent=2) + "\n")

    def save():
        temporary = out.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
        temporary.replace(out)

    semaphore = asyncio.Semaphore(2)

    async def one(scenario):
        async with semaphore:
            try:
                async with asyncio.timeout(timeout):
                    run = await run_once(scenario, settings)
                    checks = hard_checks(scenario, run)
                    verdict = await judge(scenario, run)
                    return {**run, "hard_checks": checks, "judge": verdict,
                            "passed": all(checks.values()) and all(verdict["expectations"])}
            except Exception as error:
                # Upstream errors can include real project identifiers: record the type only.
                return {"passed": False, "error_type": type(error).__name__, "seconds": None,
                        "hard_checks": {}, "judge": {"expectations": [False] * len(scenario.must), "reason": "Run incomplete; no verdict."}}

    cases = {"fresh": FRESH, "telemetry": TELEMETRY_REGRESSIONS, "core": SCENARIOS}[suite]
    for scenario in cases:
        entry = {"id": scenario.id, "prompt": scenario.prompt, "expectations": scenario.must, "runs": [], "median_seconds": None}
        report["scenarios"].append(entry)
        save()

        async def record():
            result = await one(scenario)
            entry["runs"].append(result)
            measured = [run["seconds"] for run in entry["runs"] if run["seconds"] is not None]
            entry["median_seconds"] = statistics.median(measured) if measured else None
            save()

        await asyncio.gather(*(record() for _ in range(runs)))
        print(f"{scenario.id}: {sum(run['passed'] for run in entry['runs'])}/{runs}", flush=True)
    report["completed"] = True
    report["finished_at"] = datetime.now(timezone.utc).isoformat()
    save()
    results = [run for scenario in report["scenarios"] for run in scenario["runs"]]
    print(f"TOTAL {sum(run['passed'] for run in results)}/{len(results)}", flush=True)
    return 0 if all(run["passed"] for run in results) else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--suite", choices=("fresh", "telemetry", "core"), required=True)
    parser.add_argument("--runs", type=int, choices=(1, 2, 3), default=1)
    parser.add_argument("--timeout", type=int, choices=range(30, 301), default=180)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    if Path(args.out).name != args.out or not args.out.endswith(".json"):
        parser.error("--out must be a JSON filename inside evals/results")
    raise SystemExit(asyncio.run(main(args.suite, args.runs, args.out, args.timeout)))
