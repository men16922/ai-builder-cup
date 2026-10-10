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

The deployed console's front page has **Try the agent crew (no sign-in)**. It runs the same console against a scripted crew and synthetic data, entirely in the browser, and says so on screen. It shows the flow (instruction, streamed steps, approval card, report, dashboard change). It does not call any agent or model; the real crew needs a signed-in, allow-listed account.

## Evaluation

Six scenarios (bad release, healthy service, no data, prompt injection in logs, destructive request, unregistered service) run against the real Gemini crew with fixed data. Results and what was fixed are in [docs/EVALUATION.md](docs/EVALUATION.md).

## Repository map

| Path | Contents |
| --- | --- |
| `agents/` | Python crew: ADK agents, typed tools, policy, signed approvals, A2A serving, evaluation harness, tests |
| `server/` | TypeScript gateway and web API: identity, workflow, agent tasks, overview, notifications |
| `src/` | Web console (React, `@material/web`), shared domain schemas, i18n (Korean and English) |
| `mobile/android/` | Android client (Kotlin, Compose Material 3) |
| `design/tokens.json` | One Material 3 token source for web CSS and the Android color scheme |
| `demo/` | `shop-api`, a small storefront with a healthy and a faulty revision, plus traffic scripts |
| `docs/` | Architecture, evaluation, status and plans |

## Run it

Prerequisites: Node.js 24+, Python 3.11+, a Google Cloud project with Vertex AI, Cloud Run, Firestore and Firebase Authentication enabled. Nothing here uses a stored key; local runs use your own Application Default Credentials.

```sh
npm ci && npm run build && make check          # web, gateway and browser tests (synthetic data, offline)
cd agents && python -m venv .venv && .venv/bin/pip install -e ".[dev]" && .venv/bin/python -m pytest
```

Deployment notes are in [deploy/](deploy/). Real identifiers, configuration and credentials never enter the repository.

## Current limits

- The Android crew screen (instruction, progress, approval, report) is covered by unit tests against the real wire format and was driven end to end on an emulator in the synthetic rehearsal mode. It has not yet run against the live server from a signed-in device.
- Push notifications are implemented on the server and in the app but are off in the deployed demo.
- ADK's A2A support is marked experimental by Google.
- Only one reversible action (traffic rollback) can be applied. Everything else the crew does is read-only.

## Provenance and licenses

The prototype this repository was extracted from has Git history starting on 2026-10-09, inside the AI Builder Cup building window (7 Sep – 18 Oct 2026). `source-manifest.json` records the initial extraction. Dependencies keep their licenses (Apache-2.0 for ADK, Material Web and the A2A SDK). Third-party names are used only to describe compatibility.
