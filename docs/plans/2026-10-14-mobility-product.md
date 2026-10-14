# Aide Mobility — driver experience and incident response

14 October 2026 owner direction supersedes the earlier feature freeze/paused-product scope. Goal resumed. Build new GCP-only code and assets. No copied company material or manufacturer affiliation. Commit/push/publication/submission remain unapproved.

## The problem and product promise

A driver should not have to understand a charging protocol or a failing navigation backend to finish a journey. A responder should not have to stitch together dashboards, deployment state and logs to decide what to do. Aide connects the driver's visible problem with a bounded investigation, an authorized remedy and a verified report.

Keep the Aide brand with Hyundai-inspired restraint, navy/white/blue palette and an original EV image. Tesla supplies a reference for vehicle-centered interaction, not the visual brand. Driver views: vehicle, charging/map, Aide assistance and journey. Web adds operations. Device language selects Android string resources. A navigation view or display language never grants identity or permissions.

The owner explicitly authorized simulated vehicle telemetry, charging and driving, with a serverless data source and non-exact values. Mark every vehicle value and journey as simulation. Google Places/Maps results, when connected, are real external data with source/availability labels. No physical vehicle controls, payment or restaurant bookings. Do not turn an API failure into a fabricated restaurant or charging station.

## Evidence from real cases (design requirements are our inference)

- Cloud: Google Cloud's [12 June 2025 incident report](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW) describes invalid policy data causing crash loops and 503s; some monitoring failed too. Inference: unknown telemetry needs a visible escalation path; absence of a signal is not recovery.
- Server: Cloudflare's [2 July 2019 postmortem](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/) links a deployed WAF rule to CPU exhaustion and 502s. Inference: compare the change with serving signals and constrain rollback to the reviewed state.
- App/data: GitHub's [21 October 2018 analysis](https://github.blog/news-insights/company-news/oct21-post-incident-analysis/) describes stale/inconsistent information and delayed work after a network partition. Inference: show freshness and distinguish accepted writes from completed customer-visible outcomes.
- Operational demand: [Google SRE incident response](https://sre.google/workbook/incident-response/) combines mitigation, coordination and communication; [PagerDuty Runbook Automation](https://www.pagerduty.com/platform/automation/runbook/) exposes controlled automations with RBAC and approvals. Inference: an assistant needs an execution boundary and a report, not only a summary.
- Vehicle interaction: [Tesla app support](https://www.tesla.com/support/tesla-app) is the public reference for vehicle, location and charging access. Our implementation is a simulator, not Tesla Fleet or Hyundai Bluelink integration.
- Maps: [Places API authentication](https://developers.google.com/maps/documentation/places/web-service/get-api-key), [Maps security guidance](https://developers.google.com/maps/api-security-best-practices), [Places reference](https://developers.google.com/maps/documentation/places/web-service/reference/rest). Use scoped server-side calls, field masks, bounded radius/count and explicit location consent. Charging availability can be missing and must not be invented.

These cases establish needs, not proof that Aide reduces MTTR or improves B2C conversion. Measure paired response time, responder active time, wrong remediation, customer-visible failed requests and journey completion separately. No numerical productivity or award claim without measurements.

## Executable behavior

1. Serverless vehicle twin: actor/workspace-scoped Firestore records, versioned snapshots, battery/charging/location, simulated fault injection and persisted reports. Separate model proposals from Guardian execution.
2. Known charge-session fault: AI selects a registered typed runbook. Auto-remedy only inside an explicitly enabled, short-lived policy; parked simulation, safe temperature, matching current evidence/version, one attempt per episode. Report before/after, authority and remaining unknowns. Failure or unknown never resends a change automatically.
3. Unknown situation: escalate rapidly, show evidence and the unmet conditions, work with a human. Store resolution as a candidate case. Only a reviewer can promote an exact bounded pattern to an existing typed runbook. Similarity helps retrieval and cannot create new authority.
4. Dinner/POI/charging request: collect nearby places with Google; select an existing Favorite in matching context, otherwise ask the driver. A selection may create scoped consent for the same user/vehicle/intent/location context and a limited time. A repeated matching request can start map driving simulation; changed place/context, stale location or ambiguity requires selection again. Visible cancel and no actual vehicle control.
5. Driving simulation: server-bound origin/destination and bounded route, progress on the map, explicit simulated movement and arrival; duplicate requests do not start duplicate journeys. Routes are labelled by source, not presented as real autonomous driving.
6. Operations: existing Cloud Run crew investigations stay on registered resources. Before any real remediation expansion, fix the two recorded concurrency/state-binding regressions, use durable execution claims and conditional service updates. High-risk/unknown changes continue to require a current human decision.

## Delivery checks

- Android MVVM, separate feature UI/state/ViewModel/data files, English/Korean resources, first-launch guide, readable format and responsibility/security comments.
- No signed-out sample console or production rehearsal launcher. Synthetic ports remain test-only.
- Web/phone desktop and small-screen layout, loading/empty/error/cancel states, natural language journey and charging failure workflows, accessibility and keyboard tests.
- Scoped auth/ownership/role tests, replay/concurrency/model hallucination/state drift/policy expiry/consent mismatch/unknown tests.
- Local and deployed evidence separate; Maps/API enabling is authorized, terms/billing changes or broader access require the applicable boundary. No unbounded keys or public vehicle mutation endpoint.

## Work already done in this increment

Remote pull fast-forwarded to 5ac003a with earlier mixed WIP preserved. Android MVVM/platform separation, localized resources, onboarding and ktfmt are implemented. The web/Android domains now include vehicle, map journey, assistance and existing operations. An original EV image is shared by both apps. The actor-private serverless twin, typed charging remedy, policy/decision reports, natural-language Gemini planning → official Google Maps MCP, Favorite/context consent and cancelled/arrived simulation states are implemented locally. See `docs/MAPS.md` and `docs/STATUS.md` for proved limits and verification.

15 October: current mobility domains, guided recovery/case promotion, personal-driver access and V2-compatible gateway/crew are deployed. Actual Firebase/Firestore, runtime Maps MCP/tokens/tiles, Favorite/selection/simulated arrival and a distinct learned-case remedy are verified. Preserve the first unknown recurrence and reproduced 429; later success is separate evidence. Policy disabled after test. Final browser login/visual review is pending after Chrome closed; native live tiles/physical phone, real V2 approval/conflict and judging assets remain separate. Current Seoul route probes returned empty; road-aware geometry remains unimplemented. Commit/push, publication and submission remain unapproved.
