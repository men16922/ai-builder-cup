# apps/gateway — API on Cloud Run

TypeScript. It serves the console's static files and the API for the web and the Android app. It verifies the person (Firebase), derives owner, workspace and roles on the server, stores tasks and approvals, signs approvals, and streams from the Chief agent over A2A. It never gives an agent a credential and never runs code an agent wrote.

```
src/
  main.ts  runtime.ts     process entry and the bundled runtime
  http/                   server.ts (static files, health, shutdown) and api.ts (the GCP routes)
  auth/                   web-access.ts (sessions), organization-access.ts (memberships), firebase-identity.ts
  store/                  the store interface, SQLite (tests only), Firestore, record integrity
  workflow/               observations → analyses → plans → reviewed, explicit executions
  crew/                   agent-tasks.ts (tasks and decisions), agent-approval.ts (HMAC), overview.ts, chief-a2a.ts
  cloud-run/              typed, read-only collectors and transports
  notifications/          registration, delivery worker, FCM adapter (disabled in the demo deployment)
  config/                 strict startup configuration and the composition of all of the above
  google/                 credentials, Gemini client
  evaluation/             the offline evaluation pack for the analysis model
test/                     unit and integration tests (run with `npm run test:server`)
```

Rules that the tests enforce: a change needs a verified person and a reviewer role; the crew is open only to people who own a registered service; external calls stay outside retryable store transactions; unknown outcomes are never resent; empty evidence is never "zero" or "healthy".

Build: `npm run build` bundles `src/main.ts` and `src/runtime.ts` into `dist/gateway` (see [docs/DEPLOY.md](../../docs/DEPLOY.md)).
