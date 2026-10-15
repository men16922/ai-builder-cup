# Aide

> **Your day, handled. Ask your own Aide.**

Aide gives drivers a personal aide and responders an accountable Google Cloud crew. Ask in your own words, review proposed vehicle actions, discover real places, or let My Aide handle a fictional call and prepare follow-up drafts. A separate ADK/A2A crew investigates registered Cloud Run services and escalates real change decisions. Vehicle/call simulation and cloud operations retain independent data and authority.

Vehicle and driving control are **simulated**. Known approved charging cases can act once under a current bounded policy; unfamiliar symptoms need guided human resolution and separate case approval. That vehicle policy grants no authority over real Cloud Run services.

Built for the AI Builder Cup 2026, theme *Future of Work & Enterprise Productivity*. B2C goal: fewer interrupted journeys. Enterprise goal: less investigation and coordination work. A timed human or single-agent comparison has not been completed, so there is no measured productivity or accuracy advantage claim.

## For drivers

1. Sign in with Google and connect your actor-private simulated Aide EV. Personal vehicle access does not require Cloud Run ownership.
2. Find a charger, dinner or a nearby place. Gemini plans a bounded query; Maps MCP supplies source-linked places. Choose the first destination. A Favorite or matching seven-day remembered choice may handle a later request. Movement is visibly straight-line simulation with cancellation.
3. When an unfamiliar charging-link symptom arrives, review five current safety checks and authorize one existing typed simulated reconnection. Actual simulator read-back creates a candidate; separate reviewer promotion neither runs a remedy nor enables autonomy.
4. An active seven-day case and explicitly enabled 24-hour policy can handle a fresh matching incident once, then report. Different/unsafe evidence, expiry or an unknown provider outcome escalates. Disable or revoke anytime.
5. Ask "Cool the car to 20 before I leave." Gemini proposes; each server-validated tap acts on the simulated vehicle. Lock, climate, charge limit, lights and horn have focused controls.
6. My Aide can answer a fictional caller, summarize the conversation and prepare message/calendar drafts. A completion tap is simulated; no real dialing, delivery or calendar write occurs. Missing content, recipient or future schedule cannot become a completed follow-up. Final live draft qualification remains open.

## For cloud responders

