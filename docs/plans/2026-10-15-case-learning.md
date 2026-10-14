# Unknown incident → human resolution → bounded recurrence response

Owner requirement: report an unfamiliar situation quickly, resolve it with a person, then respond immediately when the same or a similar situation recurs. Keep AI proposals, runbook authority and verified outcomes separate. This is required product work, not an optional feature.

## Implemented and verified locally on 15 October

The required lifecycle is now implemented in the contracts, server, web and native clients. Server-owned signals and five current safety checks fence human resolution; simulator read-back creates a seven-day candidate. Separate reviewer promotion activates an exact signal without execution or policy activation. Fresh telemetry reserves durable episode/quota claims before model calls; matching active case and current policy permit one typed simulated remedy. Reads/replay never start work. Revocation, expiry, unsafe/mismatched context and late responses escalate.

Latest full gate: gateway 204 / crew 97 / browser/axe/hosted/publish; Android core 67 (actual HTTP recovery lifecycle), app 3 and emulator 6, lint and restricted-key APK pass. Direct real Gemini two-call local smoke supports proposal/escalation behavior only; human reviewer steps were scripted, no deployed/physical-device/productivity claim. Native dialog screenshots are synthetic component tests.

## Required behavior

1. Unknown incident report: current simulated telemetry, evidence time, unmet runbook conditions, safe next step and visible human action. A provider timeout stays unknown. Read/refresh/replay cannot start remediation.
2. Guided resolution: the person selects an existing typed runbook; current reviewer authority, vehicle/version/episode, parked/temperature/battery/attempt limits are checked again. No arbitrary command, API URL, model-generated code or new permission is accepted. Record actual simulator before/after and remaining unknowns.
3. Candidate: only a completed, read-back resolution can create a case. Bind it to actor/workspace/vehicle, immutable server-produced signal and bounded safety conditions; use a bounded list and explicit expiry. Human prose alone is not successful execution evidence.
4. Promotion: a separate explicit reviewer action activates that exact candidate. It neither runs a remedy nor enables standing policy. A declined/expired/unknown/failed candidate cannot activate. Revocation is visible.
5. Recurrence: AI receives bounded matching case context and may propose the existing runbook. Similarity retrieves; it grants no authority. Guardian independently validates current signal, safety conditions, case scope/expiry, standing-policy expiry and one-attempt episode claim. Changed context or ambiguity escalates.
6. Automatic response must start from an authorized fresh telemetry incident under the configured policy, rather than requiring a diagnosis button each time. A diagnosis step is a bounded read/model call; any remediation still needs the policy or current human decision. Reserve durable episode claims and budget before provider calls; restart/unknown work never silently resends.
7. Report: automatic/human authorization, applied/cancelled/unknown outcome, before/after, learned-case reference and unresolved questions. Keep simulation visible and make disabling autonomy easy.

## Verification that proves the behavior

- First unknown incident cannot execute automatically, even if a model selects the reconnect runbook.
- Current human guided resolution/read-back produces one candidate; promotion executes zero changes.
- Repeated matching signal under active policy/case produces one remedy and one report without a new selection.
- Cross-actor/vehicle/workspace, stale version, unsafe temperature, non-parked state, expired case/policy, different signal and second episode attempt all refuse or escalate.
- Concurrent telemetry/diagnosis and duplicate request keys do not create duplicate executions. Lost provider/command replies are unknown and not retried.
- Web/native show the complete unknown → resolve → promote → recurrence → disable flow, loading/error states, correct language resources and scope clearing. Browser/native actual workflow verification is separate from unit tests.
- Retain the human/physical-device and deployed verification limits. A synthetic learned case is not a claim of real vehicle diagnosis or improved MTTR.

Personal-driver entitlement and compatible deployment are now complete; actual browser/provider workflow and distinct learned-case recurrence are recorded in STATUS. Remaining work is road-route feasibility, final signed-in/native visuals and judging artifacts. Ops keeps its own registered-resource/approval boundary.
