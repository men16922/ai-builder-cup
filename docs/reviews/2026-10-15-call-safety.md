# Call uncertainty and source integration — 15 October 2026

This review covers the published in-car source at `6720b20`. It does not certify deployment, a physical phone or a continuous actual demonstration. The full award-readiness objective remains incomplete.

## Failure reproduced and corrected

A failed model answer left the call `ringing`; a failed reply left it `active`. A different request key and recreated service could invoke the same uncertain answer again: the negative fixture observed two provider calls where one was intended. Merely keeping the original request receipt was insufficient.

The server now reserves one durable provider step for the captured call snapshot. Different keys and service instances cannot start another step while that claim is pending. A provider error records `unknown` without discarding the confirmed transcript. A 30-second deadline lets a read mark a vanished step unknown without invoking the model. A late reply cannot revive it. Cleanup compares the exact captured call, so a newer confirmed call is preserved. Empty provider turns are unconfirmed rather than successful empty progress. Existing current membership and vehicle-version fences remain in force; the model call remains outside store transactions.

`apps/gateway/test/mobility-call-safety.test.ts` verifies six cases:

1. A failed answer is unknown across a fresh key and recreated API instance, with one provider invocation.
2. A failed reply preserves the confirmed transcript and creates no summary/follow-up.
3. An old failure cannot overwrite a newer confirmed call.
4. Two API instances cannot start the same pending call step.
5. Expiry records unknown, fences late completion and refuses replay.
6. An empty model turn is unknown and cannot be repeated as the same call.

These use synthetic identities, a shared local SQLite store and a model stub. They exercise the durable-store contract; they do not establish live Firestore contention, an actual killed Cloud Run worker or provider accuracy.

## Client and compatibility evidence

The unknown call remains visible with its confirmed transcript and read-only guidance. There is no answer/reply/retry control in that panel. The authenticated synthetic browser test reloads from the server, checks Korean/English, reads/dismisses without another answer/model/follow-up, and passes 390px layout and axe checks. `test:call-safety` is part of the full web gate. Captures are synthetic test scenes.

The integrated in-car browser test covers controls, attributed photo cards/numbered markers, simulated calls and follow-up drafts, saved history, diagnosis and error manuals. The web/API suite contains 219 passing tests at this snapshot. Android core 69 and app unit 3 pass with no skips, plus assembly/lint. A frozen older Android contract first failed against the expanded server response; the published DTO update passes. This does not make an earlier installed APK compatible with the expanded payload or prove the ongoing native UI parity work.

Existing private successful direct-provider records were inspected, without repeating paid calls: a local synthetic-identity flow using real Gemini ended with six turns, a summary and two draft follow-ups; a Maps flow returned five places with photos and author attribution. This is direct provider/local-service evidence, not authenticated deployed web/native evidence, an original first-attempt benchmark or real messaging/calendar execution.

## Remaining acceptance

- Finish and validate native controls/call/diagnosis/photo UI; record the exact installed APK before phone testing.
- Deploy the exact reviewed source and verify actual tiles/photos and a Gemini call from the deployed authenticated app. The earlier first-fold deployment is a different immutable bundle.
- Preserve safe version fencing while testing delayed model work during simulated movement; a fast fixture alone does not prove smooth motion during real model latency.
- Physical phone, real V2 reviewer/conflict, paired human impact, current continuous demonstration and owner eligibility/submission remain open. No real phone call, outward message/calendar operation, cloud mutation or submission was performed by these checks.
