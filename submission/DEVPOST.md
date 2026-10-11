# Devpost submission text — Aide

Paste each section into the matching Devpost field. Replace the three placeholders before submitting: `<DEPLOYED_URL>`, `<VIDEO_URL>`, `<REPO_URL>`. Everything below is checked against the repository and the live runs; keep the "Known limits" section, it is part of the story.

---

## Project name

Aide

## Tagline (60 characters)

A Gemini agent crew runs cloud ops. You only decide.

Alternatives: "Hand the ops work to an agent crew. Keep the decisions." · "Be the boss: your cloud ops crew, in your pocket."

## Elevator pitch

You give one instruction from your phone. A crew of Gemini agents investigates a running Google Cloud service, tells you what is wrong and what it cannot see, and proposes a fix. Nothing changes until you approve that exact action, and only one agent is allowed to make the change.

---

## Inspiration

Production trouble does not wait until you are at your desk. The work around an incident is mostly reading: dashboards, logs, revisions, what changed. The actual decision is small. We wanted to hand the reading to agents and keep only the decision for the person, on the device they always have with them.

The hard part was never "can an agent fix it". It was "can we trust what the agent says it did, and can it ever change something it should not". So we designed around that question first.

## What it does

1. **Ask.** Say it in one sentence: "Customers say checkout is failing. Handle it."
2. **The crew works.** A **Chief** agent delegates over the A2A protocol:
   - **Ops** reads Cloud Run, Cloud Monitoring and Cloud Logging through typed, read-only tools.
   - **Diagnosis** turns the evidence into ranked hypotheses and says what it cannot see.
   - **Guardian** classifies the proposed action with a deterministic policy table that lives outside the model.
3. **You decide.** The task pauses and shows an approval card: the exact action ("send 100% of `shop-api` traffic back to `shop-api-good`"), the risk, the reason, and that it is reversible.
4. **It applies and verifies.** After you approve, the Ops service shifts traffic, the crew re-reads the service, and the report says what changed and, honestly, what the metrics cannot show yet.

It runs as a Google Cloud Console-style web console (left navigation, a Gemini-style assistant that expands from the right) and as an Android app. Both talk to the same server, so a task started on the web shows up on the phone.

**Why a model cannot talk its way into a change**

- **Typed tools only.** Agents choose among a fixed set of functions. They never receive credentials and never generate code to run.
- **Signed human approval.** After a verified reviewer approves, the gateway signs an HMAC over the exact action (actor, action digest, expiry). Only the Ops service holds the verification key. The Chief cannot create, extend or reuse an approval.
- **Two independent checks.** The Chief checks policy before asking you. The Ops service checks policy and the signature again before it touches Cloud Run, and its permission to change anything is scoped to one service, not the project.
- **Honest about missing data.** Empty metrics are "unknown", never zero and never healthy. Log text is treated as untrusted data, so instructions hidden in logs are not followed.
- **No automatic resend.** A lost connection or an unknown outcome is shown as unknown. A change is never retried by the system.

## How we built it

- **Agents:** Python with Google ADK 2.11, Gemini 3.8 Flash on Vertex AI, and the A2A protocol (JSON-RPC streaming, agent cards). ADK's tool-confirmation flow is mapped to A2A `input-required`, which is how a task pauses for a human decision.
- **Four private Cloud Run services**, one image, one role each (Chief, Ops, Diagnosis, Guardian), each with its own least-privilege service account. Callers present Google-signed identity tokens, and only the intended caller can invoke a service.
- **Gateway and console:** a TypeScript service on Cloud Run that serves the web console and the API. It verifies the person with Firebase Authentication, derives owner and roles on the server, stores tasks in Firestore, signs approvals (key in Secret Manager), and streams the crew's progress back.
- **Console:** React and Material Web (Material 3). **Android:** Kotlin and Jetpack Compose (Material 3). One design-token file generates the web CSS and the Android color scheme.
- **Observability:** OpenTelemetry traces from every agent to Cloud Trace, and a bounded step timeline in the UI.
- **Demo target:** a small storefront (`shop-api`) with a healthy and a faulty revision, so the crew has something real to investigate.

## Challenges we ran into

