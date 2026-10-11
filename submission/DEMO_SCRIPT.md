# Demo video script (target 2:30, hard limit 3:00)

Record on a phone-width browser window or the Android emulator plus the web console. English narration. Use the demo target `shop-api`, reset with `apps/shop-api/reset.sh` so the bad revision is serving before the take. Use only synthetic traffic.

| Time | On screen | Narration |
| --- | --- | --- |
| 0:00 | Title card, then a person away from a desk with a phone | "Production trouble does not wait for you to reach your laptop. What if you only had to make the decision?" |
| 0:15 | Console dashboard: error rate climbing, `shop-api-bad` serving 100% of traffic | "This is a small storefront on Cloud Run. A bad release just went out. Customers see errors." |
| 0:30 | Type in the assistant panel: "Customers say checkout is failing. Handle it." | "One sentence. That is the whole instruction." |
| 0:40 | Timeline streams: Chief calls Ops, Ops reads Cloud Run, metrics, logs; Diagnosis responds | "A crew of Gemini agents takes over. The Chief delegates over the A2A protocol. Ops reads the service, the metrics and the logs. Diagnosis explains what it sees and what it cannot see." |
| 1:05 | Zoom on a step showing an honest "unknown" | "Notice what it does not do. Missing data is reported as unknown, never as healthy." |
| 1:15 | Approval card appears: rollback `shop-api` to `shop-api-good`, risk, reason, 8-minute window | "Now it needs a decision, and only that. Roll traffic back to the last good revision. Reversible, nothing deleted." |
| 1:30 | Tap Approve and apply | "I approve this exact action." |
| 1:40 | Timeline: Guardian policy check, Ops re-verifies the signature, traffic shifts, crew re-reads | "My approval is signed over this exact action. Only the Ops service can apply it, and it checks the policy and the signature again before touching Cloud Run." |
| 2:00 | Final report; dashboard error rate recovering | "The report says what changed and, honestly, what the metrics cannot show yet." |
| 2:10 | Evaluation slide: scores per scenario, including prompt injection in logs and a destructive request refused | "We measured the crew on six scenarios, including instructions hidden in logs and a request to delete a service. In our final run it refused every unsafe request." |
| 2:25 | Architecture slide | "Built on Gemini, ADK, A2A and Cloud Run: four private agent services behind one gateway, each with least privilege." |
| 2:40 | Closing card with the product name and repo link | "Be the boss. Make the big decisions from anywhere. This is Aide." |

## Before recording

0. Record the real crew from the signed-in console. The signed-out rehearsal is only a fallback and must not be presented as the live crew.

1. `apps/shop-api/reset.sh` so `shop-api-bad` serves traffic; `apps/shop-api/traffic.sh` for a minute so metrics exist.
2. Sign in with the demo account in the intended browser profile. Clear old tasks so the panel starts empty.
3. Keep the approval window (8 minutes) in mind: approve within one take.
4. Do not show project IDs, account emails or URLs with the project number. Crop or blur the address bar.

## After recording

Trim to under 3:00, add English captions, upload as unlisted or public per the submission form, and re-watch once for leaked identifiers.
