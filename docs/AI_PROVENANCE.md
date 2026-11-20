# AI-Assisted Work Record

## Scope of assistance

An AI coding assistant was used to help translate the existing product concept
into an English-only NYC MVP, draft the deterministic planner code, structure
the catalog schema, and write first-pass documentation.

## Human review still required

- Confirm every source URL, coordinate, access note, and planning allowance.
- Decide which requirements and stakeholder needs are accepted in the course
  model before claiming a baseline.
- Run the listed verification commands and conduct the live demonstration.
- Do not present this seed catalog as proof of live travel conditions or user outcomes.

## Constraint used during implementation

The product must plan only from the published catalog. It must show USD planning
allowances and source links, and it must not claim live ticketing, availability,
directions, accessibility, or opening-hour confirmation.

## Lab 12 assistance

An assistant inspected the existing guardrails, drafted `docs/risks.md`, wrote
offline adversarial tests and added earlier publication/source-evidence rejection.
The requester confirmed the five risks' ratings, owners and P1 priority on
November 19, 2026. Additional risks remain unscored pending team review.
See `LAB12_VERIFICATION.md` for local test results and excluded deployment checks.
The current code also allows explicitly offered, sourced Geoapify live listings;
tests preserve their unreviewed label rather than treating them as curated records.
