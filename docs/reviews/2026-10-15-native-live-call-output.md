# Native signed-in workflow and uncertain call output - 15 October 2026

This is actual UI-driven engineering evidence on an API 36 emulator, not a physical-phone or human productivity trial. Browser control remains unavailable. Credentials, account details, configuration, raw Google content and recordings stay private.

## Actual app and deployment

The installed APK matches the private prepared `34a14f1` artifact byte for byte. Its packaged origin and Firebase project match the approved gateway. A fresh Cloud Run read confirms the registered UID, runtime specification, ready revision and latest traffic still match the `1742cfe` deployment. No IAM, account registration or runtime setting changed.

The app's real first-run introduction and Google account chooser were used. The sole available native account matches an existing recorded app identity; it differs from the CLI account. No token was extracted, account created or new OAuth scope approved. Real Firebase sign-in and the deployed Firestore vehicle view succeeded. The initial 72 kW value is retained earlier state, not a new recovery result.

Actual native checks then verified:

- Ask: real Gemini returned temperature/climate proposals. Before the taps the climate was off. Each explicit tap received a simulated acknowledgement, and the native control showed the 20-degree target afterward.
- Maps: one real Gemini search and official Maps MCP flow returned five places. Genuine native basemap tiles, matching numbered markers, a real photo and its Google Maps author attribution were visually inspected. The initial state required destination selection. Movement remains straight-line simulation.
- Call: one early automated answer tap did not produce a confirmed start. Its raw recording is preserved; it is not counted as a provider failure or successful call. After an actual background/re-entry read beyond the claim-expiry interval, the server still showed the call ringing. A subsequent explicit answer and delegated reply succeeded in the parked state. This is not proof of real native movement/Stop overlap.
- Summary: the explicit end/summary failed. Bounded Cloud Run HTTP records show answer 200/4.73 s, delegate 200/13.17 s and end 400/2.75 s. A fresh read retained the confirmed transcript as `unknown`, with no summary or follow-up and no automatic resend. These are request timings, not human-time measurements.

## Confirmed classification defect

The valid summary command reached post-admission work and became unknown. The API's general `ZodError` handler reports every schema failure as HTTP 400 `invalid_request`, including validation of a generated response. The exact invalid field in this original provider response is unavailable; do not infer a negative calendar offset, capacity refusal or particular output field from HTTP status alone.

A local HTTP regression deliberately returns an invalid generated summary after accepting a valid command. It confirms one provider invocation and stored `unknown`, while reproducing HTTP 400. The fix maps this post-admission call-output failure to HTTP 502 `mobility_outcome_unknown` after the existing durable cleanup. It does not repair model output, retry the provider, accept an invalid summary or change authority. Truly malformed client input still returns 400 without another provider invocation.

The adapter now retains only fixed phase/field/constraint labels for result-validation failures. Live diagnostics can distinguish bounded validation labels, capacity, deadline and unclassified failure without logging caller text, prompts, values, identities, coordinates or credentials. The explicit offline adapter seam refuses the default live transport. Invalid JSON/envelopes and invalid turn/digest output are classified; runtime identity checks remain intact.

Verification: the new HTTP regression changed from 400 to 502, the fixed-label/no-content and offline transport tests pass, and the full local web gate passes 227 API tests plus browser/axe/hosted/publish checks. Android and crew source are unchanged. This classification increment does not prove the original summary-generation defect resolved or certify its deployment.

## Next measurement

Deploy the exact reviewed gateway source image-only, verify unchanged UID/configuration/assets, then initiate a distinct new fictional call through the signed-in app. Never resend the original unknown summary. If the new call fails, inspect the fixed diagnostic labels and fix only the implicated cause; preserve all first outcomes. A later successful call is separate qualification, not an erasure of the failed one.

The native input controls also share the vehicle-busy flag; its role in the earlier unconfirmed tap needs a held-vehicle reproduction before changing dispatch or version rules. The long grounded Maps summary pushes place cards below several scrolls; any layout improvement must keep the complete provider output and its source links accessible. Physical phone, current web walkthrough, actual V2 reviewer/conflict, paired impact, final actual video and submission remain open.

## Deployed classification and a distinct new call

Source `61a32cb` was published and deployed image-only. UID/runtime configuration stayed identical, latest traffic is 100%, and all six uploaded assets match. The Android APK remains `34a14f1`; new output classification changes no response DTO. No broader IAM, new scope or external follow-up action was used.

A distinct new native call accepted an explicit driver reply about tomorrow at 4:30, generated a delegated response, ended with a real Gemini summary and saved its history. The complete raw call take is 88.693 seconds; it is an actual signed-in emulator recording, not a slide animation or human pilot. It is still private and unedited, not a public final demonstration. The original failed call was not resent or relabeled.

This successful summary revealed separate semantic defects: its text says tomorrow 4:30 pm, but the calendar card shows Friday 12:15 on an Asia/Seoul device. The message card offers completion with no visible body. Neither draft was completed. A valid JSON/schema result therefore does not prove a useful or correct follow-up.

## Independent review of the concurrent date fix

Concurrent source `6638c39` adds server conversion from an agreed KST day/clock instead of asking Gemini to calculate a minute offset. The isolated full web gate passes 228 tests, and tomorrow 16:30 resolves to the expected UTC instant. That code and the later Android-title commit are preserved separately from this review's increment; no physical/native acceptance is inferred from their publication.

Additional controlled probes reproduce acceptance of missing/blank message bodies, missing recipients, calendars/reminders without a time and expired scheduled drafts. A held-summary test with valid authentication crosses KST midnight: the current resolver shifts Friday's agreed event to Saturday because it uses completion time rather than the context sent before model work.

The additive fix preserves the concurrent date resolver, anchors it to the pre-model context, and rechecks completeness/future time at the explicit completion tap. Incomplete or expired drafts stay drafts, including saved copies; explicit dismissal remains available. The model's [structured response schema](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/control-generated-output) requires recipient/body fields for messages and agreed day/time fields for calendar/reminder proposals. Runtime validation still decides readiness; no missing content or time is invented.

Verification: incomplete/expired completion tests fail before the guard and pass afterward; a correctly authenticated midnight reproduction changes Saturday back to Friday; a complete future calendar still completes once. The full isolated web/API gate passes 237 with browser/axe/hosted/publish and the private denylist; root typecheck/publish pass after unchanged-baseline integration. This proves the local boundary and clock behavior, not a fresh deployed/calendar or physical-phone result. Next is exact-source shipping/deployment and one new actual call; preserve the earlier failed and semantically wrong takes.
