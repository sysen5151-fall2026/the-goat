# Wayly NYC MVP documentation

## Product boundary

The NYC MVP plans short visits from a fixed, source-linked catalog. The current implementation intentionally uses a deterministic planner so that selections, USD allowances, and planning assumptions can be inspected locally.

## Evidence available in the repository

- `data/nyc-poi-v1.json`: the 100-place published NYC catalog.
- `lib/nyc-plan-contract.ts`: input contract and validation boundary.
- `lib/nyc-planner.ts`: deterministic scoring (interests, free-text request, walking, dining, and accessibility preferences), compact route building within the available hours and budget, adjustment handling, replacement suggestions, and static transport estimates.
- `app/page.tsx`: the mobile-first user flow, place detail view, adjustment flow, feedback interface, and map handoff preview.

## Evidence boundary

This repository proves a local build and the behavior of the included catalog. It does not prove real-world place availability, live transit performance, ticket inventory, or user outcomes.
