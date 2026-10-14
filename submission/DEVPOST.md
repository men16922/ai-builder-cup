# Devpost submission text — Aide

English draft for owner review. Replace `<DEPLOYED_URL>`, `<VIDEO_URL>`, `<REPO_URL>` and `<CONTACT>`. Publication and submission are not authorized. Keep the evidence limits.

## Project name

Aide

## Submission theme

Future of Work & Enterprise Productivity. Aide targets repeated investigation, coordination and follow-up during interrupted work; the driver workflow demonstrates its customer-facing application. The simulated vehicle workflow and real registered cloud workflow have separate data and authority, with no implemented cross-domain root-cause correlation.

## Tagline

AI assistance for interrupted journeys and incident work.

## Elevator pitch

A charging interruption should come with a useful next step. A bad release should not require an engineer to assemble several dashboards on a phone. Aide gives drivers a clear vehicle companion and responders an accountable Gemini crew. Known, verified simulated charging cases can act once under a bounded policy and report back. Unfamiliar symptoms are resolved with a person, verified and separately approved for recurrence. Real cloud changes retain their own human approval boundary.

## Inspiration

The [12 June 2025 Google Cloud incident](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW) illustrates how invalid policy data can become widespread errors and affect monitoring itself. Our design inference is that missing evidence must remain unknown and remediation needs reviewed state, bounded authority and a verified report. Reference cases and requirements are collected in `docs/plans/2026-10-14-mobility-product.md`.

We use a Hyundai-inspired visual taste and a vehicle-centered interaction model. There is no Hyundai, Bluelink or Tesla production integration. Vehicle telemetry, charging and driving control are explicitly simulated; real Maps and registered cloud services remain separate data sources.

## What it does

- **Vehicle home:** simulated EV battery, charging, location and focused charger/dinner/help actions. Personal state is actor private and does not require Cloud Run ownership.
- **Maps assistance:** Gemini turns a request into a bounded query; official Google Maps MCP supplies real nearby places and source links. First destinations require selection. Favorites and matching seven-day remembered choices can handle a later request. Google basemaps are real; movement is visibly straight-line simulation with cancellation.
- **Resolve and remember:** an unfamiliar charging-link symptom escalates. Five current safety checks fence one human-authorized typed simulated reconnection. Read-back creates a seven-day candidate. A separate promotion executes nothing and grants no autonomy. An active case plus an explicitly enabled 24-hour policy permits one attempt on a fresh matching incident. Changed/unsafe evidence escalates; revoke or disable anytime.
- **Cloud crew:** Chief delegates to Ops, Diagnosis and Guardian over ADK/A2A. Ops reads registered Cloud Run state, logs and metrics; Diagnosis explains hypotheses and unknowns. Guardian applies an independent policy. Real traffic rollback requires a current reviewer decision bound to exact action, reviewed UID/etag/time and a five-minute lease. Ops redeems a durable gateway claim once before one conditional PATCH.

## How we built it

React/Material Web and Kotlin/Compose Material 3 share design tokens. Android separates UI, ViewModel, Repository and platform data, uses device-selected English/Korean resources, and includes a persistent/replayable introduction. Cloud Run hosts the gateway and four private crew services; Firebase verifies identity, Firestore stores state/claims, Vertex AI serves Gemini and official Maps MCP supplies places. Models receive bounded evidence and typed tool choices, never credentials, execution code or IAM authority.

## What we verified

The final local gate passes 206 gateway and 97 crew tests, browser/accessibility/hosted checks, 68 Android core tests, app unit 3 and emulator 7, APK/lint. These are local/synthetic evidence.

An actual deployed browser run verified Firebase/Firestore vehicle state, Google tiles, Gemini → Maps MCP five-place search, Favorite/selection/simulated arrival, guided recovery and separate case/policy approval. The first learned-case recurrence became unknown and performed no remedy or automatic resend. A separate diagnostic reproduced Gemini 429 capacity refusal. Bounded thinking and clearer busy-state reporting were added; new qualification calls and a distinct deployed incident verified one simulated 72 kW read-back. The test policy was disabled afterward. Reviewer steps were scripted UI operations, not a human productivity trial.

Compatible V2 gateway/crew deployment and negative broker checks are verified. Actual V2 human-approved cloud mutation and real etag conflict remain unverified. Older real rollback/read-back and restart evidence are dated separately in `docs/EVALUATION.md`.

## Impact and limits

The intended B2C benefit is fewer interrupted journeys and clearer assistance. The enterprise benefit is less evidence gathering and coordination. No timed human or single-agent comparison supports an accuracy, MTTR, productivity or multi-agent advantage claim yet.

Physical-phone/backgrounding/native live tiles, actual V2 approval/conflict and final judge access remain open. Current Seoul route probes returned no routes; do not claim road navigation or physical autonomy. Provider capacity failures can still occur and unknown work is never automatically resent. Original held-out first result remains 13/18; later tuned 18/18 is not held-out evidence.

## Links and provenance

- Product: `<DEPLOYED_URL>`
- Reviewed video: `<VIDEO_URL>`
- Submitted code: `<REPO_URL>`
- Contact: `<CONTACT>`

The immutable extraction manifest describes a mixed worktree, not a fresh-project certificate. Inspected source Git history starts on 9 October 2026; that does not date every dirty file. The owner must reconcile eligibility against the 7 September–18 October window. No company materials or earlier projects should be copied into this repository.
