# Next plan

Open work only. Live status: `docs/STATUS.md`. Submission checklist: `submission/SUBMISSION.md`.

Plan of 2026-10-11, built from an external review (`FEEDBACK.md`). The review's code claims were checked against the repository before they were adopted (see "Verified claims"). Direction: do not add features; make what exists trustworthy and show the evidence. Deadline 18 Oct 2026; freeze the submission on the 17th and keep the 18th for upload and access checks.

## Done in code (2026-10-11, not yet deployed)

- P1 and P2 are implemented and covered by 54 crew tests (`make check-all` passes: gateway 167, crew 54, browser flows): five execution states with HTTP 200/202/403/502/504; an accepted but unfinished change is `pending`, never a 403; transport loss or a 5xx on the change request is `unknown` and never resent; the Chief reports each state exactly. Approvals are single-use per instance, refused when the service's `updateTime` is later than the approval's issue time (holds across instances and restarts), and refused when the signed window exceeds five minutes. `ARCHITECTURE.md` and `README.md` now match the code and carry a verification table.
- Deployed 2026-10-11: crew image `crew:20261011-162755` to the four agent services and the gateway (step summaries show `pending: ...` and `unknown`). Evaluation recorded in `docs/EVALUATION.md`: the six tuned scenarios 18/18 after the changes; six held-out cases (dependency outage, thin evidence, disagreeing signals, rollback still running, unknown outcome, deploy after approval) scored 13/18 on the first run, exposing that the crew did not flag tiny samples or disagreeing signals; the Chief instruction was changed and the same cases then scored 18/18 (no longer held out).
- Done 2026-10-11 (web chip deployed in the gateway image; Android not reinstalled on the emulator yet): the web timeline shows a state chip on the change result (applied, in progress, outcome unknown, failed, refused; Korean and English); the Android task screen shows the same states as bold colored lines, with a parser test (`executionState`), assemble and lint passing.
- Live run on the deployed services, 2026-10-11 (signed-in browser, demo target `shop-api` set to `shop-api-bad` with generated traffic): the crew investigated, Guardian required a person, the approval card said the earlier revision's health is not confirmed, one approval applied the rollback (`/execute` 200, `status=applied`, traffic read back as 100% `shop-api-good`), and the report showed the "Applied and confirmed" chip. The first live attempt exposed a flaw in my own instruction change (no rollback was offered when the earlier revision had no samples); it was fixed, evaluated (2/3 before, 3/3 after, no regression on the held-out or tuned cases) and redeployed. `shop-api` was set back to `shop-api-bad` afterwards.
- Remaining for P1/P2: a live replay of the same approval (needs the signing key or a second sign-in session; covered offline by tests), `pending`/`unknown` seen live (needs a slow or failing Cloud Run change), reinstalling the Android debug build to see the new state lines.

## Verified claims (2026-10-11)

- **A, in-progress rollback reported as refused (confirmed).** `gcp/cloud_run.py` `rollback_traffic()` polls the Cloud Run operation 20 times at 1 s and then returns `applied: false, operation_done: false`. `tools.py` turns that into `executed: false`, `serve.py` answers 403 for anything not executed, and `executor.py` words it as "The Ops service refused the request (403)". A change Cloud Run accepted but had not finished within 20 s is shown as refused. This contradicts "never report unfinished work as done, never report executed work as not executed".
- **B, approval reuse (confirmed, and the docs disagree).** Ops verifies signature, action digest and expiry only. `docs/ARCHITECTURE.md` says an approval is reusable for five minutes; the module docstring and README say the model cannot reuse one. A second deploy after a rollback plus a still-valid approval could move traffic back.
- **C, background work and restart (partly confirmed).** `serve.py` keeps only the in-memory A2A task store. The Cloud Run CPU setting for background work after the HTTP response and the behaviour when the app is backgrounded or the Ops service restarts while waiting for approval have not been tested.
- **README (confirmed stale).** `README.md` line 85 says the Android crew screen has not run against the live server; `docs/STATUS.md` records the 2026-10-11 emulator run. The README has no one-glance verification table.

## Priority 1: correctness of execution state (2026-10-12 to 13, engineering)

