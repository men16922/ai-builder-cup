# Hackathon plan — AI Builder Cup 2026

Status: draft for the owner's decision, written 2026-10-10. English because the submission must be in English. The product name is a working title and may change.

## Facts that constrain the plan

Verified on aibuildercup.com on 2026-10-10.

| Item | Rule |
| --- | --- |
| Team | 2–4 members, no solo entry. Registration and team formation close **11 Oct**. |
| Building window | 7 Sep – 18 Oct. Prototype submission deadline **18 Oct**. Evaluation 19 Oct – 6 Nov. Finale in Singapore on 4 Dec. |
| Submission | Working deployed link (Cloud Run, GCP or Firebase), demo video under 3 minutes, public GitHub repository, deck as PDF. All in English. |
| Technology | Google Cloud stack, with Gemini or Gemma, or an agentic platform (Agent Platform, Antigravity, AI Studio). |
| Eligibility | "Only fresh projects built during the hackathon timeline are eligible." Participants must be working professionals, 21 or older. Students are disqualified. |
| Scoring | Technical merit and Gen AI 40%, problem alignment and impact 25%, innovation and creativity 25%, UX and solution design 10%. |

Best theme fit: **Future of Work & Enterprise Productivity** ("measurable gains in productivity or workflow execution").

## Provenance policy

- This repository was extracted from a local prototype whose Git history starts on 2026-10-09, inside the building window. `source-manifest.json` records the extraction and is not changed.
- Older projects of the owner predate the window. New agent code is written here from the public ADK, A2A and Google Cloud documentation. Only design ideas, not copied code, come from the older projects, unless the owner decides otherwise after reading the eligibility rule above.
- Third-party libraries keep their licenses and are attributed in the repository.

## Product

A mobile-first AI chief of staff for engineering work, from development to operations. The user speaks or types an instruction on a phone. A crew of agents does the work and only escalates real decisions. The phone is the only console a person needs.

Pitch line: *Be the boss. Delegate the work, make the big decisions, from anywhere.*

Measurable claims for the demo (to be measured, not asserted):
- Time from instruction to a reviewed decision.
- Number of steps the agents completed without a human.
- Number of decisions escalated to the human, with the reason for each.

## Architecture

```
Android app (Compose Material 3) / web console (Material Web)
   │  chat, voice, approval cards, push
   ▼
Gateway (TypeScript, Cloud Run): Firebase identity, owner/workspace/role checks, task API, FCM
   │  A2A (JSON-RPC over HTTP, streaming task updates)
   ▼
Chief agent (ADK, Gemini)  — plans, delegates, summarizes, asks for decisions
   ├── Ops agent        — reads Cloud Run, Logging and Monitoring through typed read tools
   ├── Diagnosis agent  — correlates evidence and states what is still unknown
   ├── Dev agent        — proposes a change as a branch and pull request in a demo repository
   └── Guardian agent   — policy layer outside the model: approve, require human, or refuse
Firestore (tasks, approvals, audit)  ·  Secret Manager  ·  Cloud Logging and Trace
```

Principles:
- Reads are autonomous within bounded scopes. Any change requires a Guardian verdict, and risky changes require a human decision on the phone.
- The model chooses among typed tools. It does not receive credentials and cannot widen its own permissions. Identity, ownership and roles come from the server, never from the client or the model.
- Approval is bound to a plan version, digest and expiry. A stale or unknown outcome is never resent automatically.
- Every agent step is traced (OpenTelemetry) and written to an audit log that the app can show.

Why it scores:
- **Technical merit (40%)**: ADK multi-agent system, A2A between separately deployed Cloud Run services, Gemini tool use, ADK evaluation sets with recorded results, tracing, policy layer, deployed on Google Cloud.
- **Problem alignment (25%)**: Future of Work. A measured before/after on the demo task.
- **Innovation (25%)**: full delegation from a phone with decision-only escalation, approval fatigue handled by risk-based gating.
- **UX (10%)**: one Material 3 design system on web and Android, Korean and English UI.

## Eight-day schedule (10–18 Oct)

| Day | Outcome |
| --- | --- |
| 10 Oct | Decisions: name, team, eligibility. Repository rename and UI library migration finished. |
| 11 Oct | Team registered. ADK Chief agent and Ops agent running locally against synthetic tools. |
| 12 Oct | Ops agent on real read tools. A2A between Chief and Ops on Cloud Run. |
| 13 Oct | Diagnosis and Guardian agents. Approval flow end to end with the phone. |
| 14 Oct | Dev agent with branch and pull request in a demo repository. |
| 15 Oct | Android app: chat, streaming task view, approval cards, push. Web console on Material Web. |
| 16 Oct | Evaluation sets and measurements. Tracing and audit view. |
| 17 Oct | Deployment hardening, public repository, English documentation, deck, demo video. |
| 18 Oct | Final checks and submission. |

## Risks

- Eight days is short. The scope above is the intended ceiling, and the Dev agent is the first item to cut.
- `@material/web` is in maintenance mode. It is Google's official Material 3 web library, and missing parts are built from the same design tokens.
- Compose Material 3 Expressive APIs are still in alpha. The Android app uses stable Material 3 and the shared tokens.
- Antigravity is an IDE, not a runtime. Its use in building is documented honestly (workspace rules in `.agents/rules`, root `AGENTS.md`, workflows as markdown) and is not presented as part of the product.
- The Firebase and Cloud Run configuration lives in an ignored local folder. Real identifiers must not enter the public repository.
