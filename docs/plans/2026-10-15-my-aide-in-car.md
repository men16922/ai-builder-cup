# My Aide — personal in-car aide

15 October 2026 owner direction. Shift the driver experience from an "agent crew" console toward a personal aide for things a driver does in the car. Freeze 17 October, submit 18 October. Preserve every existing guardrail: simulated vehicle and driving are labelled as simulation, server-verified identity, no automatic resend after an unknown outcome, changes only through explicit server-validated decisions, external data never fabricated.

## Naming decisions (owner, 15 October)

- Product stays **Aide**. The assistant the user meets is written **My Aide** in both languages.
- Invitation phrase: **"Ask your own Aide"** (Korean: "나만의 Aide에게 부탁하세요").
- "Agent crew", "Ask the crew" and "Ask AI Anything" leave user-visible text. Multi-agent stays visible as "My Aide works with a specialist team": Chief → My Aide, Diagnosis → 차량 진단 / Diagnosis, Guardian → 안전 확인 / Safety check, Ops → 실행 / Execution, new call handling → 통화 대행 / Call handling.
- Rejected: "Aider" (an established open-source AI coding assistant, and one letter from the product name), "Ask AI Anything" (generic). Remi was the fallback new name if a separate persona is ever needed.
- Model attribution (Gemini) stays where it describes evidence or analysis provenance; it is no longer the assistant's name.

## Done in this direction

- `5931fa7`: animated, heading-rotated car marker with travelled/remaining route, framing and quiet basemap on web and Android; driving HUD with progress and straight-line distances marked SIM; simplified sign-in on an inverse hero with the simulation disclosure in the legal line. Not yet deployed; real Google tiles not yet checked after the change (stubbed Maps SDK check only).

## Work items

Order is by demo value against the freeze. Web and Android share server behaviour; clients only render it.

### A. My Aide naming (15 Oct)

Web assistant panel, navigation, dashboard and progress labels; Android `AgentScreen` and the Operations tab label become My Aide / "Ask your own Aide". Browser tests and Android string resources follow the new labels.
Done when: no user-visible "crew"/"Agent crew"/"Ask the crew" remains in KO or EN; `make check`, Android core/app/lint pass.

### B. Error popup with a manual (15 Oct)

Remove the "When something goes wrong" card. A failed or unknown request opens a dialog with a short message and **View manual** (설명서 보기), which shows the explanation and next step for that error code (vehicle changed, maps not configured, outcome unknown, in progress, access denied, …). Unknown codes fall back to a generic, honest message. The dialog never retries automatically.
Done when: each mapped code has KO/EN manual text and a browser test opens one.

Native increment: resource manuals and bounded protocol-code forwarding are implemented; unknown HTTP 409 has explicit no-resend guidance. Core 69, app 3, emulator manual 1 and lint/assembly pass on the owned isolated source. Web ErrorManual/in-car work is concurrently owned and remains a separate integration/deployment check.

### C. Place photos and markers (15–16 Oct)

Every map search result shows a Google Maps (Places) photo with the required author attribution, and each result gets a numbered marker on the map that matches its card. Missing photos show a neutral placeholder, never a substitute image. Photo requests use the restricted browser/Android key or a bounded server proxy; no key reaches the model.
Done when: real deployed search shows photos with attribution and markers; offline tests cover missing-photo and marker/card numbering.

### D. In-car call handled by My Aide (16 Oct, demo centrepiece)

1. A simulated incoming call shows a phone icon and a call marker on the car's map position.
2. My Aide speaks first; the driver and My Aide exchange turns (text bubbles, device text-to-speech).
3. The vehicle continues a simulated autonomous drive during the call, labelled simulation.
4. When the call ends, a bottom sheet shows the conversation summary with Save.
5. Follow-ups are proposed as drafts: send a reply message, add a calendar event. Each needs an explicit tap and is simulated in this scope.

Defaults pending owner override: text plus TTS (no speech recognition); simulated follow-ups only, because real Gmail/Calendar sending is outward-facing and needs separate scopes and authorization; one server endpoint produces turns, summary and drafts so web and Android stay thin.
Done when: web and Android complete the flow end to end against the deployed gateway with a real Gemini turn, and an unknown model reply never resends.

### E. Vehicle diagnosis dashboard (16 Oct)

Rename "Aide Help" to **차량 진단 / Vehicle diagnosis**. Show an instrument-cluster style status (battery, range, charging power, temperature) and a top-down car diagram that highlights the affected part when a fault exists (charging port, battery, unknown). Existing guided recovery, case promotion and policy flows move under this view unchanged.
Done when: each simulated fault highlights the matching part in KO/EN on web; Android shows at least the cluster and fault location.

### F. Ship (16 evening – 17 Oct)

Deploy, check real tiles/photos/call flow on the deployed site and a phone, re-record the demo video (`docs/plans/2026-10-14-demo-review.md`), update deck/entry wording only for verified behaviour, freeze.

## Cut order if time runs short

1. Android diagnosis diagram (keep cluster only).
2. Calendar draft in D (keep message draft).
3. Photo proxy (use the restricted client key directly).

## Open owner decisions

- D input mode: text + TTS (default) or speech recognition.
- D follow-ups: simulated drafts (default) or real Gmail/Calendar with new scopes.
- Deployment timing after A–C or after D–E.
