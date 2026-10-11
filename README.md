# Aide

> **Be the boss. Hand the work to an agent crew from your phone, and make only the big decisions.**

A mobile-first multi-agent system for Google Cloud operations. You give one instruction. A crew of Gemini agents investigates a running Cloud Run service, explains what is wrong and what it does not know, and proposes a fix. A change is applied only after a person approves that exact action, and only by the one agent allowed to make it.

Built for the AI Builder Cup 2026, theme *Future of Work & Enterprise Productivity*. The product name is a working title.

## What it does

1. **Ask.** Type or say "Customers say checkout is failing. Handle it." in the console's assistant panel or the top bar.
2. **The crew works.** The **Chief** agent delegates over the [A2A protocol](https://a2a-protocol.org) to specialists and streams every step back:
   - **Ops** reads Cloud Run, Cloud Monitoring and Cloud Logging through typed, read-only tools.
   - **Diagnosis** turns the evidence into ranked hypotheses and states what it cannot see.
   - **Guardian** classifies any proposed action with a deterministic policy table that sits outside the model.
3. **You decide.** For a change, the task pauses (`input-required`) and shows an approval card with the exact action, the risk and the reason.
4. **It applies and verifies.** After approval the Ops service rolls traffic back to a healthy revision, then the crew re-reads the service and reports honestly, including what metrics cannot show yet.

## Architecture

```
Android app (Compose Material 3)        Web console (Material Web, Cloud Console style)
        │   chat · approval cards             dashboard · Gemini-style assistant panel
        ▼
Gateway  (TypeScript, Cloud Run)  Firebase identity · owner/workspace/role checks · task store (Firestore)
        │   A2A JSON-RPC streaming, Cloud Run identity tokens
        ▼
Chief agent  (Python, ADK 2.11, Gemini 3.8 Flash)
        ├── A2A ──► Ops agent        reads Cloud Run / Monitoring / Logging; /execute applies a signed, approved rollback
        ├── A2A ──► Diagnosis agent  evidence → hypotheses, unknowns, next step
        └── A2A ──► Guardian agent   allow / require_human / refuse (policy table)
```

Every agent is its own private Cloud Run service with its own least-privilege service account. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Why a model cannot talk its way into a change

- **Typed tools only.** Agents choose among a fixed set of functions. They never receive credentials and never generate code to run.
- **Signed human approval.** The gateway signs an HMAC over the exact action after a verified reviewer approves. Only the Ops service holds the verification key. The Chief cannot create, extend or reuse an approval.
- **Two independent checks.** The Chief checks policy before asking you, and the Ops service re-checks policy and the signature before it touches Cloud Run. The mutation right is scoped to one service, not the project.
- **Honest about missing data.** Empty metrics are "unknown", never zero and never healthy. Log text is treated as untrusted data, so instructions hidden in logs are not followed.
- **No automatic resend.** A lost connection or an unknown outcome is shown as unknown. A change is never retried by the system.

## Try it without signing in

Open the deployed console. It is the real console frame (navigation on the left, the Gemini-style assistant on the right) running in a labeled **rehearsal mode** until someone signs in: a scripted crew and synthetic data, entirely in the browser, with the mode stated on screen. It shows the flow (instruction, streamed steps, approval card, report, dashboard change). It does not call any agent or model. The real crew needs a signed-in account that owns the registered service; any other Google account is refused by the server.

## Evaluation

Six scenarios (bad release, healthy service, no data, prompt injection in logs, destructive request, unregistered service) run against the real Gemini crew with fixed data. Results and what was fixed are in [docs/EVALUATION.md](docs/EVALUATION.md).

## Repository map

Each app has its own README. Everything TypeScript shares one `package.json` at the root; the Python crew and the Android app have their own toolchains.

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
npm run dev       # the console on http://127.0.0.1:5174 (rehearsal mode without a gateway)
```

How to build and deploy is in [docs/DEPLOY.md](docs/DEPLOY.md). Real identifiers, configuration and credentials never enter the repository; `npm run check:publishable` enforces that before anything is published.

## Current limits

- The Android crew screen (instruction, progress, approval, report) is covered by unit tests against the real wire format and was driven end to end on an emulator in the synthetic rehearsal mode. It has not yet run against the live server from a signed-in device.
- Push notifications are implemented on the server and in the app but are off in the deployed demo.
- ADK's A2A support is marked experimental by Google.
- Only one reversible action (traffic rollback) can be applied. Everything else the crew does is read-only.

## Provenance and licenses

The prototype this repository was extracted from has Git history starting on 2026-10-09, inside the AI Builder Cup building window (7 Sep – 18 Oct 2026). `docs/provenance/source-manifest.json` records the initial extraction. Dependencies keep their licenses (Apache-2.0 for ADK, Material Web and the A2A SDK). Third-party names are used only to describe compatibility.
