# Repository status

Updated: 2026-10-10. The user resumed development after the migration ("complete remaining work"). Only work that needs no new approval was done; items needing a user decision remain open in `docs/NEXT_PLAN.md`.

The GCP web/API, neutral contracts, Android sources, synthetic fixtures and regression checks were extracted from CloudOps-Automation. AWS/On-Prem/Azure implementations, company SSO/workers and original runtime data remain there. This is a separate local Git repository on `main`, without commits or remotes.

## Current baseline

- `make check`: type checking, source boundaries, independent web/API build, **149/149 server tests**, mobile fixtures, GCP HTTP/browser and hosted artifact smoke passed.
- `make check-android-core`: Kotlin core and native HTTP **49/49** passed. No APK or device UI.
- Details: `docs/verification.md`. All results are synthetic and local. No live Google/Firebase/Gemini/FCM, Docker, APK/device, deployment or publication has been verified.

## Development increment: notification delivery composition (server)

- A Firebase-verified provider subject (issuer, tenant, UID, `auth_time`) is stored privately per device generation (`gcp-push-recipient`). It is cleared together with the push address on revoke, retire, replacement and unregistered-token cleanup. It never enters contexts, workflow, intents, delivery records, responses or audit data.
- `server/platform/firebase/notifications.ts` adds the Firebase Admin current-identity authority (disabled user and revocation vs `auth_time`) and the data-only FCM transport for a fixed Android package. Definite unregistered tokens deactivate only their generation, and nothing is ever resent.
- `server/modules/gcp/notification-worker.ts` is a bounded in-process worker. It has no HTTP trigger, and the hosted entry starts it only when `notifications.enabled` is configured. Composition fails if the configuration and ports do not match.
- Still missing: the Android FCM SDK and token source (needs new SDK approval), real FCM/Firebase calls and IAM, Cloud Run background CPU, and device delivery. See `deploy/gcp-notifications.md`.

## Live deployment (2026-10-10, user-authorized)

The user approved the Android SDK/license, Docker build, a Cloud Run deployment and use of the active gcloud project. Real identifiers are kept only in ignored `.data/` and are not recorded in Git.

- Deployed one Cloud Run service (notifications disabled, min instances 0) with a dedicated runtime service account, a dedicated Firestore database and the server configuration in Secret Manager. The fixed observation target is the service itself.
- Firebase Authentication with Google sign-in is enabled and the service domain is authorized. One organization membership was provisioned by `scripts/provision-gcp-membership.ts` for the signed-in user.
- Verified live in the browser, in one run inside the 5-minute plan window: web sign-in, membership check, bounded Cloud Run read, log/metric query, Gemini analysis and plan preparation, review request, approval, explicit fixed read execution and a saved handoff. Every step returned 200 in the server log. Empty log/metric pages are shown as unknown, not zero.
- Open finding: the Cloud Run v2 REST API omits the boolean `reconciling` when it is false, so the collector records it as a missing field. Every live read is therefore shown as "required observation incomplete" and service health stays unknown. This follows the repository rule that missing evidence is never healthy, but it also makes a complete live read impossible. Treating an omitted proto3 boolean as false is a policy decision that has not been made.
- Found and fixed with a regression test: Cloud Run v2 reports a revision's parent service as the short ID, which made every live read fail with `scope_changed`.
- Not yet verified live: a real FCM send (notifications are disabled in the deployment) and Google sign-in on the device. A second account that signed in without a membership correctly received 403 until a membership was provisioned for it.
- Android: SDK 36, build tools 35 and an arm64 emulator image were installed with the user's consent. `assembleDebug` and `lintDebug` pass (0 errors, 17 pre-existing-style warnings). `firebase-messaging`, an explicit-enable token source and a data-only messaging service were added. The app launches on the emulator with the real server configuration; Korean/English and the synthetic rehearsal work. Google sign-in on the device needs an account added by the user.

## AI agent crew (2026-10-10)

The product direction changed to an AI agent app. `agents/` holds a Python multi-agent crew built on ADK 2.11 and the A2A protocol, deployed as four private Cloud Run services (one image, role chosen by `AGENT`).

