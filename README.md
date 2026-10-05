# Wayly NYC MVP1

Wayly NYC is an English-language itinerary-planning MVP for short NYC visits. It
creates a transparent route from a published 20-place catalog, a party size, a
time window, selected interests, and a total USD planning budget.

## What is implemented

- A mobile-friendly planner at `/`.
- A deterministic `POST /api/plan` route that accepts only `city: "nyc"`.
- A published NYC catalog with 20 places, coordinates, source URLs, review dates,
  access notes, and USD planning allowances.
- A catalog inspection page at `/ops`.
- A requirement-to-code trace for Milestone 1 in
  [`docs/MILESTONE_1_TRACEABILITY.md`](docs/MILESTONE_1_TRACEABILITY.md).

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by the development server. Before handoff, run:

```bash
npm run verify:catalog
npm run lint
npm run build
```

## Boundaries

The catalog is a planning aid, not a booking or live-travel service. A source
link and a review date mean that a source was recorded for the MVP; they do not
guarantee current opening hours, tickets, admissions, accessibility services,
directions, transit conditions, or availability. Every price in the MVP is a
USD planning allowance and must be reconfirmed at the place's source before
travel.

## Documentation

- [`docs/SPEC.md`](docs/SPEC.md) — scope, requirements, and acceptance criteria.
- [`docs/DATA_PROVENANCE.md`](docs/DATA_PROVENANCE.md) — catalog source records and limitations.
- [`docs/MILESTONE_1_TRACEABILITY.md`](docs/MILESTONE_1_TRACEABILITY.md) — live demonstration trace.
- [`docs/AI_PROVENANCE.md`](docs/AI_PROVENANCE.md) — AI-assisted work record and review boundary.
