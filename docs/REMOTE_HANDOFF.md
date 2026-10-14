# Continue from the remote repository

Git contains the implementation, contracts, tests, example configuration, original product assets and current work pointers. It does not contain the live configuration, account records, signing material, APK, machine toolchains or local presentation/evaluation exports. This checklist describes the additional information to request privately, without copying secrets into issues, chat logs or commits.

## Restore the exact work state

1. Check the branch/commit with `git status -sb`, `git log -1` and `git ls-remote origin refs/heads/main`. The owner authorized commit and push on 15 October; the current Git refs, rather than older snapshot SHAs in historical notes, identify what was published.
2. Read `AGENTS.md`, `docs/AGENT_BRIEF.md`, `docs/STATUS.md`, `docs/NEXT_PLAN.md` and `docs/plans/2026-10-15-final-readiness-audit.md`. The brief's first resume action wins over older plans.
3. Current first action is the pending manual organization Google login/result, followed by one registered-service read-only Chief investigation. The successful personal vehicle/map/help inspection is separate from two later organization popup-closed outcomes. The popup cause remains unproven; do not infer a membership failure.

## Private information required for live work

| Area | Required information | Where it belongs |
| --- | --- | --- |
| Local web connection | Approved gateway HTTPS origin and permitted local origin; current Firebase authorized domains | Explicit `AIDE_DEV_API_ORIGIN` when starting Vite; loopback entry is localhost. Configuration comes from the gateway, not a client-selected role. |
| Android login and maps | Private `mobileops-agent.json`, Firebase Android app/API settings, Web OAuth client ID, restricted Android Maps key, intended workspace | `apps/android/app/src/main/assets/mobileops-agent.json` and build environment `AIDE_ANDROID_MAPS_KEY`; see `deploy/android-mobile.example.json` and `apps/android/ONBOARDING.md`. |
| Android signing | Package name and SHA-1/SHA-256 of the APK that will actually be installed; confirmation of Firebase/OAuth/Maps registrations | A new machine's debug certificate can differ. Register approved fingerprints; do not transfer a signing private key merely to reproduce a debug build. |
| GCP runtime | Active project/region, gateway and four crew URLs, existing runtime service accounts, mounted configuration Secret/version, model/location, enabled APIs and provider restrictions | Private deployment inventory and approved console/CLI access. Start from `docs/DEPLOY.md`, `docs/MAPS.md` and `deploy/gateway.config.example.json`; the example alone does not enable the deployed mobility setup. |
| Service authority | Registered Cloud Run UID/revisions, observation ownership, explicit allowed remediation destinations, fixed Ops gateway origin and approval-Secret references | Private server configuration / Secret Manager. Observation targets and mutation targets are separate. No HMAC key, access token or service-account key goes into a client or model. |
| Workspace access | Authorized Google account, derived server identity, current organization membership/roles/version, personal or organization workspace | Server-side records, verified after sign-in. Registered signing fingerprints do not establish app access, and a display-language change never changes authority. |
| Outstanding evidence | Device/date/candidate/result for physical phone, manual login outcome, actual reviewer decision/conflict, paired pilot measurements and approved submission links | Private recording sheets with public summaries stripped of identities. Owner and teammate supply these; automated fixtures cannot stand in for people. |

Ask for references and the minimum scoped configuration, not a dump of `.data`, `.env`, signing keys or a personal CLI session. Access to a public repository does not grant GCP IAM, workspace membership or mutation permission. Runtime authentication uses approved existing identities; no extra IAM or public mutation route should be created to bypass the handoff.

## Toolchain and checks

Node 24+, Python 3.11+, and the Android versions in `apps/android/README.md` are required. SDKs, Gradle dependencies and `.tools/venv-agents` need their own first-time preparation; Git does not supply the owner's caches. Install dependencies before running the offline gates:

```sh
npm ci
make check
make check-agents
make check-android-core
```

The Python target expects `.tools/venv-agents`; see `apps/crew/README.md` for its dependencies. Android app unit/lint/assemble and connected tests are separate commands in its README. A missing toolchain is not a failing product test; prepare it explicitly, then rerun the required gate. Preserve the MVVM boundaries, device string resources, comments and ktfmt formatting.

## Local exports and measured results

This ship unit holds back `submission/deck/deck.html`, `submission/deck/deck.pdf` and the three new 14 October qualification JSON run outputs. Older tracked exports/results can still exist in a fresh checkout; their presence does not make them current. The reviewed current APK, narrated slide video and actual private screenshots are also outside Git.

Rebuild the current deck from its committed source and selected synthetic image assets:

```sh
node --import tsx submission/deck/build.mjs
```

The current local PDF has ten pages; the narrated presentation is a 150-second synthetic slide presentation, not a continuous actual demo. Request frozen qualification records privately if auditing the first outcomes, including failures and source hashes. Do not rerun a model evaluation and relabel it as the original first run.

## Limits to preserve on resume

- Vehicle, charging and driving are simulation; genuine Google tiles/places are separate observations. Movement is straight-line, not road navigation. Seoul route controls were empty while the same identity returned a California polyline. Korea-capable routing requires explicit provider configuration or an explicitly chosen supported simulation region.
- Known-case response needs an active verified case and current bounded policy; the test policy was disabled after verification. Promotion alone executes nothing and grants no autonomy. Unknown/expired outcomes never automatically resend.
- V2 source/negative broker checks and isolated Firestore claim contention pass. Actual human-approved V2 cloud mutation and real conflict remain unverified; do not manufacture a reviewer grant or use CLI auto-approval.
- Physical-phone/native live tiles, human productivity, current continuous demonstration, eligibility and submission receipt are incomplete. Git push does not establish remote CI, a fresh cloud deployment, a video upload or a competition submission.
- Owner authorization for this commit/push does not authorize publishing private APK/configuration, uploading the video, accepting a new provider's terms, broader IAM, deletion or submitting the entry.
