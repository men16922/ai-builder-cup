# GCP identity boundary

Firebase verifies the web/native user identity; the server derives the actor and checks workspace ownership/membership and roles separately. Selecting an organization or a language does not grant access. A Firebase user token is not the service identity token used for Cloud Run/Logging/Monitoring APIs.

The relevant adapters are `apps/gateway/src/auth/firebase-identity.ts`, `apps/gateway/src/config/firebase-services.ts`, `apps/web/src/identity/firebase/` and `apps/android/app/src/main/java/app/mobileops/agent/app/AndroidFirebaseIdentity.kt`. Live token/tenant/role behavior remains unverified. No AWS IAM Identity Center login, shared CLI session, company worker or imported account configuration exists in this repository.

Use the explicit configuration in `docs/archive/runbooks/server.md`. The source example uses synthetic identifiers and does not grant permissions. Do not infer live identity or isolation from synthetic tests.
