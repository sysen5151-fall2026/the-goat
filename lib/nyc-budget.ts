import type { ExpectedSpendSemantics, NycPlace, PlanRequest } from "@/lib/nyc-types";

// Ported from mvp2 lib/budget-feasibility.ts (CNY → USD).
export const BUDGET_FEASIBILITY_VERSION = "budget-feasibility-v1";

export type GroupSpend = {
  expectedSpendUsd: number;
  expectedSpendSemantics: ExpectedSpendSemantics;
  groupSpendUsd: number | null;
  status: "known" | "estimated" | "free" | "unknown";
};

/**
 * Converts a place's reference price to this request's group cost. Unknown is
 * intentionally never estimated into a hard-budget route. Category estimates
 * (live map listings) are allowed but carry status "estimated".
 */
export function groupSpendForPlace(place: Pick<NycPlace, "planningAllowanceUsd" | "expectedSpendSemantics">, partySize: number): GroupSpend {
  const semantics = place.expectedSpendSemantics ?? (place.planningAllowanceUsd === 0 ? "free" : "per_person_reference");
  const base = { expectedSpendUsd: place.planningAllowanceUsd, expectedSpendSemantics: semantics };
  switch (semantics) {
    case "free":
      return { ...base, groupSpendUsd: 0, status: "free" };
    case "group_fixed":
      return { ...base, groupSpendUsd: place.planningAllowanceUsd, status: "known" };
    case "per_person_reference":
      return { ...base, groupSpendUsd: place.planningAllowanceUsd * partySize, status: "known" };
    case "category_estimate":
      return { ...base, groupSpendUsd: place.planningAllowanceUsd * partySize, status: "estimated" };
    case "unknown":
      return { ...base, groupSpendUsd: null, status: "unknown" };
  }
}

export function selectedSpendAudit(selected: NycPlace[], request: Pick<PlanRequest, "partySize">) {
  const costs = selected.map((place) => ({ place, cost: groupSpendForPlace(place, request.partySize) }));
  const unknownPlaceIds = costs.filter(({ cost }) => cost.groupSpendUsd === null).map(({ place }) => place.id);
  return {
    selectedGroupSpendUsd: unknownPlaceIds.length ? null : costs.reduce((sum, { cost }) => sum + (cost.groupSpendUsd ?? 0), 0),
    unknownPlaceIds,
  };
}

export function isIndividuallyAffordable(place: NycPlace, request: Pick<PlanRequest, "partySize" | "totalBudgetUsd">) {
  const cost = groupSpendForPlace(place, request.partySize);
  return cost.groupSpendUsd !== null && cost.groupSpendUsd <= request.totalBudgetUsd;
}
