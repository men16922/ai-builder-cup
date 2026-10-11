# Build and deploy

Everything here runs against **your own** Google Cloud project. Replace the `<…>` placeholders. Real project identifiers, service-account emails and the configuration file stay outside Git (`.data/` is ignored, and `npm run check:publishable` fails if a listed identifier appears in a tracked file).

## What gets deployed

| Service | Built from | Notes |
| --- | --- | --- |
| Console + gateway (one service) | `dist/gateway` (made by `npm run build`) | Public HTTPS. Reads its configuration from a mounted secret file. |
| Chief, Ops, Diagnosis, Guardian | `apps/crew` (one image, `AGENT` selects the role) | Private. Callers present Google identity tokens. |
| `shop-api` (demo target) | `apps/shop-api` | Two revisions, `shop-api-good` and `shop-api-bad`. |

## 1. Build the console and gateway

```sh
npm ci
npm run build          # typecheck, source boundary, web bundle, gateway bundle in dist/gateway
make check             # offline checks, including the browser flows and the publish gate
```

`dist/gateway` holds `server.mjs`, the hashed web assets, a minimal `package.json` with exact locked runtime dependencies, and the Dockerfile from `deploy/gateway/`.

```sh
gcloud builds submit dist/gateway --project <project> --region <region> --tag <region>-docker.pkg.dev/<project>/<repository>/gateway:<tag>
```

## 2. Gateway configuration

Copy `deploy/gateway.config.example.json` outside the repository and fill in your project, Firebase web configuration, the registered Cloud Run services and who owns them, the model, and the agent URLs. The file is strict: unknown fields are rejected, and it can name only one project. Mount it as a secret and point `MOBILEOPS_GCP_CONFIG` at the absolute path. The gateway is disabled unless `MOBILEOPS_GCP_HOSTED_ENABLED=1` and `MOBILEOPS_GCP_ENABLED=1` are set.

Who may use the crew is decided by ownership: a person needs membership in the organization that owns a registered service (`apps/gateway/src/auth`), or a personal binding to it. Provision a member after their first sign-in with `scripts/provision-gcp-membership.ts`.

## 3. Build and deploy the crew

```sh
gcloud builds submit apps/crew --project <project> --region <region> --tag <region>-docker.pkg.dev/<project>/<repository>/crew:<tag>
```

Deploy four private Cloud Run services from that image with `AGENT=chief|ops|diagnosis|guardian`, each with its own service account (see `apps/crew/README.md` for the settings each role needs). The signing key for approvals lives in Secret Manager: the gateway signs, only Ops verifies.

## 4. The demo target and traffic

```sh
apps/shop-api/reset.sh <project>     # serve the faulty revision (the story starts here)
apps/shop-api/traffic.sh <url>       # generate requests so the dashboard has metrics
```

## Checks that need no cloud

`make check` (web, gateway, browser, drift, publish gate), `make check-agents` (Python crew), `make check-android-core` (Kotlin core against the real gateway code). None of them calls Google, installs dependencies or needs credentials.