1. **Ask.** Type "Customers say checkout is failing. Handle it." in the console's assistant panel or the top bar.
2. **The crew works.** The **Chief** agent delegates over the [A2A protocol](https://a2a-protocol.org) to specialists and streams every step back:
   - **Ops** reads Cloud Run, Cloud Monitoring and Cloud Logging through typed, read-only tools.
   - **Diagnosis** turns the evidence into ranked hypotheses and states what it cannot see.
   - **Guardian** classifies any proposed action with a deterministic policy table that sits outside the model.
3. **You decide.** For a change, the task pauses (`input-required`) and shows an approval card with the exact action, the risk and the reason.
4. **It applies and verifies.** After approval the Ops service rolls traffic back to the approved earlier revision, then the crew re-reads the service and reports honestly, including when the target revision's health is unconfirmed and what metrics cannot show yet.

## Architecture

```
Android app (Compose Material 3)        Web console (Material Web, Cloud Console style)
        │   chat · approval cards             dashboard · Gemini-style assistant panel
        ▼
Gateway  (TypeScript, Cloud Run)  Firebase identity · owner/workspace/role checks · task store (Firestore)
        ├── Driver: Gemini proposals/calls + Google Maps MCP + actor-private simulated vehicle
        │
        └── Responder: A2A JSON-RPC streaming, Cloud Run identity tokens
              Chief agent  (Python, ADK 2.11, Gemini)
                ├── A2A → Ops        reads registered evidence; redeems an approved typed rollback
                ├── A2A → Diagnosis  hypotheses, unknowns, next step
                └── A2A → Guardian   allow / require_human / refuse (policy outside the model)
```

Every agent is its own private Cloud Run service with its own least-privilege service account. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Why a model cannot talk its way into a change

- **Typed tools only.** Agents choose among a fixed set of functions. They never receive credentials and never generate code to run.
- **Signed human approval.** V2 source binds a reviewer decision to exact action, five-minute lease and reviewed UID/etag/timestamps. Ops redeems a durable gateway grant once before one conditional PATCH. Explicit mutation targets are separate from read ownership. Compatible V2 gateway/Ops are deployed; actual human-approved claim/conflict still needs verification. Limits are in [APPROVALS](docs/APPROVALS.md).
- **Two independent checks.** The Chief checks policy before asking you, and the Ops service re-checks policy and the signature before it touches Cloud Run. The mutation right is scoped to one service, not the project.
- **Honest about missing data.** Empty metrics are "unknown", never zero and never healthy. Log text is treated as untrusted data, so instructions hidden in logs are not followed.
- **No automatic resend.** A lost connection or an unknown outcome is shown as unknown. A change is never retried by the system. An accepted change that is still running is reported as pending, never as refused.

## Access

The signed-out page explains the product and offers Google sign-in. It has no synthetic rehearsal controls or private API reads. Personal drivers own only their private simulated state; organization work requires current server-verified membership, and operational crew access additionally follows registered service ownership. Judges need a recorded actual run and/or an organizer-arranged allowed account for cloud operations.

## Evaluation

Six scenarios (bad release, healthy service, no data, prompt injection in logs, destructive request, unregistered service) run against the real Gemini crew with fixed data. Results and what was fixed are in [docs/EVALUATION.md](docs/EVALUATION.md).

The [workflow comparison](docs/DIFFERENTIATION.md) explains the person's work and Gemini's contribution. A timed human comparison and a single-agent comparison have not been completed, so there is no measured productivity or multi-agent advantage claim.

## Repository map

Each app has its own README. Everything TypeScript shares one `package.json` at the root; the Python crew and the Android app have their own toolchains.

Continuing from a remote checkout? Read the [handoff checklist](docs/REMOTE_HANDOFF.md) for the private configuration and uncompleted validation that Git cannot supply.

| Path | What it is |
| --- | --- |
| [`apps/web`](apps/web) | The console: React and Material Web, Google Cloud Console style, Korean and English |
| [`apps/gateway`](apps/gateway) | TypeScript API on Cloud Run: sign-in, ownership checks, task store, bridge to the crew, notifications |
| [`apps/crew`](apps/crew) | The agents (Python, ADK, A2A): Chief, Ops, Diagnosis, Guardian, plus the evaluation harness |
| [`apps/android`](apps/android) | Android client (Kotlin, Compose Material 3) |
| [`apps/shop-api`](apps/shop-api) | A small storefront with a healthy and a faulty revision. It is the service the crew operates on in the demo |
| [`packages/contracts`](packages/contracts) | Zod schemas and types shared by the web, the gateway and the Android fixtures |
| [`design`](design) | One Material 3 token file that generates the web CSS and the Android colors |
| [`deploy`](deploy) | The gateway Dockerfile and example configuration files |
| [`docs`](docs) | Architecture, evaluation, deployment, submission material and the deck |
| [`scripts`](scripts) | Build and generator tooling and the publish gate |
| [`tests`](tests) | Browser flows (`tests/browser`) and the synthetic data they share (`tests/support`) |

## Run it

Prerequisites: Node.js 24+, Python 3.11+, a Google Cloud project with Vertex AI, Cloud Run, Firestore and Firebase Authentication enabled. Nothing here uses a stored key; local runs use your own Application Default Credentials.

```sh
npm ci
make check        # typecheck, gateway tests, browser flows, token and fixture drift, publish gate (offline, synthetic data)
make check-agents # Python crew tests (uses .tools/venv-agents; see apps/crew/README.md)
npm run dev       # loopback UI only; configure AIDE_DEV_API_ORIGIN explicitly for authenticated API use
```

How to build and deploy is in [docs/DEPLOY.md](docs/DEPLOY.md). Real identifiers, configuration and credentials never enter the repository; `npm run check:publishable` enforces that before anything is published.

## What is verified

| Area | State |
| --- | --- |
| Web console and crew on the deployed Cloud Run services: read, propose, signed approval, rollback, report | Run live on 2026-10-10 and 2026-10-11 (recorded in `docs/STATUS.md`) |
| Execution states and V2 reviewed-state/durable claim protocol | Historical V1 applied/read-back on 11 October; compatible V2 deployed with negative broker probes and isolated Firestore claim contention. Actual human-approved V2 mutation and real conflict remain unverified. Current source/evidence scopes are in `docs/STATUS.md` and `docs/APPROVALS.md` |
| Chief restarted while an approval is pending | Run live on 2026-10-12: the task ended as `unknown`, nothing was sent or retried, traffic unchanged (`docs/EVALUATION.md`) |
| Android on an emulator against the deployed services | 11 October crew flow; 15 October APK `34a14f1` real sign-in/Ask/controls/Maps and later call summary/save. Original failure/wrong drafts retained; final corrected draft acceptance open |
| Latest integrated gateway | Public/deployed `fe69923` includes readiness/time guards and busy/range guidance. Fresh API 245/browser/axe/hosted/publish, native core 74/app 3, assembly/lint/format pass. Same UID/config, latest 100%, six current build hashes match; not remote CI |
| Android on a physical device | Not verified |
| Push notifications | Implemented, off in the deployment, no real FCM send verified |
| Signed-out page | Clean mobility welcome and Google sign-in; no synthetic rehearsal or private reads |
| Mobility / official Maps MCP | Actual deployed Firebase/Firestore vehicle, Google tiles, five-place search, Favorite/selection/simulated arrival and guided-case lifecycle. Distinct policy-bound recurrence verified one simulated remedy; the first failed recurrence and reproduced provider 429 remain recorded. Scripted reviewer actions, no physical-car or human-trial proof |
| Evaluation | 18/18 on six scenarios after instruction fixes tuned on the same scenarios (not held out). On six held-out cases the first run scored 13/18 (the crew did not flag tiny samples or disagreeing signals); after an instruction fix the same cases scored 18/18, which is no longer a held-out result. See `docs/EVALUATION.md` |
| 14 October qualification after telemetry fix | Six new cases 6/6; collector regressions 2/2; original tuned-case regressions 6/6, one attempt per case. Real Gemini with synthetic Google APIs and in-process peers; no deployed-A2A, physical-device or productivity claim |

## Current limits

- Separate qualifications retain the first 429/no retry and `a80225a` 25-second deadline. After a minimal availability control, one distinct `fe69923` real summary passes in 2,149 ms with correct KST time, usable message/recipient, save and two explicit local simulated completions. Its setup turns/identity are synthetic; final native date/body acceptance remains unproved. Private configured APK `51cfa9d` is prepared, not installed; the device still has the earlier unidentified artifact. Confirm its controller/intended installation before UI tests. Raw recordings are not a final public demo. See `docs/reviews/2026-10-15-native-live-call-output.md`.
- The Android crew screen (instruction, progress, approval, report) is covered by unit tests against the real wire format, and on 2026-10-11 was driven on an emulator against the deployed services (Google sign-in, a task opened from the server, a signed approval applied, an honest report). It has not run on a physical device.
- Push notifications are implemented on the server and in the app but are off in the deployed demo.
- ADK's A2A support is marked experimental by Google.
- Only one reversible action (traffic rollback) can be applied. Everything else the crew does is read-only.
- Current V2-compatible gateway/crew and mobility are deployed; public build hashes match. Negative broker checks and actual mobility/provider runs are distinct from real V2 mutation/conflict, native live tiles, physical-device and productivity evidence, which remain open. Provider capacity failures can still occur; no unknown request is automatically resent.

## After the submission (roadmap, not built)

- A durable agent task store, so a pending approval survives an agent restart (today it ends as `unknown` and nothing is sent).
- Connect any Google Cloud project instead of registered services, with the same ownership checks.
- More reversible operations beyond the traffic rollback, each with its own policy entry, tests and approval text.
- A Dev agent that proposes a fix as a branch and pull request in a repository.
- Other clouds behind the same typed tools and signed approvals.
- Push notifications for pending decisions (implemented, off in the deployment).

## Provenance and licenses

The prototype this repository was extracted from has Git history starting on 2026-10-09, inside the AI Builder Cup building window (7 Sep – 18 Oct 2026). `docs/provenance/source-manifest.json` records the initial extraction. Dependencies keep their licenses (Apache-2.0 for ADK, Material Web and the A2A SDK). Third-party names are used only to describe compatibility.
