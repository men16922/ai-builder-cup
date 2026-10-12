# Progress log

## 2026-10-12 — Android teammate access prepared
- Status: teammate account (Google, given by the owner) is to be a member of `cloudops-demo/gcp-operations` (operator, reviewer); it does not exist in Firebase yet. Not committed: ONBOARDING change.
- Changed: `apps/android/ONBOARDING.md` now says the teammate uses the organization workspace and signs in once on the web console first (uncommitted). A background watcher (local scratchpad script, 30 s polling, 2 h) waits for the account in Firebase Auth, then runs `scripts/provision-gcp-membership.ts` and appends the user to `.data/gcp/users.json`. Actor-id formula verified against the two existing users.
- Verified: nothing run against the live store yet (the account was not found at 2026-10-12); `check:publishable` passed.
- Blockers (owner): send `mobileops-agent.json` (local, Git-ignored) privately; push ONBOARDING (needs the owner's request); register the teammate's debug SHA-1 in Firebase once received (cannot be done by the teammate).
- Next: after the teammate's web sign-in, confirm membership; register SHA-1; then the device run (ONBOARDING step 7).

## 2026-10-12 — Submission surface refreshed (P4.3, P5.1, P5.3, P5.4)
- Changed: deck builder states single-use approvals, the held-out first run (13/18, read from the recorded results) and the first user; deck rebuilt. Devpost and Medium text updated for the five execution states, single-use approvals, held-out score, the live-run bug in our own fix and the live restart result; stale "next" items removed. README names the first user and has an "After the submission" roadmap (Dev agent, multi-cloud, more operations, durable task store). `submission/SUBMISSION.md` separates implemented from published. Test env var removed from `agent-chief`.
- Verified: `make check-all` exit 0 (gateway, crew 54, browser flows, hosted artifact, publish gate).
- Open (not engineering): physical device and phone backgrounding (Android teammate), human comparison (two people), judge access and video upload (owner), live replay of one approval (needs the owner's tap). Uncommitted.

## 2026-10-12 — P3 restart behaviour, live with real data
- Status: P3.1 settled with no deployment change (gateway already `cpu-throttling=false`; task record in Firestore; app only reads). P3.2(b) run live.
- Verified: real crew run on `shop-api-bad` (300 generated requests), approval card shown; `agent-chief` redeployed (`agent-chief-00011-vpn`, env `AIDE_RESTART_TEST` added) while pending; owner approved; Chief `TaskNotFoundError`, no Ops `/execute`, task `unknown` "not retried", traffic read back 100 % `shop-api-bad`.
- Decision: keep `unknown` (A2A wraps the missing task as a generic internal error mid-stream, so "nothing was sent" cannot be proven by the gateway).
- Next: phone backgrounding (P3.2a) and physical device (P3.3) by the Android teammate; README/STATUS refresh; human comparison.

## 2026-10-12 — Android teammate onboarding
- Status: team registration and invitations done (owner). Added `apps/android/ONBOARDING.md`, `apps/android/scripts/doctor.sh` (read-only environment check, prints the debug SHA-1 to send the owner) and the missing `deploy/android-mobile.example.json`; Android README refreshed.
- Verified: `make check-android-core` (49), `assembleDebug` + `lintDebug` pass; fresh APK installed and launched on the emulator; doctor passes on the owner's machine.
- Blockers (owner): hand over `mobileops-agent.json`; register the teammate's SHA-1 in Firebase; allow their Google account on the registered service; put `shop-api` in the faulty state before their run. Uncommitted.
- Next: teammate runs the device checklist in ONBOARDING.md step 7 and records it in `docs/EVALUATION.md`.

## 2026-10-11 — Execution states, single-use approvals, held-out evals, live approval run
- Status: implemented, deployed (crew `crew:20261011-171831`, gateway `cloudops-auto-00014`); all changes uncommitted since `489eceb`.
- Changed: five execution states (`refused|pending|applied|failed|unknown`, HTTP 403/202/200/502/504, never resend on unknown); approvals single-use per instance, refused when the service changed after approval or the window exceeds 5 min; Chief instruction rewritten (rollback offered with unconfirmed earlier revision); web state chip and Android state lines; evaluation extended (held-out 6, live finding case); README verification table; docs aligned.
- Verified: `make check-all` exit 0 (crew 54 tests, gateway, browser flows); Android core test, assemble, lint; live run in the signed-in browser: `/execute` 200, `status=applied`, traffic read back, chip shown; evals 18/18 core and held-out after fixes (held-out first run 13/18, live finding 2/3 then 3/3).
- Blockers: not seen live: same-approval replay, `pending`/`unknown`; Android reinstall on emulator; physical device. Commit/push needs the owner's request.
- Next: see `docs/NEXT_PLAN.md`.

## 2026-10-11 — Console redesign, repo restructure, live verification, demo video
- Status: submission material done except owner actions; drafts for Devpost and Medium committed locally (not pushed).
- Changed: crew access needs ownership of a registered service (`crew_not_entitled`); one console at `/` with Cloud Console style navigation and a right-hand Agent Chat; repo restructured into `apps/` and `packages/contracts` (Google Cloud only); history rewritten to drop committed caches and a local path; name Aide confirmed; female narration (ElevenLabs) and a two-pane demo video.
- Verified: `make check-all` (gateway 167, crew 33, browser flows with axe), Android core test, assemble and lint; live web and Android crew runs on the deployed services (signed approval applied, honest report); publish gate passes.
- Blockers: team registration, video upload and placeholders are owner actions.
- Next: see `docs/NEXT_PLAN.md`.
