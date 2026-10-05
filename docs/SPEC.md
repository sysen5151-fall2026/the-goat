# Wayly NYC MVP1 Specification

## System of Interest

Wayly NYC accepts a short-trip request and returns a constrained itinerary built
only from its published NYC place catalog.

The system of interest includes the web client, the plan API, the deterministic
selection logic, and the published catalog. Official place sites, ticket sellers,
mapping services, transit services, payments, and live opening-hour information
are external systems.

## Primary operational concept

1. A visitor enters a date, available hours, number of travelers, USD total
   budget, and one to four interests.
2. The client submits the request to `POST /api/plan`.
3. The API validates the request and sends it to deterministic planner logic.
4. The planner selects only `published` records from `nyc-poi-v1`, calculates
   the group planning allowance, and returns source links with the itinerary.
5. The client shows the itinerary, remaining budget, limitations, and source
   links. The visitor independently confirms current travel details.

## Requirements

| ID | Requirement | Acceptance criterion |
| --- | --- | --- |
| RQ-PLAN-01 | The client shall collect date, available hours, party size, USD total budget, and at least one interest. | A valid request from `/` reaches `POST /api/plan`; an invalid request receives HTTP 400 with an actionable English message. |
| RQ-PLAN-02 | The plan API shall accept only an NYC request. | `city` is constrained to `nyc` by `lib/plan-contract.ts`. |
| RQ-PLAN-03 | The planner shall select only published catalog records. | `lib/nyc-places.ts` filters `published` records before selection. |
| RQ-PLAN-04 | The returned route shall not exceed the submitted total USD planning budget. | The selection loop tests each group allowance before adding a stop; the response exposes the remaining budget. |
| RQ-PLAN-05 | Each returned stop shall expose its source link and planning limitation. | The API returns source data; the client renders source links and limitation notes. |
| RQ-PLAN-06 | The operations page shall display every active catalog record. | `/ops` lists 20 records and their tags, source names, USD allowance, and review date. |

## Non-goals

- Live directions, travel-time calculations, or route optimization.
- Ticket purchases, reservations, payment, or availability confirmation.
- Claims that a catalog source validates every current operating condition.
- Personalized safety, medical, or accessibility advice.
