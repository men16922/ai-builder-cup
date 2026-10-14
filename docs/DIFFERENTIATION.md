# Aide's workflow and AI contribution

Aide helps a driver and a responder resume interrupted work. The driver sees the simulated vehicle's charging problem and the next safe step; the responder can investigate a registered Cloud Run service from a phone. These are two scoped workflows, not an implemented causal connection between a vehicle symptom and a backend incident. Vehicle policy never grants cloud authority.

The single submission theme is **Future of Work & Enterprise Productivity**. The principal work being reduced is repeated investigation, coordination and follow-up; driver assistance shows the customer-facing consequence of that product idea. The amount of work saved remains unmeasured.

## What the person does

| Workflow | Investigation | Decision and action | Evidence status |
| --- | --- | --- | --- |
| Manual Cloud Console workflow | Person reads service state, revisions, Monitoring and Logging and compares the signals | Person selects a recovery action, applies it and checks the traffic | Comparison protocol prepared; timed participant runs not recorded |
| Read-only AI explanation | An assistant explains supplied evidence | Person still applies and verifies the change through another tool | Conceptual reference, not a built or measured baseline |
| Aide | Chief delegates bounded reads and evidence interpretation; findings stream to the phone | Person reviews one exact proposal; Ops checks policy and signature, applies a rollback and reads back traffic | Deployed web and Android emulator runs recorded on 10–11 October; physical phone trial not recorded |

For simulated charging, an unfamiliar symptom leads to a human-authorized typed recovery and verified read-back. That creates a candidate, not immediate autonomy. Separate reviewer promotion plus an enabled 24-hour policy permits one attempt on a fresh matching incident. The actor, workspace, vehicle, signal, safety checks and expiry must still match. This lifecycle was exercised against the deployed runtime with scripted UI decisions; it is not a timed user trial.

This table compares responsibilities, not speed, accuracy or superiority over another product. No single-agent comparison has been performed. The number of agents is not evidence that delegation improves performance.

## Why Gemini matters

The user's instruction and incident evidence vary. Gemini chooses typed reads, relates request metrics to revision state and log text, and explains hypotheses and uncertainty. For mobility, Gemini interprets the instruction into a bounded Maps query or proposes a typed charging response. A model proposal alone cannot execute either remedy. Missing-data incidents, external dependency failures and faulty releases require different reports; the model's inference remains a hypothesis until supported by observations.

The policy table and signature checks enforce authority independently of interpretation. They are deterministic by design. A model may explain a verdict, but it cannot create credentials, widen scope or grant approval. This separation makes the judgement useful without treating model confidence as permission.

Code anchors: [`agents/chief.py`](../apps/crew/src/mobileops_agents/agents/chief.py), [`agents/diagnosis.py`](../apps/crew/src/mobileops_agents/agents/diagnosis.py), [`tools.py`](../apps/crew/src/mobileops_agents/tools.py), [`policy.py`](../apps/crew/src/mobileops_agents/policy.py), [`agent-tasks.ts`](../apps/gateway/src/crew/agent-tasks.ts).

## What is proved and what remains

- Existing recorded evaluation includes a first held-out score of 13/18, followed by fixes on the same cases. The later 18/18 shows those failures were fixed, not unseen-case performance.
- New 14 October results use real Gemini with synthetic Google API responses and in-process peers. They do not verify the deployed A2A topology or a physical phone. Source hashes and failures are preserved by `evals.qualification`.
- Applied traffic is an execution observation. It is not proof of customer recovery: metrics lag, and readiness is not service health.
- V2 now binds the exact action to reviewer, lease, grant UUID and reviewed service UID/etag/time. The gateway's durable claim replaces the per-instance execution ledger; Ops compares fresh state and makes one conditional PATCH. Local replay/state-drift regressions and isolated live Firestore contention pass. Compatible services and negative broker checks are deployed, but an actual V2 human-approved change and real etag conflict remain unverified. See [APPROVALS](APPROVALS.md).
- Signed-out visitors see a welcome and Google sign-in, with no public rehearsal or anonymous control. Personal simulation is actor-private; live cloud operations require registered ownership and current membership. Judges still need arranged access or a reviewed actual-run video.
- Real Google tiles and official Maps MCP places were verified in a deployed browser run. Movement remains straight-line simulation; physical steering, road-route geometry and native live tiles are not proven.
- The first deployed charging recurrence became unknown and did not resend. A later distinct successful incident is separate evidence, not a retry or reliability estimate. The test policy was disabled afterward.

## Evidence needed for the impact claim

Run the [human comparison](plans/2026-10-15-human-comparison.md), keeping the same incident and reset procedure. Report active human time separately from elapsed waiting time and time to a valid plan. Record wrong or uninformed approvals, and whether the participant understands that the target revision's health may be unconfirmed.

Two team members on one incident provide pilot evidence. Laptop/phone differences, repeated-task learning and team familiarity limit the conclusion. Until those measurements exist, the claim is a working delegation flow rather than a measured productivity improvement.
