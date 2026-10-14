# Submission checklist (deadline 18 Oct 2026)

What the competition asks for, and where this repository stands. Items marked **owner** can only be done by a person.

| Requirement | Implemented | Published / submitted | Notes |
| --- | --- | --- | --- |
| Team of 2–4, registered | Done (2026-10-12) | Done | Registration and invitations confirmed by the owner. |
| Deployed link (Cloud Run) | Done | Link not yet in Devpost | Console and the five services run on Cloud Run. The signed-out mobility welcome has no demo actions. Personal drivers sign in with Google; cloud operations need current registered ownership/membership (see decision 2). |
| Public GitHub repository | Public baseline exists; current candidate not published | Remote `main` rechecked at `5ac003a` on 2026-10-15; this session's changes local | Current deployment and public repository are not reconciled. Run `make check` and `npm run check:publishable` before an owner-authorized push. |
| Demo video under 3 minutes | Recorded (`submission/aide-demo-final.mp4`, local, ignored by Git), 85.6 seconds | 150-second narrated product presentation prepared separately (synthetic screenshots, not continuous live capture). Re-record actual demo before upload; then **owner**: upload | 14 October spot check found a visible internal approver ID, older execution wording and dashboard/read-back disagreement. See `docs/plans/2026-10-14-demo-review.md`; preserve the original. |
| PDF deck, English | Mobility/authority/evidence deck rebuilt locally on 15 October; 10-page PDF visual QA and text-bound checks passed | **owner**: attach in Devpost | `node --import tsx submission/deck/build.mjs`. |
| Devpost and Medium text | Devpost refreshed for mobility on 15 October; Medium historical narrative explicitly dated | **owner**: fill `<DEPLOYED_URL>`, `<VIDEO_URL>`, `<REPO_URL>`, `<CONTACT>` and submit | After the Android teammate's physical-device run, update the "emulator, not a physical device" lines in both. |
| English submission package | Deck and entry draft ready; actual demo pending | — | Product localization remains Korean/English; internal Korean onboarding is separate. Audit the final submitted files against the organizer's English-materials requirement. |
| One problem statement/theme | Future of Work & Enterprise Productivity | **owner**: confirm the same category in the dashboard | Vehicle assistance and cloud response illustrate interrupted work; no implemented vehicle-to-backend causal correlation is claimed. |
| Built inside the window (7 Sep – 18 Oct) | Unproven for every extracted/dirty file | **owner**: reconcile source evidence against the official rules | Inspected Git history starts 2026-10-09; that does not date all mixed-worktree files. The immutable extraction manifest is not an eligibility certificate. |

## Open decisions for the owner

1. **Product name.** Decided: **Aide** (confirmed 2026-10-11). It is applied in the console, the Android app, the deck and the documents. Deployed resource names and the Android package id keep their original identifiers on purpose. `node scripts/apply-brand.mjs "<Name>"` would change the name everywhere if that ever changes.
2. **Judge access.** Signed-out visitors see the mobility welcome and Google sign-in. There is no public rehearsal or anonymous control. Personal simulation is actor-private; cloud operations require current membership and registered ownership. Coordinate any allowed judge account and a reviewed actual-run video with the owner; never expose mutation rights publicly.
3. **Repository name.** Created as `ai-builder-cup`, public. It is deliberately not tied to the product name, so a rename does not need a new repository.
4. **Push notifications.** Off in the deployment. Enabling needs the FCM configuration and a signed-in device.

## Final pass before submitting

- `make check` green, `npm run check:publishable` green.
- No project number, project ID, account email or token in the repository, deck, video or screenshots.
- The deployed source/artifact record and submitted repository revision are reconciled. Current deployment is from uncommitted source; public hashes match, but remote Git parity is not established.
- Judges' path tested from a clean browser profile.
