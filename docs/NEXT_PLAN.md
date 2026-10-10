# Next plan

Live status: see `docs/STATUS.md` (Live deployment). Remaining live validation:
1. Decide how to treat the omitted `reconciling` boolean from Cloud Run v2 (see the open finding in `docs/STATUS.md`). Until then live reads stay "incomplete".
2. Add a Google account on the emulator and sign in; compare the web and device state.
3. Decide whether to enable notifications: this needs min instances 1 and always-on CPU. Then run a real FCM send.

Development resumed on 2026-10-10 by user instruction. The server-side notification recipient mapping, authority/transport adapters and worker are done (synthetic only; see `docs/STATUS.md`). Every remaining item needs a user decision or approval before work can start.

- Historical items below were written before the user's approvals; approved ones are tracked above.
1. **Eligibility (user decision):** the user stated that the original project was never submitted. Confirm whether the official FAQ also restricts work created before the program. Review English submission materials separately.
2. **GCP choices (user decision):** project, service, region, model and budget. Then validate real Firebase login, memberships, bounded reads, Gemini output and Firestore persistence. With notifications enabled, also validate the service account's Firebase user lookup, FCM send permissions and real FCM acceptance.
3. **Android SDK/license consent (user approval):** needed before APK, lint and device checks. The same approval covers adding `com.google.firebase:firebase-messaging` and a `PushTokenSource` factory/messaging service for the app's FCM token source and device reception.
4. **Docker/deployment authorization (user approval):** validate the real Cloud Run deployment. If notifications are enabled, set CPU allocation outside requests and minimum instances for the worker. Then create submission artifacts.

AWS company SSO/fork and local On-Prem work belong to CloudOps-Automation, not this repository. Commits, pushes, remote creation, deployment and submission remain unauthorized until the user asks for them.
