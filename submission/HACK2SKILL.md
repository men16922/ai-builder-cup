# Hack2skill submission form

The entry is submitted on Hack2skill (not Devpost). The form closes **19 October 2026, 03:29 IST (06:59 KST)**. Nothing has been submitted yet; the owner submits.

| Form field | Value |
| --- | --- |
| Challenges | Future of Work & Enterprise Productivity (repository wording; pick the matching option in the dropdown) |
| Prototype Link Deployed on GCP or Cloud Run | `product_url` in `.data/releases/submission-links-private.json` (the deployed Cloud Run gateway) |
| Final Prototype PPT/Deck converted into PDF (≤ 5 MB) | `submission/deck-template/Aide-AI-Builder-Cup.pdf`, built from the prescribed template by `submission/deck-template/build.py` (Git-ignored) |
| GitHub Repository Link (Public Access) | `public_baseline_repo_url` in the same link sheet |
| Demo Video Link (3–4 minutes) | Pending: the new take must run **3 to 4 minutes** and show working functionality; also replace `[video link]` on the deck's links slide and rebuild the PDF |
| Brief Description (≤ 1024 characters) | Text below |

## Brief description (1018 characters)

Aide is a Gemini-powered aide for drivers and cloud responders. On Android or the web, a driver asks in their own words: Gemini on Vertex AI proposes typed vehicle actions that run only after a tap, finds chargers or dinner through the Google Maps MCP server with Places photos, answers a fictional caller and drafts the follow-ups, and explains warnings. Known, authorised problems get one bounded fix and a read-back; unfamiliar ones go to a person. Firebase Authentication (Google sign-in) gives every request a server-verified identity. Cloud Firestore stores each user's private simulated vehicle twin, calls, tasks, approvals and audit. Cloud Run hosts the gateway and web app plus four private ADK agents (Chief, Ops, Diagnosis, Guardian) that talk over A2A to investigate registered Cloud Run services; a rollback needs a Guardian verdict, the exact reviewed state and a human tap. Agents never hold credentials. The vehicle, callers and follow-ups are simulated; Gemini, Maps, Firebase and Cloud Run are real.

## Before submitting

- Open both links from a signed-out browser profile; the prototype must stay up through evaluation.
- Replace `[video link]` in `build.py` (links slide), rebuild, export the PDF and check it is under 5 MB.
- Confirm the challenge option, team members and eligibility in the Hack2skill dashboard.
