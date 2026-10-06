# Wayly NYC MVP

Wayly is a mobile-first trip-planning preview for short New York City visits. It preserves the original Wayly interaction design while using an English-only interface, a USD planning budget, and a source-linked NYC catalog.

## Current scope

- Build a short NYC itinerary from a published catalog of 100 places.
- Collect date, available hours, party size, total USD budget, interests, free-text intent, transportation preference, walking pace, dining preference, and an accessibility request.
- Show place details, a reference image with a credit link, a primary place source, static route estimates, and explicit planning limitations.
- Allow a local preview of itinerary adjustment, feedback, profile, and map handoff flows.

## Boundary

Wayly does not provide live hours, ticket inventory, reservation status, real-time routing, ride hailing, payment, or accessibility certification. Each stop links to a published source; travelers must confirm live conditions before departure.

## Run locally

```bash
npm ci
npm run dev
```

Open the local URL printed by the dev server.

## Verify

```bash
npm run lint
npm run build
```

The build validates that the application routes compile. It does not establish live availability or ticketing information.

## Data

[`data/nyc-poi-v1.json`](./data/nyc-poi-v1.json) is the single catalog used by the current planner. All 100 records have an official or venue source URL, a reviewed-on date, a USD planning allowance, coordinates, access notes, and a detail-image field.

See [`docs/README.md`](./docs/README.md) for the NYC MVP documentation index.
