# Wayly New York Specification

Status: Chapter 3 acceptance baseline. This document maps the current
Innoslate stakeholder needs and requirements to objectively checkable product
behavior. It does not claim that the behavior has been implemented or tested.

## Needs and Acceptance Criteria

### SN.1 Submit Trip Preferences

Need: A traveler needs to submit the information required to plan a short New
York trip.

Traces to: 5.1.1.1 Accept Trip Request; 5.1.1.4 Reject Invalid Inputs;
5.1.2.1 Request Constraint Details; 5.1.4.1 Validate Trip Constraints.

Acceptance criterion: Given a planning request containing travel date,
available time, budget, group size, interests, transportation preferences, and
dining preferences, the application accepts the request for candidate
generation. A request missing a required field or violating an approved input
rule is rejected before generation with a field-specific message.

Open baseline: The team must approve the valid ranges, units, and hostile-input
fixtures before this criterion can be implemented as a non-placeholder test.

### SN.2 Generate a Feasible Itinerary

Need: A traveler needs an itinerary that fits the approved trip constraints.

Traces to: 5.1.2.2 Present Trusted Itinerary; 5.1.4.2 Select Eligible
Candidates; 5.1.4.4 Validate Itinerary Feasibility.

Acceptance criterion: Given a valid planning request and an eligible candidate
set, the application returns either an itinerary satisfying the approved time,
budget, and preference rules or a controlled insufficiency response. The
response completes within 30 seconds under the approved demonstration
workload. The 15-second design goal is recorded separately and is not treated
as a passing condition.

Open baseline: The team must approve the hard-versus-soft rules, maximum stop
count, feasibility fixtures, and timing workload.

### SN.3 Use Trusted Place Information

Need: A traveler needs recommendations supported by trusted place information.

Traces to: 5.1.1.2 Accept Approved POI Data; 5.1.2.2 Present Trusted
Itinerary; 5.1.4.2 Select Eligible Candidates; 5.1.4.3 Enforce Candidate
Whitelist.

Acceptance criterion: Every recommended POI is selected from the eligible set
and carries a source reference, verification date, and geographic coordinates.
An unapproved, incomplete, or stale POI is excluded from the trusted itinerary.

Open baseline: The approved-source list and staleness threshold require team
approval.

### SN.4 Provide a Practical Route

Need: A traveler needs a practical route and an honest route-status label.

Traces to: 5.1.1.3 Accept Provider Responses; 5.1.2.2 Present Trusted
Itinerary; 5.1.2.5 Candidate and Route Inputs; 5.1.4.4 Validate Itinerary
Feasibility; 5.2.2.2.1 Prevent False Route Validation.

Acceptance criterion: A route is labelled route-validated only when usable
required route information is present. If the route result is missing,
malformed, or unusable, the application must not show a route-validated label
and must return a controlled explanation or fallback.

### SN.5 Review and Revise the Plan

Need: A traveler needs to review and revise a proposed itinerary before
acceptance.

Traces to: 5.1.2.3 Offer Itinerary Revision; 5.1.4.4 Validate Itinerary
Feasibility.

Acceptance criterion: Before an itinerary is accepted, a traveler can submit a
revision request. Any accepted revised itinerary is checked again against the
same approved constraint rules before it is displayed as feasible.

### SN.6 Receive Clear Feedback

Need: A traveler needs an understandable outcome when planning cannot proceed
normally.

Traces to: 5.1.1.4 Reject Invalid Inputs; 5.1.2.1 Request Constraint Details;
5.1.2.4 Present Controlled Fallback.

Acceptance criterion: For missing input, invalid input, infeasible constraints,
or an unavailable provider, the application returns an understandable message
or controlled fallback and does not represent the result as a trusted or
route-validated itinerary.

## Data Contract

### Planning Request

| Field | Draft type and unit | Required behavior |
| --- | --- | --- |
| `travel_date` | ISO 8601 date | Required; reject an absent or invalid value. |
| `available_time` | Start/end time window | Required; exact format and range need approval. |
| `budget` | Non-negative decimal in USD | Required; exact allowable range needs approval. |
| `group_size` | Positive integer | Required; exact allowable range needs approval. |
| `interests` | Array of strings | Required; an empty-value policy needs approval. |
| `transportation_preferences` | Array of strings | Required; an empty-value policy needs approval. |
| `dining_preferences` | Array of strings | Required; an empty-value policy needs approval. |

### POI Record

The eligible POI set is the authoritative input to recommendation. Each POI
record must contain `poi_id`, `name`, `source_reference`, `verification_date`,
and latitude/longitude coordinates. A POI without those fields, outside the
approved source set, or outside the approved freshness rule cannot be presented
as trusted. The application uses the supplied eligible set for planning; it
does not silently replace it with an unreviewed source.

### Availability and Refresh

POI evidence is refreshed through the team-approved review process. When an
approved data or route provider is unavailable, the product returns the SN.6
controlled outcome rather than a stack trace, blank response, or unsupported
trusted label. No mandatory paid external service is allowed in the
demonstration baseline.

## Model Response Contract

This is a proposed response envelope for team approval before Chapter 8
implementation. The model receives only a validated planning request and the
eligible POI set. It must return one JSON object:

```json
{
  "status": "itinerary | insufficient_information | controlled_fallback",
  "itinerary": [
    {"poi_id": "string", "sequence": 1, "rationale": "string"}
  ],
  "message": "string",
  "source_references": ["string"],
  "route_validation": "validated | not_validated"
}
```

The application validates the schema, verifies every `poi_id` against the
eligible set, and validates the final itinerary against the approved rules. On
malformed output, an unknown POI, or a missing required field, it must discard
the model output and use a controlled fallback or insufficiency message. Raw
model output and provider errors are never displayed to the traveler.

## Chapter 3 Test Baseline

`tests/test_spec_acceptance.py` contains one currently failing test per need.
The test names carry the SN identifier. The red suite is intentional: this
repository is still a scaffold and has no product implementation. The tests
must become meaningful fixture-based tests only after the open baseline values
above are approved.

## Decisions Required Before Implementation

1. Exact valid input ranges, units, and hostile-input fixtures.
2. Hard and soft itinerary rules, maximum stop count, and route-feasibility
   fixtures.
3. Eligible POI source list and freshness threshold.
4. Demonstration workload used for the 30-second limit.
5. Role/access matrix and final JSON response schema.