1. **Five execution states.** Replace the boolean with `refused | pending | applied | failed | unknown` across the crew result, `/execute`, the gateway task model, `packages/contracts`, the web report and the Android parser.
   - `refused` (policy, signature, expiry, registration): HTTP 403, and the report says no change request was sent.
   - `pending`: Cloud Run accepted the change but the operation is not done. HTTP 202 with the operation id kept. Never 403.
   - `applied`: operation done and the traffic split re-read matches the approved target.
   - `failed`: the operation finished with an explicit error. Show the error code and the re-read state.
   - `unknown`: transport loss after dispatch. Never resend; resolve by reading only.
2. **Status lookup that only reads.** A fixed typed read (operation id plus a traffic re-read) the Chief can call to move `pending`/`unknown` to a final state. It must never start a change. Android and web poll it; the report keeps "still unknown" until it resolves.
3. **Tests.** Fake Cloud Run: slow operation, explicit failure, connection drop after dispatch, drifted traffic after "done". Assert each maps to the right state and that no second PATCH is ever sent. Extend the 13 HTTP attack tests accordingly.

## Priority 2: approvals bound to the environment (2026-10-12 to 14)

1. **Single use.** The gateway records an approval id at the execution boundary with an atomic claim (Firestore create-if-absent, outside any retryable transaction). A repeated request returns the stored outcome and sends nothing. A claimed-but-unresolved claim reads as `unknown`, never retried.
2. **Bind to what was reviewed.** Put the reviewed Cloud Run `etag`/generation and expected current traffic into the signed digest. If either changed before execution, refuse with "the service changed since you approved; review again". Never act on a stale approval.
3. **Words match code.** Update `ARCHITECTURE.md`, the `approval.py` docstring and the README together, and remove the "known limit" note only when the code makes it true.
4. **Tests.** Double submit, replay after a second deploy, replay after expiry, borrowed approval for another service.

## Priority 3: mobile and restart behaviour (2026-10-13 to 14)

Done 2026-10-12 (`docs/EVALUATION.md`, "Mobile and restart behaviour"): P3.1 needs no change (the gateway already runs with instance-based CPU; the task record lives in Firestore and the app only reads it). P3.2(b) run live with real data: the Chief was redeployed while an approval was pending; the approval ended as `unknown`, nothing was sent or retried, traffic stayed on `shop-api-bad`. P3.2(a) on a phone and P3.3 remain with the Android teammate (`apps/android/ONBOARDING.md`, step 7).

1. **Cloud Run settings.** Decide and document the CPU allocation the deployment needs for work that continues after the HTTP response (instance-based CPU or a Cloud Tasks/Run job style handoff). Change the deployment only if the test below fails; it is within the existing authorization but costs more, so state the cost.
2. **Live tests, recorded in `docs/EVALUATION.md`:** (a) start a task, background the app or turn the screen off, return: state correct; (b) restart the Ops/Chief service while an approval is pending: the task ends as resumed or as an explicit expired/failed state, never silently lost. If A2A in-memory state is lost, the gateway task record must say so rather than show "running" forever.
3. **Physical Android device** (owner or the Android teammate): Google sign-in, delegate, approve, result, close and reopen, double tap on approve. Record the date and device model (not a serial number).

## Priority 4: evidence for judges (2026-10-15 to 16)

1. **Done 2026-10-11 (see above). Held-out cases, run once and recorded as they came out** (add to `apps/crew/evals`, do not tune afterwards): external dependency failing with the previous revision also failing (must not roll back); very low traffic or contradictory metrics (must state the uncertainty); another deploy while an approval is pending (must re-review); slow or dropped change (must report `pending`/`unknown`, not a guess).
2. **Human comparison.** Protocol ready: `docs/plans/2026-10-15-human-comparison.md`. The same incident done manually and with Aide by a teammate who has not used it: time to first valid recovery plan, number of manual operations, wrong approvals, and time the person was actually working versus waiting. Report the numbers with the sample size. Do not present the 42.8 s median (`bad_release`, synthetic) as MTTR.
3. **Wording.** Done 2026-10-12: the first user is named in the README, Devpost, Medium and the deck; no "100% safe/accurate" claims. Keep "regression-tested on six scenarios and the observed failures fixed"; never "100% safe" or "100% accurate". Name the first user: an on-call engineer or small-team tech lead who is away from a laptop. Lead the pitch with what the person no longer has to do, not with the number of agents.

