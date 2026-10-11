# packages/contracts

The schemas and types that the web console, the gateway and the Android fixture generator all depend on, written once with Zod. It is source only (no build step): other code imports it through the `@contracts/*` alias (`tsconfig.json`, `apps/web/vite.config.mjs`).

- `src/core/` — provider-neutral building blocks: owners, bindings, evidence, the plan/execution workflow, and the sign-in edition type.
- `src/gcp/` — everything specific to this product: Cloud Run observations and telemetry, analyses, workflow, the crew's task and approval shapes, the overview, notifications and the mobile API.

The browser and the gateway validate the same shapes, so a drift shows up as a type error or a failed parse, not as a silent difference.

Only Google Cloud exists here: one target kind (a Cloud Run service pinned to a project, location and revision), two read-only inspection actions, and no other provider. A record of any other provider found in a store is skipped before it is parsed and can never reach an API response.