- **The first evaluation told us the crew was dishonest, not incapable.** On six scenarios the first run passed 14 of 18. The failures were exactly the ones we feared: with no metrics, the crew said the service looked healthy, and it once steered a user toward deleting something by hand. We fixed the instructions and measured again (16/18, then 18/18). We did that on the same scenarios, so the final number is not a held-out score, and we say so on the slide.
- **"Unknown" makes agents hesitate.** When the good revision had no recent metrics, the Diagnosis agent refused to call it healthy and the crew kept looking for evidence for several minutes before proposing the rollback. That is the correct behavior and a real trade-off. For the demo we generate traffic on both revisions first.
- **A bare Google sign-in was too much access.** Firebase sign-up is open, so we found that an account that was merely signed in could start a crew task. The server now requires that the person owns a registered service (`crew_not_entitled`), with tests, and we redeployed before submitting.
- **Mobile sign-in is configuration-sensitive.** Google refuses the token unless the app's package name and signing certificate are registered in Firebase. Ours were registered under an older package name, which the app reported only as "Sign in again to continue". The server logs and the Google error text made it findable.
- **A2A support in ADK is experimental**, and Cloud Monitoring lags by minutes. The report has to say that, so it does.

## Accomplishments that we're proud of

- A live, end-to-end run on the deployed services on **both web and Android**: instruction, streamed steps, approval card, signed approval, traffic actually shifted (checked on the service itself), and an honest report.
- Safety claims that are tested rather than asserted: HTTP attack tests against the Ops `/execute` endpoint (forged or expired approvals, other actions, wrong service, wrong revision), a Chief test where "the person said yes" without a valid signature changes nothing, and a prompt-injection scenario in logs.
- 167 gateway tests, 33 crew tests, browser flows with accessibility checks, and a publish gate that blocks secrets and local paths from the public repository.
- A console styled after the Google Cloud Console, with a labeled rehearsal mode so anyone can try the flow before signing in.

## What we learned

- Put the policy outside the model. A deterministic table and a signature are easier to reason about than a prompt that says "be careful".
- Treat "unknown" as a first-class state in the UI, the tools and the evals. Most of the honesty bugs were about missing data being read as good news.
- Evaluate for behavior you are afraid of, not only for success. Our evaluation found gaps no demo run would have shown.
- Agents are good at the reading. The interesting design work is the boundary around the one thing they may change.

## What's next for Aide

- Connect any project (project and billing account) instead of a fixed set of registered services, with the same ownership checks.
- More reversible actions beyond a traffic rollback, each with its own policy entry, tests and approval text.
- A held-out evaluation set, and single-use approvals (today an approval is bound to one action, one approver and five minutes, not to a single use).
- Push notifications for pending decisions. They are implemented on the server and in the app but switched off in the deployed demo.

## Known limits (please keep this section)

- The only change the crew can make is a **traffic rollback** to a previous revision. Everything else it does is read-only.
- The crew operates on **registered services only**; arbitrary project connection is not implemented.
- The live crew requires a signed-in account that owns the registered service. Without signing in, the console opens in a **labeled rehearsal mode** with a scripted crew and synthetic data. It is clearly marked and makes no model or Google calls.
- The Android flow was verified on an **emulator** against the deployed services, not on a physical device.
- The evaluation was tuned on the same six scenarios; it measures regressions in honesty and safety, not generalization.
- ADK's A2A support is marked experimental by Google.

## Built with

Google Gemini (Gemini 3.8 Flash, Vertex AI) · Google Agent Development Kit (ADK) · A2A protocol · Google Cloud Run · Firestore · Firebase Authentication · Secret Manager · Cloud Monitoring · Cloud Logging · Cloud Trace (OpenTelemetry) · Cloud Build · Artifact Registry · Python · TypeScript · React · Material Web · Kotlin · Jetpack Compose (Material 3) · Zod

## Try it out

- **Deployed console:** <DEPLOYED_URL> — opens in rehearsal mode without signing in. To see the live crew, ask us to add your Google account to the allow list: <CONTACT>.
- **Demo video (under 3 minutes):** <VIDEO_URL>
- **Source code:** <REPO_URL> — start with `README.md`, then `docs/ARCHITECTURE.md` and `docs/EVALUATION.md`.

## Theme

Future of Work & Enterprise Productivity.

## Provenance (for the organizers)

Built for AI Builder Cup 2026 (build window 7 Sep – 18 Oct). The prototype this repository was extracted from has Git history starting on 9 October 2026, inside the window. No earlier project's code was copied; earlier private experiments contributed ideas only. Details: `docs/provenance/` and `README.md`.
