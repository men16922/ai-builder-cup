# Aide Maps integration

Aide's server calls the official [Google Maps Grounding Lite MCP](https://developers.google.com/maps/ai/grounding-lite). No global coding-agent MCP configuration is changed. User approval for the limited Maps API/key setup was received on 15 October 2026; credentials and project-specific evidence stay in ignored private storage.

## Search and authority

Gemini converts a driver instruction into a strict `query` and `kind`. The server supplies the actor-scoped simulated vehicle coordinates, a 5 km bias, five-place ceiling, language and the fixed `search_places` tool. Only `https://mapstools.googleapis.com/mcp` is reachable. A query cannot select a host, tool, identity, credential or movement permission. The live tool schema was read with `tools/list`; its current arguments are camelCase, unlike the snake_case wording in some guide examples.

The adapter preserves the complete returned summary and its Google Maps place links. Source titles name the cards; no restaurant names, addresses or charging availability are inferred from prose. Unavailable port counts remain unknown. Coordinates and link hosts/paths are validated, and the service checks destinations remain within its local bound. HTTP/body bounds and deadline failures never trigger automatic replay.

The actor's permanent request receipts contain only digest/status, not provider content. Replays return the current view and do not call Gemini/Maps again. The server admits at most 30 Maps searches and 30 model operations per actor/hour across instances. First-time destinations require selection. A favorite or remembered same-context choice may start only the simulated journey; it cannot create physical vehicle authority.

## Authentication and credentials

- Enable Grounding Lite, Maps JavaScript, Maps SDK for Android and applicable Places/Routes APIs only in the configured app project.
- Server MCP calls use the dedicated runtime identity and the fixed `https://www.googleapis.com/auth/maps-platform.mapstools` OAuth scope, with a separate token cache. Do not use the browser/Android key on the server or expose OAuth tokens to a model.
- The runtime needs `serviceusage.services.use`; only its dedicated service-account binding was extended. No project-wide model-selected IAM tool exists.
- `AIDE_MAPS_BROWSER_KEY`: API restricted to Maps JavaScript, referrers restricted to the deployed origin and explicitly allowed local development origins. Returned only as authenticated SDK metadata; absent from stored twins, reports, receipts and model inputs.
- `AIDE_ANDROID_MAPS_KEY`: build-time Manifest placeholder, Maps SDK for Android only, restricted to the app package and approved signing SHA-1 fingerprints. Never commit the key or generated credential configuration.

Direct provider smoke and the deployed authenticated browser now confirm Gemini planning, five-place MCP results/source links, runtime scoped tokens, genuine browser tiles, Favorite/selection and simulated arrival. Native live tiles and physical-phone journeys remain unverified.

## Display and retention

The [Grounding Lite attribution requirements](https://developers.google.com/maps/ai/grounding-lite#attribution_requirements) require adjacent, accessible source links. Both UIs display the complete summary followed by every returned source link. The [service terms](https://cloud.google.com/maps-platform/terms/maps-service-terms) allow limited grounded-output caching for evaluation/display; no Maps content is used to train or improve a model or to populate remediation learning cases.

The first Maps search sets an immutable 29-day deadline on its actor twin. Subsequent favorite/vehicle writes do not renew old content. CloudStore refuses expired reads immediately; a top-level Firestore `expiresAt` Timestamp supports automatic TTL deletion. TTL was enabled for the configured record collection; physical deletion is asynchronous, so the deadline includes a day of margin. Permanent execution/request claims do not carry that TTL or cached content. When the twin expires, the UI requires initialization again.

The shipped server currently selects the MCP provider, not the earlier Places REST adapter. Favorites persist only Place IDs and categories; no extracted provider names or summaries. Place IDs can be retained by the applicable API exception; raw Places API fields require their own caching/attribution boundary before adding a durable details cache. Aide provides public `#/privacy` and `#/terms` views with Google terms/privacy links.

Maps tiles are genuine Google basemaps. The current vehicle trajectory is explicitly labelled **straight-line simulation**, not road navigation. Grounding Lite does not return turn-by-turn navigation. Unknown-case promotion is implemented and verified separately; Maps content is never used in those charging cases. The official MCP `compute_routes` response offers metrics/attribution but no polyline. This session’s Seoul MCP and Routes REST probes returned no routes, so actual road-route geometry remains unimplemented.

## Road-route coverage diagnosis — 15 October

The [official country coverage table](https://developers.google.com/maps/coverage) currently marks South Korea's driving directions/Snap to Roads and walking directions with a dash (unavailable or low availability), while map tiles and geocoding are available. The [Grounding Lite guide](https://developers.google.com/maps/ai/grounding-lite) separately states that route tools return distance/duration and do not provide navigation or step-by-step directions.

A four-call read-only control used public coordinates, the same existing runtime identity and unchanged API configuration. Both Seoul REST and MCP requests returned HTTP 200 with no route. The Google documentation's California pair returned one REST route with an encoded polyline and an MCP route result. No real user location, app journey, vehicle record, credential or IAM setting was changed. Original unsuccessful route evidence was preserved.

This supports a geographic coverage constraint for the tested Seoul pairs rather than an authorization failure; it does not prove every Korean pair is unavailable or implement a route adapter. Adding another enabled Google API alone does not establish Korean road coverage. Next work is an explicitly configured Korea-capable provider, with its own credentials, terms, attribution and bounded egress, or an explicitly chosen supported simulation region. Do not move a user's simulated origin automatically, substitute transit for vehicle driving, invent a road polyline or present a straight line as navigation. Current movement remains straight-line simulation.

Reading/refreshing an accepted moving journey does not arm client continuation. Only confirmed explicit trip/selection/Continue intent may start the visible simulation timer. Unknown steps disarm it; current state must be read and a person must explicitly continue or cancel. Repository-local flags grant no server authority; every step still checks the authenticated actor, version, journey and expiry.