- **Chief** plans, delegates over A2A and asks a person for decisions. **Ops** reads Cloud Run, Cloud Logging and Cloud Monitoring through typed tools. **Diagnosis** turns evidence into hypotheses and unknowns. **Guardian** classifies actions with a deterministic policy table.
- A change is applied only through a signed human approval. The Chief pauses in the A2A `input-required` state; the approval is an HMAC over the exact action, signed after a verified person approves and checked again by the Ops service, which holds the only mutation right (one service, not the project). The model never holds the key.
- Verified on Cloud Run with Gemini 3.7 Flash: the crew investigated a bad release of a demo service (`demo/shop-api`), found the failing revision and the healthy one, paused for approval, and after a signed approval rolled traffic back. Forged, expired, missing or mismatched approvals and unregistered services change nothing (`agents/tests`, 19 tests).
- Web and Android now share one Material 3 token source (`design/tokens.json`); the web console uses `@material/web`.
- **Gateway and console (web):** the TypeScript server accepts an instruction at once, streams the Chief's A2A events into a stored task, signs an approval only after a verified reviewer decides, and never resends an unknown outcome (`server/modules/gcp/agent-tasks.ts`, 8 tests). A read-only overview endpoint feeds a Google Cloud Console style dashboard: top bar with an ask field and Gemini toggle, collapsible navigation, KPI tiles, traffic and response charts, error logs and a right-hand assistant with progress steps and the approval card (`src/modules/gcp/Dashboard.tsx`, `Assistant.tsx`; browser test `scripts/check-gcp-agents.mjs` including axe at desktop and 390px).
- **Evaluation:** `agents/evals/` runs six scenarios against the real Gemini crew with fixed Google API data and records rule-based and judged results in `agents/evals/results/latest.json`. See `docs/EVALUATION.md` once the run is recorded.
- **Evaluation:** 6 scenarios x 3 runs on the real crew. First run 14/18; after three rounds of instruction fixes 18/18 (tuned on the same scenarios, so not held-out). Every round is recorded in `docs/EVALUATION.md`. The improved crew image (`crew:20261011-021331`) is deployed to all four agent services and answered a live read-only health check honestly.
- **Android:** `Agent.kt` (task model, strict parsing, polling coordinator that never resends) and `AgentScreen.kt` (instruction field, step list, approval card) are wired into `LiveAccess`; core tests, assemble and lint pass. The synthetic rehearsal mode uses `FixtureAgentApi` (a scripted crew with one rollback approval), and that flow was driven end to end on the arm64 emulator: instruction, steps, approval card, report with the still-unknown section. Not yet run against the live server from a signed-in device. The debug build packages the real server address on its sign-in card, so screenshots of that screen must not be published.
- **Signed-out rehearsal:** the deployed front page offers "Try the agent crew (no sign-in)": the same console driven in the browser by a scripted crew (`src/modules/gcp/rehearsal.ts`) with synthetic data and an on-screen label. It makes no API, model or Google call; tests parse its output with the live schemas, and the hosted-artifact browser test asserts zero API requests and an axe pass. Deployed as revision `cloudops-auto-00009` and clicked through against the live URL. After a task completes the dashboard now re-reads at once instead of waiting for the 30-second refresh.
- **Safety checks:** `make check-agents` runs 33 tests, including 13 that attack the Ops `/execute` endpoint over HTTP (no approval, forged, tampered, expired, borrowed, unregistered service, other actions): none reaches Cloud Run. On the deployed Ops service, a call with no credentials and a call with the gateway identity are both refused (403). A live "delete shop-api" instruction to the Chief was refused and `shop-api` is unchanged. Crew image `crew:` rebuilt after extracting `execute_route`; all four agent services updated. Known limit written in `docs/ARCHITECTURE.md`: an approval is not single-use within its five-minute window.
- **Default language:** without a saved choice the web page and the Android app follow the browser or device language (Korean for Korean, English otherwise), so English-speaking judges see English first. Language still only changes wording. Deployed as `cloudops-auto-00010` and checked on the live URL with both locales.
- **Tracing:** each agent service exports OpenTelemetry traces to Cloud Trace (`OPS_TRACE_TO_CLOUD=1`, `gcp.project_id` resource attribute). Verified in Cloud Trace: ADK `invocation`, `invoke_agent`, `call_llm` and `generate_content` spans plus the A2A server spans.
- **Submission material:** English `README.md`, `docs/ARCHITECTURE.md`, `docs/EVALUATION.md` (generated from recorded results) and a 10-slide deck built by `docs/deck/build.mjs` into `docs/deck/deck.pdf`.
- Not done yet: the Android crew screen has unit tests and a clean build and lint, but no signed-in device run (the emulator could not take keyboard input for sign-in); the demo video, the public repository, the final product name. ADK's A2A support is marked experimental by Google.

## Eligibility and provenance

On 2026-10-10 the user stated that the original project was never submitted to any competition and that they consider it acceptable. The official FAQ may also restrict work created before the program. That creation-time rule is still for the user to confirm. `source-manifest.json` remains the immutable extraction record (mixed worktree, original base commit, per-file hashes). A new Git history is not proof of a fresh project. English submission materials remain separate work.

The product keeps personal/organization entry, server authorization boundaries, GCP-only mobile and Korean/English UI. Detailed imported implementation notes may still describe commands from the original repository. The root README and package.json are authoritative.
