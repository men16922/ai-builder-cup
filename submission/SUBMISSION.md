# Submission checklist (deadline 18 Oct 2026)

What the competition asks for, and where this repository stands. Items marked **owner** can only be done by a person.

| Requirement | State | Notes |
| --- | --- | --- |
| Team of 2–4, registered (closes 11 Oct) | **owner** | Not something the repository can do. Students are disqualified. |
| Deployed link (Cloud Run) | Done | Console and the five services run on Cloud Run. Judges can try a scripted, labeled rehearsal without signing in; the live crew needs an allow-listed account. |
| Public GitHub repository | Done | Public as `ai-builder-cup` (first commit pushed 2026-10-11, 302 files, `npm run check:publishable` passed first). Run the check again before every push. |
| Demo video under 3 minutes | **owner** to record | Script in `submission/DEMO_SCRIPT.md`. |
| PDF deck, English | Draft ready | `submission/deck/deck.pdf`, rebuilt with `node --import tsx submission/deck/build.mjs`. |
| All materials in English | Mostly | README, architecture, evaluation, deck, script are English. The product UI is Korean and English. |
| Built inside the window (7 Sep – 18 Oct) | Needs the owner's confirmation | The prototype's Git history starts 2026-10-09. Older projects were not copied, only ideas. |

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