## Priority 5: submission surface (2026-10-12 start, freeze 17th)

1. Done 2026-10-12 (table in README, STATUS refreshed, implemented/published columns in `submission/SUBMISSION.md`). README top: a verification table (web + Cloud Run read and approved rollback: recorded live; Android emulator against the live server: recorded 2026-10-11; physical device: update after P3; real push: off in the deployment, not verified; signed-out page: synthetic rehearsal, no model call; demo video: link once uploaded). Fix line 85. Keep "implemented" and "published" as separate checkboxes in `submission/SUBMISSION.md`.
2. Judge access: keep the public rehearsal and add a clearly separate route to the real deployment (allow-listed judge Google accounts on an isolated registered service, or a recorded real run). Never expose change permission publicly.
3. Done 2026-10-12: README "After the submission". Move Dev Agent PRs, multi-cloud and extra operations to a post-submission roadmap section.
4. Done 2026-10-12 for P1 to P3 (deck rebuilt; Devpost and Medium updated); repeat after the physical-device run and the human comparison. Regenerate the deck and Devpost/Medium text after P1 to P4 change any claim; re-run `make check-all` and the publish gate before every push.

## Owner actions (not engineering)

1. ~~Confirm the team registration and the invitation acceptances.~~ Done (owner confirmed 2026-10-12). The organizers extended the team deadline to 14 Oct; finish it as soon as the teammate joins and check the exact cutoff time and time zone in the portal.
2. Watch `submission/aide-demo-final.mp4`, upload it, keep the link. Re-record if P1 to P3 change what the demo shows (the report wording for pending/unknown, the approval card).
3. Fill `<VIDEO_URL>`, `<DEPLOYED_URL>`, `<REPO_URL>`, `<CONTACT>` in `submission/DEVPOST.md` and `submission/MEDIUM.md`, then submit the Devpost entry with `submission/deck/deck.pdf`.
4. Decide judge access (P5.2). Confirm that the pre-program origin of the code is acceptable under the official rules (still open in `docs/STATUS.md`).
5. Brief the Android teammate (joins Monday 12 Oct; guide and setup check in `apps/android/ONBOARDING.md`, `apps/android/scripts/doctor.sh`; owner still has to hand over the private config, register the teammate's debug SHA-1 in Firebase and allow their Google account on the registered service): "Use the app on a physical device like a first-time on-call operator, from sign-in to the result after approval, including closing and reopening and double approval; fix what blocks you."

## Division of work

| Who | Work | Done when |
| --- | --- | --- |
| Owner + engineering session | P1, P2, P3.1/P3.2, held-out cases, README and docs | pending/refused/failed/unknown are distinct; a reused or stale approval cannot move traffic; tests prove both |
| Android teammate | P3.3 on a physical device, parsing of the new states, first-user usability | whole flow on a real device with defects fixed |
| Together | human comparison, final English demo check | a first-time viewer understands what they approve and where to check the result |

## Schedule

- 11 Oct: verify claims (done); this plan. Team registration is open until 14 Oct.
- 12 to 14 Oct: P1, P2, P3; teammate starts the device run.
- 15 to 16 Oct: held-out evaluation, human comparison, README table, re-record the demo if needed.
- 17 Oct: freeze; deck and text regenerated; final checks; upload and push (only on the owner's request).
- 18 Oct: upload, access and submission confirmation only.

## Kept as optional or after submission

- Web Agent Chat does not follow tasks started on another device until reload; poll the task list.
- Treat the omitted `reconciling` boolean from Cloud Run v2 (open finding in `docs/STATUS.md`); live reads stay "incomplete" until decided. It also weakens the live demo, so decide it with P1.
- Notifications are off in the deployment (needs min instances 1 and always-on CPU, then a real FCM send).
- Connect any project instead of the registered services; multi-cloud; Dev Agent PRs; more operations.
