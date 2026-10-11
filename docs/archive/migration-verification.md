# Migration verification — 2026-10-10

All commands below ran in this independent repository after extraction. The original source tree and node_modules were not used for module resolution.

- Local Git: separate `.git`, branch `main`, zero commits, no remotes. No commit, push, GitHub creation, deployment or submission.
- npm: exact versions/resolutions extracted from the original lock; 352 locked packages, 284 packages installed for this platform by `npm ci --offline --ignore-scripts --no-audit --no-fund`. `npm ls --all --offline` passed. No new dependency version was selected.
- `make check` equivalent `npm run check`: type checking, runtime/type/test source boundaries, independent Vite/API build, **141/141 server tests**, generated mobile fixtures, actual GCP HTTP/browser workflow, and hosted artifact smoke all passed. The hosted artifact retains 3 direct/173 locked runtime packages.
- Browser checks cover Korean/English, 320/390px layouts, accessibility, explicit reads, review without reads, same-request recovery, persisted results after reload, owner/workspace and revoked-identity rejection, disabled real configuration and synthetic rehearsal. Hosted smoke also verifies excluded APIs, isolated SDK imports and SIGTERM shutdown.
- `make check-android-core`: **49 tests, 0 failures, 0 errors, 0 skipped**. This includes Kotlin/native HTTP to the GCP workflow using synthetic Google/auth/model ports. Generated web/Kotlin evidence vectors matched. No APK or device UI was compiled or checked.
- Negative controls: valid TypeScript importing a type from an injected AWS module passed TypeScript but failed the source boundary. A runtime AWS import failed the Vite boundary. The temporary module was removed and the original entry bytes restored. Both AWS SDK packages were absent from dependency resolution. All 18 dependency symlinks remained inside this repository's node_modules.
- Node 24 binaries and existing Gradle wrapper/dependency caches were copied into ignored `.tools` only to support local verification. Installed Homebrew Java 21 and the existing Chromium installation were used. No Android SDK was installed or license accepted. Generated outputs/caches are not source deliverables.
- Imported source/asset hashes and exact dependency metadata are recorded in `docs/provenance/source-manifest.json`. Migration-specific documentation was added separately. Original private AWS data and `.env` were not copied. The original preservation auditor confirmed unchanged saved records/settings after migration.

Local logs (outside Git): `/tmp/ai-builder-cup-install.log`, `/tmp/ai-builder-cup-dependencies.log`. The migration-time check/android logs at `/tmp/ai-builder-cup-check.log` and `/tmp/ai-builder-cup-android.log` were overwritten by the 2026-10-10 increment run below. These are local evidence, not remote CI or cloud verification.

Live Google/Firebase/Gemini/Firestore/FCM, SDK/APK/device, Docker, deployment, source eligibility and publication remained unverified at migration.

## Development increment — 2026-10-10 notification delivery composition

The user resumed development. Server-side recipient mapping, the Firebase authority, the FCM transport and the worker were added (see `docs/STATUS.md`). Both gates were re-run in this repository:

- `make check`: passed. **149/149 server tests**: 141 existing, 7 in `apps/gateway/test/notification-delivery.test.ts`, and 1 extended configuration/composition test. Fixtures, GCP web/browser integration and the hosted artifact (173 locked runtime packages, isolated `firebase-admin/auth` and `firebase-admin/messaging` imports) also passed.
- `make check-android-core`: **49 tests, 0 failures, 0 errors, 0 skipped**. The Kotlin core was not changed.
- All new adapters were exercised with injected synthetic ports. The live factory refuses to start offline before any SDK import or token request. No Google, Firebase, FCM or model call, dependency install, Docker run, commit or deployment was performed.

Local logs (outside Git): `/tmp/ai-builder-cup-check.log`, `/tmp/ai-builder-cup-android.log`.

## Live deployment increment — 2026-10-10

After the user's approvals: `make check` passed (149/149 server tests, hosted artifact smoke), `make check-android-core` passed (49 Kotlin tests), and `assembleDebug`/`lintDebug` passed (0 errors). The image built with Docker locally and with Cloud Build, and started on Cloud Run. Live checks that passed: web entry and configuration, Firebase Google sign-in, membership gate, bounded Cloud Run read, empty log/metric result treated as unknown, Gemini analysis with a stored plan and requested review. A live read initially failed because of the short revision-parent ID; it was fixed with a regression test. A later single run in the browser also passed prepare, review request, approval, explicit read and handoff (all 200 in the server log); its result was "required observation incomplete" because the API omits `reconciling`. FCM delivery and on-device sign-in remain unverified. These are single-run local observations, not CI.
