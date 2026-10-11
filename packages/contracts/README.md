# packages/contracts

The schemas and types that the web console, the gateway and the Android fixture generator all depend on, written once with Zod. It is source only (no build step): other code imports it through the `@contracts/*` alias (`tsconfig.json`, `apps/web/vite.config.mjs`).

- `src/core/` — provider-neutral building blocks: owners, bindings, evidence, the plan/execution workflow, and the sign-in edition type.
- `src/gcp/` — everything specific to this product: Cloud Run observations and telemetry, analyses, workflow, the crew's task and approval shapes, the overview, notifications and the mobile API.

The browser and the gateway validate the same shapes, so a drift shows up as a type error or a failed parse, not as a silent difference.

Known leftover: `src/core/operations.ts` still carries the provider-neutral target and action union (AWS, Azure, on-premises) from the multi-provider design this code was extracted from. Only `gcp` is used and the gateway rejects every other provider; a few tests rely on those schemas to prove the rejection. Narrowing the union to GCP is a possible follow-up, not a behavior change.
