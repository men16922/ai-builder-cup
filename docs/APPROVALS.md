# Real-cloud approval boundary

Updated 15 October 2026. Compatible V2 gateway/Ops is deployed; local regressions, isolated Firestore contention and deployed negative broker probes are verified. Actual human-approved V2 mutation/claim and real etag conflict remain unverified. This applies to registered Cloud Run traffic rollback. Vehicle and driving actions remain simulated and use the separate mobility policy.

## What authorizes a change

1. Firebase identity and current workspace membership admit a task. Owning a registered read resource does not permit mutation.
2. `agents.executionTargets` explicitly pins owner, workspace, project, region, service UID and allowed rollback revisions. The observed revision remains separate from the rollback destination. An absent list disables real execution; ambiguous service bindings fail closed.
3. When a proposal reaches the gateway, a fixed GET reads service UID, etag, update time and complete serving traffic. The person sees observed time and traffic next to the proposed action. Provider reads stay outside store transactions.
4. A current reviewer decision creates a private durable grant and V2 HMAC atomically. It covers exact action digest, reviewer, five-minute lease, grant UUID and reviewed UID/etag/timestamps. Replaying the decision neither re-signs nor re-dispatches it. Historical approvals without reviewed state remain readable but cannot be approved.
5. Ops verifies the signature and deterministic Guardian policy, then reads the fixed service again. UID, etag and update time must match the reviewed state.
6. Ops redeems the capability once at `POST /api/gcp/crew/execution-claims`. The gateway checks the issued grant, original identity expiry, current organization membership/version/reviewer role and current configured target. The claim is an atomic ready → claimed transition.
7. Ops checks expiry before dispatch and sends one traffic PATCH with the reviewed etag. Revision existence is a bounded read. The change is never retried; completion requires operation result and traffic read-back.

The claim broker requires the configured Origin and a matching signed capability. It has no native no-Origin exception, accepts no owner/role/context/action selector, and performs no Cloud Run change. Ops gains no Firestore or new Google permission. Signed capabilities and etags do not enter public task views, models or reports. Private grant records retain no Firebase bearer/session or notification recipient.

The identity check at grant issuance creates a bounded delegation lease. Organization membership is rechecked at redemption. Firebase account revocation after issuance is not continuously checked during the five-minute lease; do not claim continuous revocation enforcement.

## Runtime configuration and rollout

- Gateway: add explicit `agents.executionTargets`, each `{ binding, rollbackRevisions }`; bindings must belong to the configured project/workspace and an existing `agents.services` name/region. Lists are bounded and unique.
- Ops: set `OPS_GATEWAY_ORIGIN` to the canonical HTTPS gateway origin. Empty configuration refuses mutations while reads remain available. Reuse the existing shared signing key through Secret Manager; never put it in JSON or Git.
- Deploy compatible gateway and Ops candidates. V1 approvals are refused. Old/unknown tasks do not resume automatically. Verify actual broker/Firestore/peer behavior before advertising deployed single-use execution.
- A real remediation still needs the person's actual approval tap. Build/deployment permission does not authorize an agent to manufacture that decision.

## Evidence and limits

| Check | Evidence | Scope |
| --- | --- | --- |
| Same signature across two Ops fixtures | Two PATCH attempts before; one after | Synthetic concurrency, injected claim fixture |
| Service changed before approval tap | One PATCH before; zero after | Synthetic reviewed-state drift |
| Reconstructed gateway instances | One grant redemption; repeat refused | Local SQLite and HTTP broker tests |
| Lost claim reply, redirect, malformed acknowledgement, revoked member, expiry and etag conflict | Refused/unknown, no automatic resend | Offline attack and transport tests |
| Actual Firestore contention | Two SDK clients, one winner; recreated client refuses replay | Isolated synthetic record, existing runtime identity; no real approval or Cloud Run mutation |
| Cloud Run `validateOnly` | Fresh and modified etag both HTTP 200; service read-back unchanged | Request-shape preflight only; **does not prove real etag conflict rejection** |
| Compatible deployed gateway / four crew roles | Ready; SAs unchanged, fixed broker configured | Public artifact hashes and deployment read-back; not an execution proof |
| Deployed V2 negative broker probes | Invalid capability / missing Origin / foreign Origin each 403 | No grant creation or cloud mutation |
| Actual V2 human approval / read-PATCH race | Not verified | A real reviewer action and separate conflict evidence remain |

Cloud Run documents [etag as a modification-conflict fingerprint](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services) and [`validateOnly` as non-persisting validation](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services/patch). The observed dry-run behavior limits our evidence; it is not an execution or global-safety proof. Private cloud responses and identifiers stay in ignored records.
