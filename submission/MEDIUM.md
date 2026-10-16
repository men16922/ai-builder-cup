# Aide: an AI crew that handles the interruptions of the road, and asks before anything changes

*Built for the AI Builder Cup 2026 (Future of Work & Enterprise Productivity) with Gemini, Google Maps, Firebase, Cloud Firestore and Cloud Run.*

Watch the demo (3:52): https://youtu.be/oi7qsd9OR8o

---

## The moments that break a journey

Driving is full of small interruptions. Your team lead calls just as you merge onto the highway. The battery is lower than you thought, and you need to decide where to charge and whether you'll still make dinner. A warning light comes on and you have no idea what it means.

Each of these is a decision you're asked to make at the worst possible moment. We wanted to see whether an AI agent could take on the work around those moments — answering, searching, summarising, explaining — while you stay in charge of every change.

That became **Aide**: a personal AI crew on your phone and on the web. The rule is that Aide does the legwork and you make the decision.

## What Aide does

**Ask in your own words.** "Cool the car to 20 degrees before I leave." Gemini on Vertex AI answers with proposals drawn from a fixed catalogue of vehicle controls: set the cabin to 20°, turn on climate. Nothing runs until you tap a proposal, and the server checks every action against the car's current state before applying it.

**Real places, your choice.** "Korean barbecue dinner in Hongdae." Gemini plans the search, and the official Google Maps MCP server returns real restaurants with Places photos, ratings and attribution. Numbered markers on the map match the list. You pick one and tap *Go here*. If you like the choice, Aide can remember it for seven days in the same context, so next time it may handle that step for you.

**My Aide takes the call.** While the (simulated) drive continues, a fictional team lead calls. My Aide answers, explains that you're driving and replies only with what it knows from your schedule and trip. When a real decision comes up, such as moving a meeting to 4:30, you answer with one tap on a quick reply. Afterwards My Aide writes a summary and drafts the follow-ups: a calendar entry and a reminder. Nothing is sent or saved until you tap.

**See exactly what's wrong.** When a warning appears, the cluster view shows where it is on the car. Gemini explains it from the sensor values, says what it doesn't know, and keeps known fixes separate from unfamiliar problems. A known, approved problem can get one bounded fix followed by a read-back. An unfamiliar one goes to a person, with guidance rather than an invented repair.

**The same account everywhere.** The Android app and the web console share one private record, so the call you just saved on the phone is already in your history on the web.

## How it's built

- **Clients:** an Android app (Kotlin, Jetpack Compose, Material 3) and a web console (React, Material Web), both in Korean and English.
- **Identity:** Firebase Authentication with Google sign-in. Every request carries an ID token that the server verifies; the client never decides who you are or what you may do.
- **Gateway on Cloud Run:** a TypeScript service that accepts only typed actions, enforces per-user hourly budgets for AI and Maps calls, and calls Gemini and Google Maps on your behalf.
- **State in Cloud Firestore:** each driver's simulated vehicle twin, calls, summaries and decisions, private to that account.
- **Reasoning with Gemini on Vertex AI:** proposals for requests, trip plans, both sides of the fictional call, summaries and diagnosis, all returned as structured JSON that the server validates.
- **Grounding with Google Maps:** the official Maps MCP server plus Places photos, always with source attribution.
- **A separate agent crew for the cloud:** for real Cloud Run incidents, a Chief agent built with Google's Agent Development Kit delegates over the A2A protocol to Ops (typed, read-only evidence), Diagnosis (hypotheses and unknowns) and Guardian (a policy verdict that lives outside the model). Each runs as its own private Cloud Run service.

## Design rules we kept

**Agents choose typed tools; they never hold credentials.** No agent generates code to execute, receives a secret or changes IAM. The worst a confused model can do is propose the wrong item from a catalogue, and the server or a person then rejects it.

**A tap is the boundary.** Reads and drafts can happen on their own. Any change waits for an explicit tap, and a risky cloud change needs both a Guardian verdict and a human decision on the phone.

**Unknown is not success, and it's not a retry either.** If a model call times out or its result can't be confirmed, Aide says so plainly and does not resend the same step automatically. Repeating a "send" or a "rollback" you can't confirm is how a small glitch turns into a real incident.

**Honest about what is simulated.** The vehicle, the callers and the follow-ups are simulated, and the app labels them that way. Gemini, Google Maps, Firebase, Firestore and Cloud Run are real. We don't claim road navigation (the drive is a straight line), physical-car control, or measured time savings we haven't tested yet.

## What recording the demo taught us

We recorded the demo on the real, signed-in app against the deployed service, and real systems kept us honest.

- **The prompt has to say what the model doesn't know.** In one take My Aide called the driver "Jordan", which was the caller's name, because nothing told it the driver's name was unknown. One sentence in the prompt fixed it, and we redeployed.
- **Budgets work, including on us.** After a dozen retakes we hit our own limit of 30 AI calls per user per hour. That's the limit doing its job, though the app should say "limit reached" instead of "unconfirmed", and that's next on our list.
- **Memory changes the flow.** A remembered destination choice skipped the place list entirely. That is the intended feature, but we had to search a new area to show the list in the demo.
- **Build-time config is part of the product.** One build was missing its Maps key and quietly fell back to a plain grid instead of map tiles. Checking the packaged key is now part of our release check.

## What's next

- A trial on a physical phone and a two-person comparison of time-to-decision with and without Aide, so we can measure the benefit instead of claiming it.
- Road routing that works for Korea, to replace today's straight-line simulation.
- Real telephony, messaging and calendar connections, each behind explicit consent.
- Push notifications for approvals, and connecting vehicle symptoms with backend incidents.

## Try it

- Demo video: https://youtu.be/oi7qsd9OR8o
- Live prototype: {{PRODUCT_URL}}. Sign in with Google under *My GCP workspace* to get your own simulated Aide EV.
- Source code: {{REPO_URL}}

*Team Aide: Byung Min Choi and Jae Hyuk Choi. Aide is not affiliated with any vehicle manufacturer.*

Medium tags: Artificial Intelligence, Google Cloud Platform, Gemini, AI Agents, Hackathon
