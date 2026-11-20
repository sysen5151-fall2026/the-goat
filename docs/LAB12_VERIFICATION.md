# Lab 12 guardrail verification

The P1 guardrail prevents invalid model selections from becoming successful AI
itineraries. The API's existing controlled planner contains model failures.
The change also rejects unpublished or incomplete-source candidate records before
budget/route calculations, returning a validation refusal instead of throwing there.

## Reproduce

Use the Node engine supported by `package.json`. On a fresh checkout:

```sh
npm ci --legacy-peer-deps
npm run test:risk
npm run verify:catalog
npx tsc --noEmit --incremental false
```

The compatibility flag is needed for the repository's existing peer-dependency
lock layout. It does not disable the runtime guards. Tests have a separate Vite
configuration and never start Cloudflare/Sites plugins or external services.

## Coverage

- Valid curated selections pass; names, links and allowances come from catalog records.
- Schema-valid invented IDs, real IDs outside the shortlist, mixed valid/invalid IDs,
  duplicates and invalid ID formats fail the argument guard.
- Final selections cannot swap a validated route for an invented stop.
- Unpublished curated records and missing source/review evidence are refused.
- Price and real-time promises are stripped from model-generated reasons.
- A live candidate must be explicitly recognized and offered for that request;
  the full model path retains its unreviewed label.
- The actual API handler returns the controlled itinerary for mocked unknown,
  out-of-candidate, mixed, duplicate, final-swap and service-failure responses.
  A valid model control case still returns `ai_structured`.

## Recorded local results

On November 19, 2026, with Node v24.19.0 on Windows:

- `npm run test:risk`: 25 passed, 0 failed.
- `npm run verify:catalog`: 340 published catalog records passed.
- `npx tsc --noEmit --incremental false`: passed.
- `npx oxlint lib/nyc-planner.ts tests/risk vitest.risk.config.ts --quiet`: passed.
- `git diff --check`: passed.
- `npm ci --dry-run --legacy-peer-deps --ignore-scripts`: lockfile resolution passed.

The first failure-path run exposed three thrown-error cases for tainted records.
The earlier publication/evidence check in `inspectModelSelection` makes those
cases return an explicit refusal; the final suite also covers the live-listing
exception. This evidence applies to the change containing this document.

Full-repository `npm run lint -- --quiet` still reports two pre-existing frontend
errors outside this change: unused `WalletCards` in `components/onboarding-gate.tsx`
and `prefer-tag-over-role` in `app/page.tsx`. They are not claimed fixed here.

## Evidence limits

The SDK is mocked, while the model executor, planner validation and API fallback
are real. Authentication, quota storage, Geoapify retrieval, route enrichment and
the framework response adapter are test doubles. Network attempts fail immediately.
These tests establish local containment, not provider uptime, browser behavior,
deployed authentication, source freshness or general prompt-injection resistance.

Ratings remain requester-confirmed estimates. A passing local test does not close
every risk or constitute unanimous team approval. Innoslate and deployed acceptance
should be reviewed when the change is accepted.
