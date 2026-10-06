import { groupSpendForPlace } from "@/lib/nyc-budget";
import { distanceKm } from "@/lib/nyc-geo";
import { publishedPlaces } from "@/lib/nyc-places";
import { DISTANCE_WEIGHT } from "@/lib/nyc-route-quality";
import type { Itinerary, NycPlace, PlanRequest } from "@/lib/nyc-types";

/**
 * Replacement suggestions for the "Replace a stop" screen (idea from the
 * nyc-data branch): published places not already in the plan that the party
 * can afford, ranked by your interests, similarity to the stop being replaced
 * and closeness to it. Client-safe — reads only the published catalog.
 * The planner still re-validates whichever one is picked.
 */
export function suggestReplacements(itinerary: Itinerary, targetStopId: string | null, request: PlanRequest, limit = 3): NycPlace[] {
  const inPlan = new Set(itinerary.stops.map((stop) => stop.placeId));
  const target = itinerary.stops.find((stop) => stop.id === targetStopId)?.place;
  return publishedPlaces
    .filter((place) => !inPlan.has(place.id))
    .filter((place) => {
      const spend = groupSpendForPlace(place, request.partySize).groupSpendUsd;
      return spend !== null && spend <= request.totalBudgetUsd;
    })
    .map((place) => {
      const interestMatches = place.interests.filter((interest) => (request.interests as string[]).includes(interest)).length;
      const sharedWithTarget = target ? place.interests.filter((interest) => target.interests.includes(interest)).length : 0;
      const km = target ? distanceKm(target, place) : 0;
      return { place, value: 2 * interestMatches + 1.5 * sharedWithTarget - DISTANCE_WEIGHT[request.walkingPreference] * km };
    })
    .filter(({ value }) => value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
    .map(({ place }) => place);
}
