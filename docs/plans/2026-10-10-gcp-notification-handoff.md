# Notification follow-up

Implemented and synthetically tested:
- Durable notification intents and per-device generation/CAS.
- Registration retirement before acknowledgement and request replay.
- Current-state open and the Kotlin lifecycle.
- Server-side delivery composition: the private verified Firebase recipient mapping, the Firebase Admin authority, the data-only FCM transport with unregistered-token cleanup, and the bounded in-process worker behind explicit `notifications` configuration.

The Compose and Intent wiring is source only.

Remaining (approval-gated):
- Android FCM SDK and token source.
- Real Firebase/FCM calls and IAM.
- Cloud Run background CPU for the worker.
- Device verification.

Delivery acceptance is not device arrival, and unknown sends are not automatically retried. Cleanup uncertainty remains visible after logout. See [notification contract](../../deploy/gcp-notifications.md) and [next plan](../NEXT_PLAN.md).
