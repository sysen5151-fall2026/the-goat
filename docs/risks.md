# Wayly product risk register

P1 is the priority for Lab 12 because an itinerary must contain trustworthy
stops. P1 and P2 have equal ratings; priority is a requester decision, not a
numerical separation. Ratings and owners were confirmed on November 19, 2026
for the period through the final demonstration. Review weekly and before release.

## Scales and rules

Likelihood levels 1–5 represent approximately 10%, 30%, 50%, 70% and 90%.
These are engineering estimates, not measured incident frequencies.

- Cost impact 1–5: no extra effort; minor rework; substantial but manageable
  rework; extra resources or scope reduction; unaffordable. This is a qualitative
  effort scale. Dollar and work-hour boundaries have not been established.
- Schedule impact 1–5: no delay; up to one day; two to three days; four to seven
  days; over seven days or a missed final deadline.
- Technical impact 1–5: negligible; local issue with workaround; partial impairment
  with the core flow working; severe core-function impairment; core objective lost.
- Overall impact is the maximum of cost, schedule and technical impact.
  Do not multiply ordinal ratings. All five confirmed risks are Moderate under
  the course matrix. No monetary EMV or contingency budget is inferred.

Matrix colors, by likelihood row from 1 to 5 and impact column from 1 to 5:

```text
L1: Low Low      Low      Low      Moderate
L2: Low Low      Low      Moderate Moderate
L3: Low Moderate Moderate Moderate High
L4: Low Moderate Moderate High     High
L5: Low Moderate High     High     High
```

[Innoslate matrix](https://cloud.innoslate.com/cornell/p/718/diagrams/risk/319111)
groups the five risks. The unscored parent is a grouping node, not a sixth risk.
Innoslate's consequence percentages 10/30/50/70/90 encode impact levels 1–5
for plotting only; they are not loss percentages.

## P1 Incorrect AI itinerary

If schema-valid AI output contains invented or ineligible stops, users may receive
an unusable itinerary. Technical risk during operation.

- Owner: Yuzheng Liu. Strategy: mitigate. Priority: first.
- Likelihood 3; cost 2; schedule 3; technical 4; overall 4; level Moderate.
- Controls: validate tool IDs and final selection against the request shortlist;
  reject duplicates and records without publication/source evidence. Build displayed
  place facts from trusted records. On model failure, use the controlled planner.
- Monitor after model/prompt changes and daily during testing. Any accepted invalid
  stop triggers a release hold, a guard fix and a regression test before the next demo.
- Status: existing guards plus earlier evidence rejection are covered by offline
  failure-path tests. Deployed verification and reviewer acceptance remain open.
- [R.L12.1](https://cloud.innoslate.com/cornell/p/718/database/entity/319107).

## P2 LLM service unavailable or slow

If the LLM API fails or times out, itinerary generation may stop. Technical risk
during integration and operation.

- Owner: Jingbo He. Strategy: mitigate.
- Likelihood 3; cost 2; schedule 3; technical 4; overall 4; level Moderate.
- Controls: existing model timeout, bounded retries/repairs and controlled fallback.
  Verify timeout, rate-limit and service-error handling before the next demo.
- Review errors daily and after API changes. An unhandled failure or a request
  stuck beyond the configured timeout triggers a release hold and handler repair.
- Status: mocked service failure reaches the real API handler's fallback in the
  offline suite. Actual provider latency, retry timing and browser state are unverified.
- [R.L12.2](https://cloud.innoslate.com/cornell/p/718/database/entity/319108).

## P3 Prompt injection from source content

If malicious instructions in source text reach the prompt, the AI may violate
planning rules. Security and technical risk during integration and operation.

- Owner: Qinyue Xie. Strategy: mitigate.
- Likelihood 2; cost 3; schedule 3; technical 4; overall 4; level Moderate.
- Plan before the next demo: allowlist source fields, isolate data from instructions,
  exclude secrets, validate outputs and run source-text injection cases.
- Review weekly and after prompt/source changes. Any bypass triggers a release hold,
  isolation of the source field and a regression test.
- Status: output containment is tested; prompt-injection resistance is not established.
- [R.L12.3](https://cloud.innoslate.com/cornell/p/718/database/entity/319109).

## P4 Curated catalog source drift

If POI facts become outdated, users may plan unavailable stops or unexpected prices.
Data-quality risk during maintenance and operation.

- Owner: Siyuan Chen. Strategy: mitigate.
- Likelihood 3; cost 2; schedule 2; technical 3; overall 3; level Moderate.
- Plan: check source links and review dates before each release, review demo stops
  within seven days, and correct or unpublish conflicting records.
- Review weekly and every release. Broken sources, factual conflicts or stale demo
  reviews trigger verification before release.
- Status: catalog structural checks pass; factual currency still needs human review.
- [R.L12.4](https://cloud.innoslate.com/cornell/p/718/database/entity/264685),
  reusing the existing catalog risk.

## P5 Model and product drift

If code, Innoslate and tests diverge, integration defects may delay delivery.
Schedule and technical risk during development and integration.

- Owner: Yunkuan Liu. Strategy: mitigate.
- Likelihood 3; cost 3; schedule 3; technical 3; overall 3; level Moderate.
- Plan: update the model and interface contract on interface-changing PRs, run
  integration tests before merge, and preserve commit/test evidence.
- Review each relevant PR and weekly. A missing model update or failed test blocks
  merge/release until resolved.
- Status: trace links are recorded here; recurring team review remains operational work.
- [R.L12.5](https://cloud.innoslate.com/cornell/p/718/database/entity/319110).

## Additional AI risks awaiting team assessment

The following cover the remaining course categories. Their likelihood, impacts and
named owners are unassigned until reviewed; they are not added to the confirmed matrix.

- **Schema drift:** a model/provider change may alter structured output or tool calls.
  Mitigate with contract tests, pinned interface versions and controlled fallback.
  Review on every upgrade; unexpected parsing or tool errors block rollout.
- **Dependency abandonment:** an unsupported SDK or runtime may prevent fixes or
  deployment. Mitigate with dependency ownership, upgrade review and an exit path.
  Review monthly and before releases; loss of support or an unpatchable defect
  triggers a replacement plan. Replacement feasibility is not yet demonstrated.
- **Unintended data egress:** prompts, logs, authentication or provider integrations
  may transmit more data than intended. Minimize fields, keep credentials server-side,
  redact logs and review outbound payloads. Check each integration change; any secret
  or unnecessary personal data in an outbound fixture blocks release pending review.

## Product scope and evidence

The curated catalog decision in Lab 11 covers stored reviewed POIs. The current
product also offers request-scoped Geoapify live candidates. They remain unreviewed,
must have source evidence, must be in that request's shortlist, and are visibly
labeled. Tests preserve this exception; they do not silently redefine every stop
as a reviewed catalog entry. The wider team should reconcile this distinction
with the architecture and product requirements.

Run `npm run test:risk`. The suite uses the real guard, model executor, planner and
API handler with mocked SDK responses. Auth, quota persistence, live retrieval,
external routing and the framework response adapter are isolated. Network calls
are forbidden in the suite. No production credentials or paid model calls are needed.
See [Lab 12 verification](LAB12_VERIFICATION.md) for commands and results.

Work tracking: [Issue 2](https://github.com/sysen5151-fall2026/the-goat/issues/2).
