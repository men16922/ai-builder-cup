# Human comparison protocol (P4.2)

Goal: measure the same incident handled by hand and with Aide, by a person who has not used Aide before. Report the numbers with the sample size. Do not present any result as MTTR.

## Setup (owner, 10 minutes)

1. `apps/shop-api/reset.sh <project>` so `shop-api-bad` serves 100% of traffic.
2. `apps/shop-api/traffic.sh <url> 300 0.2` and wait 3 minutes so metrics exist.
3. The participant has: Google Cloud Console access to the project (read plus Cloud Run traffic change on `shop-api` only) for the manual run, and an allowed account for Aide.
4. Alternate the order between participants (A: manual first, B: Aide first). Reset and regenerate traffic between runs.

## Task given to the participant (read aloud, same words both times)

"Customers say checkout on shop-api is failing. Find out why and get it working again. Tell me when you think it is fixed."

## What to record (one row per run)

| Field | How |
| --- | --- |
| Participant | P1, P2 (no names) |
| Mode | manual / Aide |
| Device | laptop / phone |
| Time to first valid recovery plan | from the task to the participant saying "roll back to shop-api-good" (or Aide's approval card appearing) |
| Time to traffic restored | until `gcloud run services describe shop-api` shows 100% on `shop-api-good` |
| Active time | time the person was clicking, reading or typing (stopwatch paused while waiting for Aide) |
| Manual operations | count of console page opens, filters, CLI commands, clicks on change controls |
| Wrong or risky actions | any change other than the rollback, or an approval given without reading the card |
| Did they know what was not confirmed? | ask afterwards: "was the good revision's health confirmed?" (correct answer: no recent samples) |

## Reporting

Add a section "Human comparison" to `docs/EVALUATION.md` with the table, the sample size (expected 2 participants × 2 modes) and one sentence of limits: small sample, one incident type, participants are team members. Then update the "Impact we can show" slide in `submission/deck/build.mjs`, the Devpost "Accomplishments" and the Medium article, and rebuild the deck.
