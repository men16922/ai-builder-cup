# Devpost submission text — Aide

English draft for owner review, updated 15 October 2026. Replace `<DEPLOYED_URL>`, `<VIDEO_URL>`, `<REPO_URL>` and `<CONTACT>`. Code commit/push is authorized; private artifact publication, video upload and submission require separate instruction. Keep the evidence limits.

## Project name

Aide

## Submission theme

Future of Work & Enterprise Productivity. Aide targets repeated investigation, coordination and follow-up during interrupted work; the driver workflow demonstrates its customer-facing application. The simulated vehicle workflow and real registered cloud workflow have separate data and authority, with no implemented cross-domain root-cause correlation.

## Tagline

Your day, handled. Ask your own Aide.

## Elevator pitch

A meeting moves while you head to a charger. A warning appears. A release breaks while the responder is away from a desk. Each interruption creates work to understand, coordinate and finish. My Aide turns an everyday request into reviewed actions, finds real places, handles a fictional call with Gemini and prepares follow-up drafts. A separate Google Cloud crew investigates registered services. Known, verified simulated charging cases can act once within an enabled policy and report back; unfamiliar cases need a person. Real cloud changes retain their own current human approval boundary.

## Inspiration

[Google SRE's description of toil](https://sre.google/sre-book/eliminating-toil/) motivated our focus on repetitive, interrupt-driven coordination. The [12 June 2025 Google Cloud incident](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW) illustrates how invalid policy data can become widespread errors and affect monitoring itself. Our design inference is that missing evidence must remain unknown and remediation needs reviewed state, bounded authority and a verified report. We do not claim Aide could have prevented that outage. Reference cases and requirements are collected in `docs/plans/2026-10-14-mobility-product.md`.

We use a Hyundai-inspired visual taste and a vehicle-centered interaction model. There is no Hyundai, Bluelink or Tesla production integration. Vehicle telemetry, charging and driving control are explicitly simulated; real Maps and registered cloud services remain separate data sources.

## What it does

- **Ask your own Aide:** say "Cool the car to 20 before I leave." Gemini proposes typed controls or a search. Nothing executes until the driver taps a proposal and the server validates it against current state.
- **Vehicle home:** simulated EV battery, charging, location, lock, climate, charge limit, lights and horn. Personal state is actor private and does not require Cloud Run ownership. Web and native Android share the vehicle, map, assistance and call domains.
- **Maps assistance:** Gemini turns a request into a bounded query; official Google Maps MCP supplies real nearby places and source links. Place cards include Google photo attribution and matching numbered markers. First destinations require selection. Favorites and matching seven-day remembered choices can handle a later request. Google basemaps are real; movement is visibly straight-line simulation with cancellation.
- **Calls handled by My Aide:** a fictional caller and aide generate contextual Gemini turns during simulated travel. The driver can reply, delegate or end the conversation. A summary, saved history and message/calendar drafts follow; completion needs an explicit tap and is simulated. There is no real dialing, message delivery or calendar write. Independent call/vehicle revisions keep movement and Stop usable while the model waits. An uncertain call cannot automatically resend.
- **Vehicle diagnosis:** a cluster locates the reported tire, thermal or charge warning. Gemini explains bounded telemetry and a suitable next step. A tire or thermal warning cannot produce an invented repair. Request errors open a code-specific manual; reading it does not retry an operation.
- **Resolve and remember:** an unfamiliar charging-link symptom escalates. Five current safety checks fence one human-authorized typed simulated reconnection. Read-back creates a seven-day candidate. A separate promotion executes nothing and grants no autonomy. An active case plus an explicitly enabled 24-hour policy permits one attempt on a fresh matching incident. Changed/unsafe evidence escalates; revoke or disable anytime.
- **Cloud crew:** Chief delegates to Ops, Diagnosis and Guardian over ADK/A2A. Ops reads registered Cloud Run state, logs and metrics; Diagnosis explains hypotheses and unknowns. Guardian applies an independent policy. Real traffic rollback requires a current reviewer decision bound to exact action, reviewed UID/etag/time and a five-minute lease. Ops redeems a durable gateway claim once before one conditional PATCH.

## How we built it

React/Material Web and Kotlin/Compose Material 3 share design tokens and an original EV illustration. Android separates UI, ViewModel, Repository and platform data, uses device-selected English/Korean resources, and includes a persistent/replayable introduction. Cloud Run hosts the gateway and four private crew services; Firebase verifies identity, the server derives membership, Firestore stores state/claims, Vertex AI serves Gemini and official Maps MCP supplies places. Models receive bounded evidence and typed tool choices, never credentials, execution code or IAM authority.

Serverless deployment, bounded provider queries and actor-private state support a practical prototype. This is not a load-test or production-scale claim: Chief's A2A streaming task state remains process-local, and a restart can yield an unknown outcome rather than silently resume a change.

## What we verified

Current integrated source `fe69923` passes 245 API tests, browser/accessibility/hosted/publication checks, native core 74/app unit 3 and assembly/lint/format. Separately recorded offline emulator evidence has 20 passes/one live-Maps opt-in skip. These are local/synthetic checks. The unchanged Python crew's separately recorded gate has 97 passes.

Separate provider qualification verified contextual Gemini turns and a summary with draft follow-ups; one Maps flow returned five places with five attributed photos. One actual Gemini call through a local synthetic-identity service retained an explicit Stop during its pending response. A separate restricted-key native SDK probe passed without skips; settled Google tiles, car and straight-line path were inspected on an API 36 emulator. These checks do not establish an authenticated current deployed walkthrough, a physical phone or productivity improvement.

An actual deployed browser run verified Firebase/Firestore vehicle state, Google tiles, Gemini → Maps MCP five-place search, Favorite/selection/simulated arrival, guided recovery and separate case/policy approval. The first learned-case recurrence became unknown and performed no remedy or automatic resend. A separate diagnostic reproduced Gemini 429 capacity refusal. Bounded thinking and clearer busy-state reporting were added; new qualification calls and a distinct deployed incident verified one simulated 72 kW read-back. The test policy was disabled afterward. Reviewer steps were scripted UI operations, not a human productivity trial.

Actual native Google/Firebase/Firestore sign-in, Gemini proposals/explicit controls, Maps and a later call summary/save were exercised on APK `34a14f1`. The original failed summary is preserved unknown. The successful summary exposed a wrong calendar time and empty message body; no follow-up was completed. Server readiness and deterministic time handling were then strengthened, including a midnight regression. Separate post-fix qualifications retain one 429/no retry and a later distinct `a80225a` summary reaching its 25-second deadline after one transport attempt, without an HTTP response. Final actual date/body acceptance remains unverified; a successful JSON response alone is not useful-action proof.

Fresh reads verify published gateway `fe69923`, including the `88437ea` draft guards and busy/range guidance: same registered UID/runtime configuration, latest ready traffic 100% and all six current build asset hashes match. Private configured APK `51cfa9d` now passes app/build/lint, signing/config/key checks and has four ABIs; it is not installed. Actual native evidence remains bound to `34a14f1`; the device still has the earlier unidentified artifact, so its controller/intended installation must be confirmed. This establishes scoped deployment evidence, not remote CI or complete current signed-in/physical acceptance. Submission-only commits do not redeploy the app.

Compatible V2 gateway/crew deployment and negative broker checks are verified. Actual V2 human-approved cloud mutation and real etag conflict remain unverified. Older real rollback/read-back and restart evidence are dated separately in `docs/EVALUATION.md`.

## Impact and limits

The intended B2C benefit is fewer forgotten follow-ups and clearer assistance during an interrupted journey. The enterprise benefit is less manual evidence gathering and coordination between diagnosis and a reviewed action. The prepared paired pilot measures elapsed time, active human time, errors and uncertainty understanding. No completed human or single-agent comparison supports an accuracy, MTTR, productivity or multi-agent advantage claim yet.

Physical-phone login/backgrounding, a current authenticated deployed end-to-end recording, actual V2 approval/conflict, final judge access and the paired pilot remain open. Native tiles have emulator evidence only. Current Seoul route probes returned no routes; do not claim road navigation or physical autonomy. Provider capacity failures can still occur and unknown work is never automatically resent. Original held-out first result remains 13/18 under a different fixture protocol; later tuned 18/18 is not held-out evidence.

## Links and provenance

- Product: `<DEPLOYED_URL>`
- Reviewed video: `<VIDEO_URL>`
- Submitted code: `<REPO_URL>`
- Contact: `<CONTACT>`

The immutable extraction manifest describes a mixed worktree, not a fresh-project certificate. Inspected source Git history starts on 9 October 2026; that does not date every dirty file. The owner must reconcile eligibility against the 7 September–18 October window. No company materials or earlier projects should be copied into this repository.
