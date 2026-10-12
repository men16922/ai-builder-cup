# Submission checklist (deadline 18 Oct 2026)

What the competition asks for, and where this repository stands. Items marked **owner** can only be done by a person.

| Requirement | Implemented | Published / submitted | Notes |
| --- | --- | --- | --- |
| Team of 2–4, registered | Done (2026-10-12) | Done | Registration and invitations confirmed by the owner. |
| Deployed link (Cloud Run) | Done | Link not yet in Devpost | Console and the five services run on Cloud Run. Judges can try a labeled rehearsal without signing in; the live crew needs an allow-listed account (see decision 2). |
| Public GitHub repository | Done | Pushed up to `1bf9209`; later work local | Run `make check` and `npm run check:publishable` before every push. |
| Demo video under 3 minutes | Recorded (`submission/aide-demo-final.mp4`, local, ignored by Git) | **owner**: upload | Re-record only if the shown approval card or report wording changed. |
| PDF deck, English | Done, rebuilt 2026-10-12 (single-use approvals, held-out 13/18) | **owner**: attach in Devpost | `node --import tsx submission/deck/build.mjs`. |
| Devpost and Medium text | Done, updated 2026-10-12 | **owner**: fill `<DEPLOYED_URL>`, `<VIDEO_URL>`, `<REPO_URL>`, `<CONTACT>` and submit | After the Android teammate's physical-device run, update the "emulator, not a physical device" lines in both. |
| All materials in English | Done | — | The product UI is Korean and English. The Android onboarding guide is Korean on purpose (internal). |
| Built inside the window (7 Sep – 18 Oct) | — | **owner**: confirm against the official rules | The prototype's Git history starts 2026-10-09. Older projects were not copied, only ideas. |

## Open decisions for the owner

1. **Product name.** Decided: **Aide** (confirmed 2026-10-11). It is applied in the console, the Android app, the deck and the documents. Deployed resource names and the Android package id keep their original identifiers on purpose. `node scripts/apply-brand.mjs "<Name>"` would change the name everywhere if that ever changes.
2. **How judges reach the demo.** The live console requires Google sign-in with an allow-listed account. Without any sign-in, the deployed console opens in a labeled **rehearsal mode**: the same frame driven by a scripted crew with synthetic data, clearly labeled, with no API or model calls. It shows the interaction (instruction, steps, approval, report, dashboard change) but not live agents. Decide whether to also add judges' accounts to the allow list so they can see the real crew; that needs account names from the organizers.
3. **Repository name.** Created as `ai-builder-cup`, public. It is deliberately not tied to the product name, so a rename does not need a new repository.
4. **Push notifications.** Off in the deployment. Enabling needs the FCM configuration and a signed-in device.

## Final pass before submitting

- `make check` green, `npm run check:publishable` green.
- No project number, project ID, account email or token in the repository, deck, video or screenshots.
- The deployed revision matches the repository's `main` commit.
- Judges' path tested from a clean browser profile.
