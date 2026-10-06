import { NYC_POI_DATA_VERSION, placeById, publishedPlaces } from "@/lib/nyc-places";
import type { Itinerary, NycPlace, PlanRequest, TransportSegment } from "@/lib/nyc-types";

const EARTH_RADIUS_KM = 6371;

function distanceKm(a: NycPlace, b: NycPlace) {
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const start = (a.latitude * Math.PI) / 180;
  const end = (b.latitude * Math.PI) / 180;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(start) * Math.cos(end) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function durationHours(request: PlanRequest) {
  return request.durationHours ?? (request.duration === "full_day" ? 10 : 6);
}

function transportForLeg(from: NycPlace, to: NycPlace, request: PlanRequest, index: number): TransportSegment {
  const km = distanceKm(from, to);
  const mode = request.transportPreference === "walk" || (request.transportPreference === "smart" && km <= 1.5)
    ? "walk"
    : request.transportPreference === "taxi" ? "taxi" : "public_transit";
  if (mode === "walk") return { fromStopId: `stop_${index}`, toStopId: `stop_${index + 1}`, recommendedMode: mode, estimatedMinutes: { min: Math.max(7, Math.ceil(km * 12)), max: Math.max(12, Math.ceil(km * 16)) }, estimatedCostUsd: { min: 0, max: 0 }, uncertaintyNotice: "Walking estimates use straight-line distance, not turn-by-turn directions." };
  if (mode === "taxi") return { fromStopId: `stop_${index}`, toStopId: `stop_${index + 1}`, recommendedMode: mode, estimatedMinutes: { min: Math.ceil(10 + km * 2), max: Math.ceil(18 + km * 4) }, estimatedCostUsd: { min: Math.ceil(8 + km * 2), max: Math.ceil(14 + km * 4) }, uncertaintyNotice: "Taxi time and cost are planning estimates; confirm them with your chosen service." };
  return { fromStopId: `stop_${index}`, toStopId: `stop_${index + 1}`, recommendedMode: mode, estimatedMinutes: { min: Math.ceil(15 + km * 2), max: Math.ceil(28 + km * 4) }, estimatedCostUsd: { min: 2.9 * request.partySize, max: 5.8 * request.partySize }, uncertaintyNotice: "Transit time and fare are planning estimates; check the current route and fare before travel." };
}

function orderByNearest(candidates: NycPlace[]) {
  if (candidates.length < 3) return candidates;
  const ordered = [candidates[0]];
  const remaining = candidates.slice(1);
  while (remaining.length) {
    const last = ordered[ordered.length - 1];
    const nearestIndex = remaining.reduce((best, candidate, index) => distanceKm(last, candidate) < distanceKm(last, remaining[best]) ? index : best, 0);
    ordered.push(remaining.splice(nearestIndex, 1)[0]);
  }
  return ordered;
}

export function planNycItinerary(request: PlanRequest): { itinerary: Itinerary | null; insufficiencyReason?: string } {
  const maximumStops = durationHours(request) >= 8 ? 4 : 3;
  const candidates = publishedPlaces.filter((place) => place.interests.some((interest) => request.interests.includes(interest)));
  const affordable = candidates.filter((place) => place.planningAllowanceUsd * request.partySize <= request.totalBudgetUsd);
  const pool = affordable.length >= 2 ? affordable : candidates.filter((place) => place.planningAllowanceUsd === 0);
  if (pool.length < 2) return { itinerary: null, insufficiencyReason: "There are not enough published NYC places that fit these constraints. Try a higher budget or different interests." };
  const selected = orderByNearest(pool.slice(0, maximumStops));
  const placeSpend = selected.reduce((total, place) => total + place.planningAllowanceUsd * request.partySize, 0);
  const segments = selected.slice(1).map((place, index) => transportForLeg(selected[index], place, request, index + 1));
  const transportMin = segments.reduce((total, segment) => total + (segment.estimatedCostUsd?.min ?? 0), 0);
  const transportMax = segments.reduce((total, segment) => total + (segment.estimatedCostUsd?.max ?? 0), 0);
  if (placeSpend + transportMin > request.totalBudgetUsd) return { itinerary: null, insufficiencyReason: "The current combination exceeds the trip budget. Increase the budget or choose different interests." };
  const intervalMinutes = Math.max(75, Math.floor((durationHours(request) * 60) / selected.length));
  const startMinutes = 10 * 60;
  const itinerary: Itinerary = {
    id: `nyc_${crypto.randomUUID()}`,
    status: "valid",
    title: "Your NYC itinerary",
    overview: "A planning-only route selected from the published NYC catalog.",
    stops: selected.map((place, index) => ({ id: `stop_${index + 1}`, placeId: place.id, name: place.name, time: `${String(Math.floor((startMinutes + index * intervalMinutes) / 60)).padStart(2, "0")}:${String((startMinutes + index * intervalMinutes) % 60).padStart(2, "0")}`, durationMinutes: Math.min(place.suggestedMinutes, intervalMinutes), expectedSpendUsd: place.planningAllowanceUsd * request.partySize, reason: `Matches your ${place.interests.filter((interest) => request.interests.includes(interest)).slice(0, 2).join(" and ")} interests.`, sourceName: place.sourceName, sourceUrl: place.sourceUrl })),
    transportSegments: segments,
    estimatedWalkKm: Number(segments.reduce((total, segment, index) => total + (segment.recommendedMode === "walk" ? distanceKm(selected[index], selected[index + 1]) : 0), 0).toFixed(1)),
    estimatedTotalSpendUsd: { min: Math.ceil(placeSpend + transportMin), max: Math.ceil(placeSpend + transportMax), status: "estimated" },
    confidenceNote: "All stops link to a published source. Opening hours, ticket availability, and live transit conditions must be checked before travel.",
    warnings: ["Planning allowances are not live prices.", "This route does not book tickets, navigation, or transport."],
    version: "nyc-controlled-planner-v1",
    dataVersionId: NYC_POI_DATA_VERSION,
  };
  return { itinerary };
}

export function resolveNycPlace(placeId: string) {
  return placeById[placeId];
}
