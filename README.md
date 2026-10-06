# Wayly NYC MVP

Wayly is a mobile-first trip-planning preview for short New York City visits. It preserves the original Wayly interaction design while using an English-only interface, a USD planning budget, and a source-linked NYC catalog.

## Current scope

- Build a short NYC itinerary from a published catalog of 20 places.
- Collect date, available hours, party size, total USD budget, interests, free-text intent, transportation preference, walking pace, dining preference, and an accessibility request.
- Show place details, a reference image with a credit link, a primary place source, static route estimates, and explicit planning limitations.
- Allow a local preview of itinerary adjustment, feedback, profile, and map handoff flows.

## Boundary

Wayly does not provide live hours, ticket inventory, reservation status, real-time routing, ride hailing, payment, or accessibility certification. Each stop links to a published source; travelers must confirm live conditions before departure.

## Run locally

```bash
cp .env.example .env.local   # then add your Geoapify / MapTiler keys
npm install
npm run dev
```

## How a plan is made (ported from Wayly MVP v2)

Code finds the eligible set; DeepSeek picks the one best route; code re-checks everything.

1. **Hard eligibility** (`lib/nyc-candidate-filtering.ts`): published, complete source, affordable for the whole party, not on a verified fixed closing day.
2. **Explicit refusals**: requests to skip source review, a must-include place that isn't in the catalog, places too far apart for the time, activities outside NYC → a clear explanation instead of a route.
3. **Scoring**: interest match +50, a place the user named +200 (aliases such as "the Met", "MoMA"), theme words (skyline, art, history, bridges…) +60 each, budget wording favours cheaper places.
4. **Spatial coherence** around the top anchor (4.5–12 km by pace/duration), then a **shortlist of ≤ 8** that keeps one candidate per selected interest.
5. **Live listings** (`lib/nyc-realtime-poi.ts`): up to 3 Geoapify/OpenStreetMap places for the requested interests. Parks/viewpoints/`fee=no` are free; restaurants, cafés, museums, markets use a fixed per-person **category estimate** shown as "~$" and "Live listing — not reviewed".
6. **Rules** shared by both paths: stop count (`lib/nyc-stop-count-policy.ts`), start time (`lib/nyc-time-window.ts`), budget feasibility with up to 5 feasible examples (`lib/nyc-planner.ts`).
7. **DeepSeek** (`lib/nyc-model-planner.ts`): must call `calculate_route_metrics` exactly once with one ordered route from the shortlist, then return strict JSON with the same IDs plus one short reason per stop. IDs, count, budget, sources and walking limits are validated; one repair per stage; reasons that promise tickets/hours/prices are dropped. Any failure → the rule-based route with a warning.
8. **Adjustments** are deterministic (only affected stops change). **Route validation** uses Geoapify per leg (walk / drive / approximated transit).

Guards: 8 plans per client per 10 minutes and a daily cap on real model calls (`DAILY_MODEL_CALL_LIMIT`, default 50), both in memory.

## Maps and routing

- The itinerary map uses [MapLibre GL JS](https://maplibre.org/) with a Geoapify vector basemap (`positron`), recolored to the Wayly palette in `components/route-map.tsx`.
- Basemap provider is configurable in `lib/map-config.ts` via `NEXT_PUBLIC_MAP_PROVIDER` (`geoapify`, `maptiler`, or the keyless `openfreemap`). If the provider key is missing or rejected, the map falls back to OpenFreeMap.
- `/api/plan` validates each leg with the Geoapify Routing API on the server (walk / drive / approximated transit) to draw street-following lines and replace straight-line times. Results are cached in memory; any failure keeps the planner's estimates.
- Attribution ("Powered by Geoapify", © OpenStreetMap) is shown in the map's attribution control and must stay visible.
- MapLibre's web worker is copied to `public/maplibre/` by `scripts/copy-maplibre-worker.mjs` on install, dev, and build.

Open the local URL printed by the dev server.

## Verify

```bash
npm run lint
npm run build
```

The build validates that the application routes compile. It does not establish live availability or ticketing information.

## Data

[`data/nyc-poi-v1.json`](./data/nyc-poi-v1.json) is the single catalog used by the current planner. All 20 records have an official or venue source URL, a reviewed-on date, a USD planning allowance, coordinates, access notes, and a detail-image field.

See [`docs/README.md`](./docs/README.md) for the NYC MVP documentation index.
