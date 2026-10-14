# Award-readiness plan — 14 October 2026

Goal: make Aide competitive under the official rubric, with evidence a judge can inspect. A prize cannot be guaranteed; there is no information about competing entries or a qualifying score.

15 October update: this is the historical pre-mobility assessment and original work order. Current requirement-by-requirement completion evidence is in [the final readiness audit](2026-10-15-final-readiness-audit.md); current deployment and V2 supersede the old per-instance-ledger statements below. No new numeric score is inferred from test counts.

Official sources checked on 14 October: [criteria and deliverables](https://aibuildercup.com/themes.html), [eligibility FAQ](https://aibuildercup.com/Faqs.html), [timeline](https://aibuildercup.com/). Submission closes on 18 October; freeze on the 17th.

## Assessment before this increment

| Criterion | Weight | Internal estimate | Evidence and missing work |
| --- | --- | --- | --- |
| Technical merit and Gen AI | 40 | 33 | Meaningful Gemini investigation, ADK/A2A, recorded live approved rollback, typed tools and policy. Missing: complete telemetry semantics, durable single-use claims, review-to-execution state binding, demonstrated advantage of delegation, per-task cost/latency. |
| Problem alignment and impact | 25 | 18 | Specific user: an on-call engineer away from a laptop. Missing: same-incident human comparison; synthetic model timing is not productivity gain or MTTR. |
| Innovation and creativity | 25 | 17 | Phone decisions plus independently enforced change authority. Multi-agent orchestration alone is not differentiation; show what this combination enables and compare it with a credible alternative. |
| UX and solution design | 10 | 8 | Shared Material 3 tokens, bilingual web and Android, accessibility checks, clear approvals. Missing: physical device and first-time user trial; friction-free access to evidence of the real crew. |
| Total | 100 | 76 | Subjective evidence assessment, not the organizer's score or a prize probability. |

## Work in score order

1. **Evidence honesty and technical gaps (engineering, 14 October).** Reproduce the missing-value-to-zero and metric pagination gaps; fix the collector and preserve coverage through Ops, Diagnosis and Chief. Run offline regression tests and real-model telemetry cases separately from fresh cases. Keep the first fresh result immutable, including failures/timeouts. Deployment is a separate verification step.
2. **Measure user benefit (two team members, 15 October).** Use `2026-10-15-human-comparison.md`: counterbalance manual/Aide order, reset the same incident, record time to valid plan, active human time, interactions, wrong approvals and understanding of uncertainty. With two participants this is pilot evidence only. Keep failed attempts and disclose laptop/phone differences and repeat-task learning. No claimed percentage improvement before measurement.
3. **Make differentiation explicit (engineering, 15 October).** Compare workflows: manual console investigation; a read-only AI explanation; Aide's delegated investigation plus an exact human decision and verified change. This is a capability comparison, not a competitive performance benchmark. Explain why interpretation needs Gemini and why authority is deterministic. Add task latency, call/token counts and measured cost only if the runtime actually records them.
4. **Close mobile and judge-access gaps (teammate/owner, 15–16 October).** Physical phone: sign-in, delegate, screen off, resume, approve, close/reopen, double tap. Record device model/date, no serial or account data. A clean signed-out browser must label rehearsal as synthetic. Provide a separate recorded real run and, if arranged with the organizers, allow-listed judge access. Never expose mutation rights publicly.
5. **Tighten approval guarantees (engineering, 15–16 October).** Current ledger is per-instance; `updateTime` is checked after the person's tap, not against proposal-time state, and the subsequent PATCH has no etag precondition. Reproduce concurrent/restart replay and a deploy between proposal and tap before choosing a minimal fix. Do not claim durable global single-use or fully fresh reviewed evidence until proved. Scope is one reversible traffic action.
6. **Freeze and submit (owner + engineering, 17–18 October).** Align README, deck, video and entry wording with the final evidence. Run offline gates; record any deployed revision separately. Fill actual links, upload the video (<3 minutes), attach the PDF, test access and confirm the dashboard's submission receipt. Publication, commit/push and submission still need the owner's explicit instruction.

## Eligibility and mandatory deliverables are separate gates

- Team registration is recorded as complete on 12 October; independently confirm the organizer dashboard before the 14 October team deadline.
- The FAQ requires a fresh project built during the program. The extraction manifest and a new Git history do not establish file creation dates. Reconcile the existing origin claim with source history, preserve the manifest, and seek organizer clarification if necessary. Do not assume eligibility from having never submitted before.
- A public repository is currently reachable at the same `main` SHA as local HEAD (`20cf3f2`, checked by `git ls-remote` on 14 October). This does not establish remote CI or deployment parity.
- Video upload, final links, judge access, physical phone evidence and organizer eligibility confirmation are not completed by local tests.

## Completion criteria

- Fresh results are disclosed as recorded; later fixes are labelled regressions. Hard rule checks and model judgements remain separate.
- A small human pilot supports the exact stated user benefit, with limitations visible on the impact slide.
- A first-time reviewer can distinguish rehearsal, real-model fixture evaluation and a recorded deployed run.
- The public narrative makes no stronger approval or reliability claim than the code and tests support.
- Mandatory files/links are present and readable, the final deployed candidate is checked, and the owner has a submission receipt.

Proceed with independent engineering/evidence work while human trials and eligibility/access answers are pending. Features such as voice, push, multi-cloud and a Dev agent stay outside the freeze.
