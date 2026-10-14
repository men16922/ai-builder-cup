# apps/web — the console

React and [Material Web](https://github.com/material-components/material-web) (`@material/web`, Material 3). It is laid out like Google Cloud Console: a top bar with an instruction field, a left navigation with titled sections and one entry per registered service, the page itself, and a right-hand rail that expands into the Gemini-style crew assistant.

Until someone signs in, the same frame runs in a labeled **rehearsal mode** (a scripted crew and synthetic data in the browser, no network). Signing in with an account that owns the registered service swaps in the real crew.

```
src/
  main.tsx            entry
  console/            pages and their clients (Routes.tsx picks the page; ConsolePage.tsx wires access)
    ConnectedObservation.tsx   the signed-in console (dashboard, services, plans)
    RehearsalConsole.tsx       the signed-out console
    Dashboard.tsx  Assistant.tsx  agent-client.ts  rehearsal.ts  console-nav.ts …
  shell/              the frame: ConsoleShell (top bar, nav, assistant rail), console-slots, ConsoleHeader
  identity/           web sign-in (Firebase) behind a small interface
  ui/                 thin wrappers around Material Web components (import each component separately)
  i18n.tsx            Korean and English; the language never selects identity or permissions
  brand.ts            the product name (run `node scripts/apply-brand.mjs "<Name>"` to change it everywhere)
  styles.css          layout; theme.generated.css is generated from design/tokens.json
```

Shared schemas come from `@contracts/*` ([packages/contracts](../../packages/contracts)).

```sh
npm run dev                  # http://127.0.0.1:5174
npm run test:agents          # browser flow of the console with a synthetic gateway (tests/browser/crew.mjs)
npm run test:web             # signed-in evidence → plan → handoff flow (tests/browser/workflow.mjs)
```

For authenticated local development, explicitly connect the loopback UI to the existing app gateway with `AIDE_DEV_API_ORIGIN=https://YOUR-SERVICE.run.app npm run dev`. The proxy keeps bearer and workspace checks at that gateway and rejects non-local/cross-site callers. Without this option, `npm run dev` serves UI source only; `/api` is not configured. Use the registered localhost address for Firebase sign-in. Private configuration and credentials remain outside the repository.
