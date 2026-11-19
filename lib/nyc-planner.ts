import {
  filterAndRankCandidates,
  hasCompleteEvidence,
  isPublishedPlaceAvailableForRequest,
  type CandidateFilteringResult,
} from "@/lib/nyc-candidate-filtering";
import { BUDGET_FEASIBILITY_VERSION, groupSpendForPlace, selectedSpendAudit } from "@/lib/nyc-budget";
import { distanceKm, resolvePlanDurationHours } from "@/lib/nyc-geo";
import { NYC_POI_DATA_VERSION, placeById, publishedPlaces } from "@/lib/nyc-places";
import { augmentCandidatesWithRealtimeGeoapify, type RealtimeFallbackDeps } from "@/lib/nyc-realtime-poi";
import { deriveStopCountPolicy, type StopCountPolicy } from "@/lib/nyc-stop-count-policy";
import { chooseBestRoute, needsFerry, orderRoute, planVisitSchedule, WALK_LIMIT_KM } from "@/lib/nyc-route-quality";
import { resolveTimeWindowPolicy } from "@/lib/nyc-time-window";
import type { IntentParse, Itinerary, ItineraryStop, NycPlace, PlanRequest, PlannerResult, TransportSegment } from "@/lib/nyc-types";

/**
 * NYC planner, ported from mvp2 lib/planner.ts. Shared by the controlled
 * (rule-based) path and the DeepSeek path: candidate resolution, route metrics,
 * budget guard, validation and itinerary construction all live here, so the
 * model can only choose — never bypass — these rules.
 */

export type BudgetFeasibilityContext = {
  version: typeof BUDGET_FEASIBILITY_VERSION;
  totalBudgetUsd: number;
  candidateCosts: Array<{ placeId: string; groupSpendUsd: number | null; remainingBudgetUsd: number | null; individuallyAffordable: boolean; expectedSpendSemantics: NycPlace["expectedSpendSemantics"] }>;
  feasibleCombinationExamples: Array<{ placeIds: string[]; selectedGroupSpendUsd: number; staticRouteCostUsd: number; estimatedTotalSpendUsd: number; remainingBudgetUsd: number }>;
  hasFeasibleCombination: boolean;
};

export type CandidateResult = CandidateFilteringResult & { stopCountPolicy: StopCountPolicy; budgetFeasibility: BudgetFeasibilityContext };

export type BudgetGuardAudit = {
  totalBudgetUsd: number;
  selectedGroupSpendUsd: number | null;
  staticRouteCostUsd: number | null;
  estimatedTotalSpendUsd: number | null;
  remainingBudgetUsd: number | null;
  overBudgetByUsd: number | null;
  unknownPlaceIds: string[];
  valid: boolean;
};

type ValidationResult = { valid: true } | { valid: false; reason: string };

// In-memory stores (per server instance). The client also sends previousPlaceIds
// with adjustments, so an adjustment still works if this instance lost the itinerary.
const itineraryMemory = new Map<string, Itinerary>();
const realtimePlaceMemory = new Map<string, NycPlace>();
const MAX_MEMORY = 300;

function remember<K, V>(map: Map<K, V>, key: K, value: V) {
  if (map.size >= MAX_MEMORY) map.delete(map.keys().next().value as K);
  map.set(key, value);
}

export function resolvePlace(placeId: string): NycPlace | undefined {
  return placeById[placeId] ?? realtimePlaceMemory.get(placeId);
}

/* ---------- Candidate resolution ---------- */

export function rankedPlaces(request: PlanRequest, scoredPlaceIds?: ReadonlySet<string>): CandidateResult {
  const filtering = filterAndRankCandidates(request, publishedPlaces, scoredPlaceIds);
  const stopCountPolicy = deriveStopCountPolicy(request, filtering.candidates.length);
  const budgetFeasibility = buildBudgetFeasibilityContext(request, filtering.candidates, stopCountPolicy);
  const blocked = (reason: string, kind: CandidateResult["insufficiencyKind"], note: string): CandidateResult => ({
    ...filtering,
    candidates: [],
    trace: { ...filtering.trace, shortlistedCount: 0, selectedCandidateIds: [], rankingReasons: [], exclusionSummary: [...filtering.trace.exclusionSummary, note] },
    stopCountPolicy,
    budgetFeasibility,
    insufficiencyReason: reason,
    insufficiencyKind: kind,
  });
  if (request.cityCode !== "nyc") return blocked("This version only supports New York City.", "city_block", "City outside supported scope.");
  if (request.accessibility)
    return blocked("Published NYC places don't yet carry verified accessibility evidence, so Wayly can't promise an accessible route. Please check venues directly, or turn this off to see a standard plan.", "accessibility_block", "Accessibility is a hard constraint without evidence.");
  if (request.dining === "vegetarian")
    return blocked("Published NYC places don't yet carry verified vegetarian evidence, so Wayly can't safely recommend a vegetarian-friendly route.", "vegetarian_block", "Vegetarian is a hard constraint without evidence.");
  return {
    ...filtering,
    stopCountPolicy,
    budgetFeasibility,
    ...(!filtering.insufficiencyReason && filtering.candidates.length > 0 && !budgetFeasibility.hasFeasibleCombination
      ? { insufficiencyReason: "No combination of candidates fits the total budget once place allowances and transport estimates are added. Raise the budget or relax the route.", insufficiencyKind: "affordability" as const }
      : {}),
  };
}

/**
 * Realtime-aware entry point for the live API and the model path: adds up to
 * three Geoapify live listings unless the curated result is a deliberate refusal.
 */
export async function resolveCandidatesWithRealtimeFallback(request: PlanRequest, deps?: RealtimeFallbackDeps): Promise<CandidateResult> {
  const base = rankedPlaces(request);
  if (base.insufficiencyKind && base.insufficiencyKind !== "quantity") return base;
  // Live listings are optional: any unexpected data from Geoapify falls back to the curated shortlist instead of failing the plan.
  let augmented: Awaited<ReturnType<typeof augmentCandidatesWithRealtimeGeoapify>>;
  try {
    augmented = await augmentCandidatesWithRealtimeGeoapify(request, base, publishedPlaces, deps);
  } catch (error) {
    console.warn(JSON.stringify({ event: "plan.realtime_listing_error", message: error instanceof Error ? error.message : String(error) }));
    return base;
  }
  if (!augmented.trace.usedRealtimeFallback || augmented.insufficiencyReason || augmented.candidates === base.candidates) return { ...base, trace: augmented.trace };
  for (const place of augmented.candidates) if (place.dataOrigin === "realtime_geoapify") remember(realtimePlaceMemory, place.id, place);
  const stopCountPolicy = deriveStopCountPolicy(request, augmented.candidates.length);
  const budgetFeasibility = buildBudgetFeasibilityContext(request, augmented.candidates, stopCountPolicy);
  return {
    ...base,
    candidates: augmented.candidates,
    trace: augmented.trace,
    stopCountPolicy,
    budgetFeasibility,
    ...(budgetFeasibility.hasFeasibleCombination
      ? { insufficiencyReason: undefined, insufficiencyKind: undefined }
      : { insufficiencyReason: "No combination of candidates fits the total budget once place allowances and transport estimates are added. Raise the budget or relax the route.", insufficiencyKind: "affordability" as const }),
  };
}

/* ---------- Scheduling & route metrics ---------- */

/** Sequential schedule for an ordered route (visit → leg → visit …), trimming visits when the day is tight. */
export function scheduleForRoute(request: PlanRequest, route: NycPlace[], offsetMinutes = 0) {
  const segments = route.slice(1).map((place, index) => transportForLeg(route[index], place, request, `stop_${index + 1}`, `stop_${index + 2}`));
  return planVisitSchedule(request, route, segments, offsetMinutes);
}

function transportForLeg(from: NycPlace, to: NycPlace, request: PlanRequest, fromStopId: string, toStopId: string): TransportSegment {
  const km = distanceKm(from, to);
  if (needsFerry(from, to))
    return { fromStopId, toStopId, recommendedMode: "public_transit", estimatedMinutes: { min: Math.ceil(25 + km * 2), max: Math.ceil(45 + km * 4) }, estimatedCostUsd: { min: 0, max: Number((5.8 * request.partySize).toFixed(2)) }, uncertaintyNotice: "This leg crosses the harbor by ferry; check the ferry schedule and whether your ticket already covers it." };
  // "Walk preferred" still switches to transit beyond ~4 km; "smart" walks only short links for the chosen pace.
  const useWalk = request.transportPreference === "walk" ? km <= 4 : request.transportPreference === "smart" && km <= WALK_LIMIT_KM[request.walkingPreference];
  if (useWalk)
    return { fromStopId, toStopId, recommendedMode: "walk", estimatedMinutes: { min: Math.max(7, Math.ceil(km * 12)), max: Math.max(12, Math.ceil(km * 16)) }, estimatedCostUsd: { min: 0, max: 0 }, uncertaintyNotice: "Walking estimate from straight-line distance, not turn-by-turn directions." };
  if (request.transportPreference === "taxi")
    return { fromStopId, toStopId, recommendedMode: "taxi", estimatedMinutes: { min: Math.ceil(10 + km * 2), max: Math.ceil(18 + km * 4) }, estimatedCostUsd: { min: Math.ceil(8 + km * 2), max: Math.ceil(14 + km * 4) }, uncertaintyNotice: "Taxi time and fare are planning estimates; confirm with your chosen service." };
  return { fromStopId, toStopId, recommendedMode: "public_transit", estimatedMinutes: { min: Math.ceil(15 + km * 2), max: Math.ceil(28 + km * 4) }, estimatedCostUsd: { min: Number((2.9 * request.partySize).toFixed(2)), max: Number((5.8 * request.partySize).toFixed(2)) }, uncertaintyNotice: "Transit time and fare are planning estimates; check the current route and fare before travel." };
}

/** The only route-metrics implementation, used by the controlled path and the model tool. */
export function calculateRouteMetrics(request: PlanRequest, placeIds: string[], extraPlacesById: Record<string, NycPlace> = {}) {
  const selected = placeIds.map((id) => extraPlacesById[id] ?? resolvePlace(id));
  if (!selected.length || selected.some((place) => !place || (!place.published && place.dataOrigin !== "realtime_geoapify") || !hasCompleteEvidence(place)))
    throw new Error("Route metrics only accept published places or sourced live listings.");
  const route = selected as NycPlace[];
  const transportSegments = route.slice(1).map((place, index) => transportForLeg(route[index], place, request, `stop_${index + 1}`, `stop_${index + 2}`));
  const estimatedWalkKm = transportSegments.reduce((total, segment, index) => (segment.recommendedMode === "walk" ? total + distanceKm(route[index], route[index + 1]) : total), 0);
  const estimatedTransportUsd = transportSegments.reduce((total, segment) => ({ min: total.min + (segment.estimatedCostUsd?.min ?? 0), max: total.max + (segment.estimatedCostUsd?.max ?? 0) }), { min: 0, max: 0 });
  return {
    placeIds,
    estimatedWalkKm: Number(estimatedWalkKm.toFixed(1)),
    estimatedTransportUsd: { min: Number(estimatedTransportUsd.min.toFixed(2)), max: Number(estimatedTransportUsd.max.toFixed(2)) },
    transportSegments,
    uncertaintyNotice: "Walking distance, time and fares between stops are static estimates; walking inside venues is not covered.",
  };
}

function byIdMap(places: NycPlace[]) {
  return Object.fromEntries(places.map((place) => [place.id, place]));
}

/** Hard-budget authority shared by both paths; it never trims or substitutes the selection. */
export function inspectSelectionBudget(request: PlanRequest, selected: NycPlace[]): BudgetGuardAudit {
  const spend = selectedSpendAudit(selected, request);
  if (spend.selectedGroupSpendUsd === null)
    return { totalBudgetUsd: request.totalBudgetUsd, selectedGroupSpendUsd: null, staticRouteCostUsd: null, estimatedTotalSpendUsd: null, remainingBudgetUsd: null, overBudgetByUsd: null, unknownPlaceIds: spend.unknownPlaceIds, valid: false };
  const metrics = calculateRouteMetrics(request, selected.map((place) => place.id), byIdMap(selected));
  const staticRouteCostUsd = metrics.estimatedTransportUsd.max;
  const estimatedTotalSpendUsd = Math.ceil(spend.selectedGroupSpendUsd + staticRouteCostUsd);
  const remainingBudgetUsd = request.totalBudgetUsd - estimatedTotalSpendUsd;
  return { totalBudgetUsd: request.totalBudgetUsd, selectedGroupSpendUsd: spend.selectedGroupSpendUsd, staticRouteCostUsd, estimatedTotalSpendUsd, remainingBudgetUsd, overBudgetByUsd: Math.max(0, -remainingBudgetUsd), unknownPlaceIds: [], valid: remainingBudgetUsd >= 0 };
}

function combinations<T>(items: T[], count: number): T[][] {
  const result: T[][] = [];
  const visit = (start: number, current: T[]) => {
    if (current.length === count) {
      result.push(current);
      return;
    }
    for (let index = start; index <= items.length - (count - current.length); index += 1) visit(index + 1, [...current, items[index]]);
  };
  visit(0, []);
  return result;
}

/** A small feasibility signal for the model (≤5 examples), not a prescribed route. */
export function buildBudgetFeasibilityContext(request: PlanRequest, candidates: NycPlace[], stopCountPolicy: StopCountPolicy): BudgetFeasibilityContext {
  const candidateCosts = candidates.map((place) => {
    const cost = groupSpendForPlace(place, request.partySize);
    return {
      placeId: place.id,
      groupSpendUsd: cost.groupSpendUsd,
      remainingBudgetUsd: cost.groupSpendUsd === null ? null : request.totalBudgetUsd - cost.groupSpendUsd,
      individuallyAffordable: cost.groupSpendUsd !== null && cost.groupSpendUsd <= request.totalBudgetUsd,
      expectedSpendSemantics: cost.expectedSpendSemantics,
    };
  });
  const feasibleCombinationExamples = Array.from({ length: Math.max(0, stopCountPolicy.maxStops - stopCountPolicy.minStops + 1) }, (_, index) => stopCountPolicy.minStops + index)
    .flatMap((count) => combinations(candidates, count))
    .map((selection) => orderRoute(selection, request))
    .map((selection) => ({ selection, audit: inspectSelectionBudget(request, selection) }))
    .filter(({ audit }) => audit.valid)
    .slice(0, 5)
    .map(({ selection, audit }) => ({
      placeIds: selection.map((place) => place.id),
      selectedGroupSpendUsd: audit.selectedGroupSpendUsd ?? 0,
      staticRouteCostUsd: audit.staticRouteCostUsd ?? 0,
      estimatedTotalSpendUsd: audit.estimatedTotalSpendUsd ?? 0,
      remainingBudgetUsd: audit.remainingBudgetUsd ?? 0,
    }));
  return { version: BUDGET_FEASIBILITY_VERSION, totalBudgetUsd: request.totalBudgetUsd, candidateCosts, feasibleCombinationExamples, hasFeasibleCombination: feasibleCombinationExamples.length > 0 };
}

function estimatedTotalMax(selected: NycPlace[], request: PlanRequest) {
  const audit = inspectSelectionBudget(request, orderRoute(selected, request));
  return audit.estimatedTotalSpendUsd ?? Number.POSITIVE_INFINITY;
}

/* ---------- Controlled selection & validation ---------- */

function selectStops(candidates: NycPlace[], request: PlanRequest, stopCountPolicy: StopCountPolicy, intentParse?: IntentParse, budgetFeasibility?: BudgetFeasibilityContext, rankingReasons: Array<{ placeId: string; score: number; signals?: string[] }> = []) {
  // Whole-route search over the shortlist (named places always included).
  const named = new Set(intentParse?.detectedSignals ?? []);
  const requiredIds = new Set(candidates.filter((place) => named.has(place.name)).slice(0, stopCountPolicy.maxStops).map((place) => place.id));
  const best = chooseBestRoute(candidates, request, stopCountPolicy, requiredIds, {
    segmentsFor: (route) => route.slice(1).map((place, index) => transportForLeg(route[index], place, request, `stop_${index + 1}`, `stop_${index + 2}`)),
    withinBudget: (route) => inspectSelectionBudget(request, route).valid,
    scoreById: new Map(rankingReasons.map((item) => [item.placeId, item.score])),
    signalsById: new Map(rankingReasons.map((item) => [item.placeId, item.signals ?? []])),
  });
  if (best) return best.route;
  return greedySelectStops(candidates, request, stopCountPolicy, intentParse, budgetFeasibility);
}

/** Previous greedy selection, kept as a last resort when no route passes the whole-route search. */
function greedySelectStops(candidates: NycPlace[], request: PlanRequest, stopCountPolicy: StopCountPolicy, intentParse?: IntentParse, budgetFeasibility?: BudgetFeasibilityContext) {
  // Named places go first; the target count grows to fit them, capped by maxStops.
  const named = new Set(intentParse?.detectedSignals ?? []);
  const ordered = named.size ? [...candidates.filter((place) => named.has(place.name)), ...candidates.filter((place) => !named.has(place.name))] : candidates;
  const namedCount = ordered.filter((place) => named.has(place.name)).length;
  const target = Math.min(stopCountPolicy.maxStops, Math.max(stopCountPolicy.minStops, namedCount));
  const selected: NycPlace[] = [];
  for (const candidate of ordered) {
    if (selected.length === target) break;
    if (selected.some((place) => place.id === candidate.id)) continue;
    if (estimatedTotalMax([...selected, candidate], request) > request.totalBudgetUsd) continue;
    selected.push(candidate);
  }
  // Greedy order can paint itself into a corner (e.g. a $0 budget where only
  // walkable pairs fit). Fall back to the first verified feasible combination.
  if (selected.length < stopCountPolicy.minStops && budgetFeasibility?.feasibleCombinationExamples.length) {
    const example = budgetFeasibility.feasibleCombinationExamples[0].placeIds;
    return orderRoute(example.map((id) => candidates.find((place) => place.id === id)).filter((place): place is NycPlace => Boolean(place)), request);
  }
  return orderRoute(selected, request);
}

const MAX_WALK_KM = { easy: 5.5, balanced: 12, active: 18 } as const;

function validateItinerary(request: PlanRequest, selected: NycPlace[], itinerary: Itinerary, stopCountPolicy: StopCountPolicy, offsetMinutes = 0): ValidationResult {
  if (selected.length < stopCountPolicy.minStops || selected.length > stopCountPolicy.maxStops)
    return { valid: false, reason: `The route should have ${stopCountPolicy.minStops}–${stopCountPolicy.maxStops} stops: ${stopCountPolicy.reason}` };
  if (new Set(selected.map((place) => place.id)).size !== selected.length) return { valid: false, reason: "The route contains a duplicate place." };
  if (selected.some((place) => (!place.published && place.dataOrigin !== "realtime_geoapify") || !hasCompleteEvidence(place)))
    return { valid: false, reason: "The route contains a place without a complete source." };
  if (itinerary.estimatedTotalSpendUsd.max > request.totalBudgetUsd) return { valid: false, reason: "The estimated total exceeds your trip budget." };
  if (itinerary.estimatedWalkKm > MAX_WALK_KM[request.walkingPreference]) return { valid: false, reason: "The route's estimated walking distance doesn't match your walking pace." };
  if (!scheduleForRoute(request, selected, offsetMinutes).fits)
    return { valid: false, reason: `${resolvePlanDurationHours(request)} hours isn't enough for these stops plus travel, even with shorter visits. Add time or choose fewer places.` };
  return { valid: true };
}

/** Rejects affirmative real-time promises before any model text reaches a user. */
export function hasUnsupportedClaim(text: string) {
  const patterns = [
    /\b(?:guarantee[sd]?|ensures?|confirmed?|promise[sd]?)\b.{0,24}\b(?:open|tickets?|availability|seats?|wait|price|fare|schedule)/i,
    /\b(?:open now|currently open|tickets? (?:are )?available|no (?:wait|lines?|queue)|real[- ]time|live (?:traffic|status))\b/i,
    /\b(?:i (?:have )?booked|reserved for you|we booked)\b/i,
    /\$\s?\d/,
  ];
  return patterns.some((pattern) => pattern.test(text));
}

function ruleReason(place: NycPlace, request: PlanRequest, intentParse: IntentParse) {
  const reasons: string[] = [];
  if (intentParse.detectedSignals.includes(place.name)) reasons.push("You named this place");
  const matched = place.interests.filter((interest) => (request.interests as string[]).includes(interest));
  if (matched.length) reasons.push(`Matches your ${matched.slice(0, 2).join(" & ")} interest`);
  if (place.dataOrigin === "realtime_geoapify") reasons.push("Nearby live map listing (not reviewed)");
  return reasons.slice(0, 2).join(" · ") || "Balances published places, your total budget and the route's pace";
}

export function buildItineraryFromSelection(
  request: PlanRequest,
  selected: NycPlace[],
  version: string,
  intentParse: IntentParse,
  options: { scheduleOffsetMinutes?: number; aiReasons?: Record<string, string> } = {},
): Itinerary {
  const timeWindow = resolveTimeWindowPolicy(request);
  const schedule = scheduleForRoute(request, selected, options.scheduleOffsetMinutes ?? 0);
  const stops: ItineraryStop[] = selected.map((place, index) => {
    const spend = groupSpendForPlace(place, request.partySize);
    const aiReason = options.aiReasons?.[place.id];
    return {
      id: `stop_${index + 1}`,
      placeId: place.id,
      name: place.name,
      time: schedule.times[index] ?? "17:30",
      durationMinutes: schedule.visits[index] ?? place.suggestedMinutes,
      expectedSpendUsd: spend.groupSpendUsd ?? 0,
      spendEstimated: spend.status === "estimated",
      reason: aiReason ?? ruleReason(place, request, intentParse),
      reasonSource: aiReason ? "ai" : "rules",
      sourceName: place.sourceName,
      sourceUrl: place.sourceUrl,
      dataOrigin: place.dataOrigin ?? "curated",
      place,
    };
  });
  const metrics = calculateRouteMetrics(request, selected.map((place) => place.id), byIdMap(selected));
  const placeSpend = selectedSpendAudit(selected, request).selectedGroupSpendUsd ?? Number.POSITIVE_INFINITY;
  const hasLive = selected.some((place) => place.dataOrigin === "realtime_geoapify");
  const hasEstimate = stops.some((stop) => stop.spendEstimated);
  return {
    id: `nyc_${crypto.randomUUID()}`,
    status: "valid",
    title: resolvePlanDurationHours(request) >= 8 ? "Your NYC day" : "Your NYC half day",
    overview: hasLive
      ? `Selected ${selected.length} stops from the published NYC catalog and live map listings: ${selected.map((place) => place.name).join(", ")}. Live listings are not reviewed — confirm hours, prices and access before you go.`
      : `Selected ${selected.length} stops from the published NYC catalog: ${selected.map((place) => place.name).join(", ")}. Opening hours, tickets and live transit must be checked with official sources.`,
    stops,
    transportSegments: metrics.transportSegments,
    timeWindow,
    estimatedWalkKm: metrics.estimatedWalkKm,
    estimatedTotalSpendUsd: { min: Math.ceil(placeSpend + metrics.estimatedTransportUsd.min), max: Math.ceil(placeSpend + metrics.estimatedTransportUsd.max), status: "estimated" },
    confidenceNote: hasLive
      ? "This route includes live map listings that Wayly has not reviewed; transport, time and spend need a second check."
      : "Place facts come from published sources; transport, time and spend are static estimates.",
    warnings: [
      hasLive ? "Live map listings are labeled and not reviewed; other stops come from published records." : "Every stop comes from the published nyc-poi-v1 catalog with a source link.",
      ...(hasEstimate ? ["Some spend figures are category estimates, not verified prices."] : []),
      ...(schedule.trimmed ? ["Some visits were shortened to fit your available hours."] : []),
      ...(metrics.transportSegments.some((segment) => segment.uncertaintyNotice.includes("ferry")) ? ["One leg crosses the harbor by ferry — check the ferry schedule before you go."] : []),
      "Planning allowances are not live prices; transport estimates are not navigation, tickets or ride quotes.",
      "Walking estimates cover only the legs between stops, not inside venues.",
    ],
    version: `${NYC_POI_DATA_VERSION} / ${version}`,
    dataVersionId: NYC_POI_DATA_VERSION,
  };
}

function storeItinerary(itinerary: Itinerary) {
  remember(itineraryMemory, itinerary.id, itinerary);
}

function controlledResult(request: PlanRequest, candidates: CandidateResult): PlannerResult {
  if (candidates.insufficiencyReason) return { mode: "insufficient_information", itinerary: null, insufficiencyReason: candidates.insufficiencyReason, intentParse: candidates.intentParse };
  const selected = selectStops(candidates.candidates, request, candidates.stopCountPolicy, candidates.intentParse, candidates.budgetFeasibility, candidates.trace.rankingReasons);
  const itinerary = buildItineraryFromSelection(request, selected, "controlled-planner-v3", candidates.intentParse);
  const validation = validateItinerary(request, selected, itinerary, candidates.stopCountPolicy);
  if (!validation.valid) return { mode: "insufficient_information", itinerary: null, insufficiencyReason: validation.reason, intentParse: candidates.intentParse };
  storeItinerary(itinerary);
  return { mode: "controlled_fallback", itinerary, intentParse: candidates.intentParse };
}

/**
 * v2 adjustment (ported from mvp2): pinned and newly added places always stay;
 * other old stops are kept while they still satisfy hard constraints; only the
 * gap is refilled. Legacy NYC actions are translated first.
 */
function adjustedResult(request: PlanRequest, candidates: CandidateResult): PlannerResult {
  const adjustment = request.adjustment;
  if (!adjustment) return controlledResult(request, candidates);
  if (candidates.insufficiencyReason) return { mode: "insufficient_information", itinerary: null, insufficiencyReason: candidates.insufficiencyReason, intentParse: candidates.intentParse };

  const stored = itineraryMemory.get(adjustment.itineraryId);
  const previousPlaces = stored
    ? stored.stops.map((stop) => stop.place)
    : (adjustment.previousPlaceIds ?? []).map((id) => resolvePlace(id)).filter((place): place is NycPlace => Boolean(place));
  if (!previousPlaces.length)
    return { mode: "insufficient_information", itinerary: null, insufficiencyReason: "The original itinerary is no longer available. Please plan again, then adjust.", intentParse: candidates.intentParse };

  // Translate the NYC UI's legacy actions into the v2 model.
  const removeIds = new Set(adjustment.removePlaceIds ?? []);
  const neverVisitIds = new Set(adjustment.neverVisitPlaceIds ?? []);
  if (adjustment.action === "replace" && adjustment.targetStopId) {
    const index = Number(adjustment.targetStopId.replace("stop_", "")) - 1;
    const target = stored?.stops.find((stop) => stop.id === adjustment.targetStopId)?.placeId ?? previousPlaces[index]?.id;
    if (target) {
      removeIds.add(target);
      neverVisitIds.add(target);
    }
  }
  const fewerStops = Boolean(adjustment.fewerStops || adjustment.earlierEnd || adjustment.moreRest || adjustment.action === "shorten");

  const pinnedIds = new Set(adjustment.pinnedPlaceIds ?? []);
  const excludedIds = new Set([...removeIds, ...neverVisitIds]);
  const addIds = (adjustment.addPlaceIds ?? []).filter((id) => !excludedIds.has(id));

  const addedPlaces: NycPlace[] = [];
  for (const id of addIds) {
    const place = resolvePlace(id);
    if (!place || !isPublishedPlaceAvailableForRequest(place, request))
      return { mode: "insufficient_information", itinerary: null, insufficiencyReason: `Can't add "${place?.name ?? id}": it isn't a published candidate or doesn't meet the current constraints (budget, closing day).`, intentParse: candidates.intentParse };
    if (!addedPlaces.some((existing) => existing.id === place.id)) addedPlaces.push(place);
  }
  const pinnedPlaces = previousPlaces.filter((place) => pinnedIds.has(place.id) && !excludedIds.has(place.id));
  const survivorPlaces = previousPlaces.filter((place) => !pinnedIds.has(place.id) && !excludedIds.has(place.id) && !addedPlaces.some((added) => added.id === place.id) && isPublishedPlaceAvailableForRequest(place, request));
  const lockedPlaces = [...pinnedPlaces, ...addedPlaces].filter((place, index, list) => list.findIndex((other) => other.id === place.id) === index);

  const effectiveMaxStops = candidates.stopCountPolicy.maxStops;
  const previousCount = previousPlaces.length;
  const effectiveMinStops = Math.max(1, (fewerStops ? Math.min(candidates.stopCountPolicy.minStops, previousCount - 1) : candidates.stopCountPolicy.minStops));
  const effectivePolicy = { ...candidates.stopCountPolicy, minStops: effectiveMinStops };
  if (lockedPlaces.length > effectiveMaxStops)
    return { mode: "insufficient_information", itinerary: null, insufficiencyReason: `${lockedPlaces.length} pinned or added places exceed the ${effectiveMaxStops}-stop limit for this pace. Remove some, or relax the pace.`, intentParse: candidates.intentParse };

  const desired = fewerStops ? Math.max(1, previousCount - 1) : Math.max(previousCount, effectiveMinStops);
  const targetCount = Math.min(effectiveMaxStops, Math.max(effectiveMinStops, lockedPlaces.length, desired));
  const fillPool = [
    ...survivorPlaces,
    ...candidates.candidates.filter((place) => !lockedPlaces.some((locked) => locked.id === place.id) && !survivorPlaces.some((survivor) => survivor.id === place.id) && !excludedIds.has(place.id)),
  ];
  const selected = [...lockedPlaces];
  const tryFill = (allowOverBudget: boolean) => {
    for (const candidate of fillPool) {
      if (selected.length >= targetCount) break;
      if (selected.some((place) => place.id === candidate.id)) continue;
      if (!allowOverBudget && estimatedTotalMax([...selected, candidate], request) > request.totalBudgetUsd) continue;
      selected.push(candidate);
    }
  };
  tryFill(false);
  if (selected.length < targetCount) tryFill(true);

  const ordered = orderRoute(selected.slice(0, effectiveMaxStops), request);
  let itinerary = buildItineraryFromSelection(request, ordered, "controlled-adjustment-v2", candidates.intentParse, { scheduleOffsetMinutes: adjustment.laterStart ? 90 : 0 });
  const validation = validateItinerary(request, ordered, itinerary, effectivePolicy, adjustment.laterStart ? 90 : 0);
  if (!validation.valid) return { mode: "insufficient_information", itinerary: null, insufficiencyReason: validation.reason, intentParse: candidates.intentParse };
  itinerary = {
    ...itinerary,
    adjustmentPreservation: {
      pinnedPlaceIds: pinnedPlaces.map((place) => place.id),
      keptPlaceIds: survivorPlaces.filter((place) => ordered.some((item) => item.id === place.id)).map((place) => place.id),
      removedPlaceIds: previousPlaces.filter((place) => !ordered.some((item) => item.id === place.id)).map((place) => place.id),
      addedPlaceIds: addedPlaces.map((place) => place.id),
    },
  };
  storeItinerary(itinerary);
  return { mode: "controlled_fallback", itinerary, intentParse: candidates.intentParse };
}

/** Reuse one resolved whitelist across the API fallback and model paths. */
export function planWithResolvedCandidates(request: PlanRequest, candidates: CandidateResult): PlannerResult {
  return request.adjustment ? adjustedResult(request, candidates) : controlledResult(request, candidates);
}

/* ---------- Model selection checks ---------- */

export type ModelSelectionInspection = { intentParse: IntentParse; selected: NycPlace[] | null; budgetGuard: BudgetGuardAudit | null; reason?: string };

/** Inspects a model selection; never substitutes a cheaper subset on the model's behalf. */
export function inspectModelSelection(request: PlanRequest, selectedIds: string[], candidates: CandidateResult): ModelSelectionInspection {
  if (candidates.insufficiencyReason) return { intentParse: candidates.intentParse, selected: null, budgetGuard: null, reason: candidates.insufficiencyReason };
  const policy = candidates.stopCountPolicy;
  if (selectedIds.length < policy.minStops || selectedIds.length > policy.maxStops || new Set(selectedIds).size !== selectedIds.length)
    return { intentParse: candidates.intentParse, selected: null, budgetGuard: null, reason: "The model returned the wrong number of places or a duplicate." };
  const selected = selectedIds.map((id) => candidates.candidates.find((place) => place.id === id));
  if (selected.some((place) => !place)) return { intentParse: candidates.intentParse, selected: null, budgetGuard: null, reason: "The model returned a place outside the candidate set." };
  const places = selected as NycPlace[];
  // Reject stale/tainted candidate records before route and budget calculation,
  // which require trusted inputs and would otherwise throw instead of refusing.
  if (places.some((place) => (!place.published && place.dataOrigin !== "realtime_geoapify") || !hasCompleteEvidence(place)))
    return { intentParse: candidates.intentParse, selected: null, budgetGuard: null, reason: "The model selected a place without published status or complete source evidence." };
  const budgetGuard = inspectSelectionBudget(request, places);
  if (!budgetGuard.valid)
    return { intentParse: candidates.intentParse, selected: places, budgetGuard, reason: budgetGuard.unknownPlaceIds.length ? "The selection includes a place whose price can't be shown to fit the budget." : "The selection's place spend plus static transport exceeds the total budget." };
  const itinerary = buildItineraryFromSelection(request, places, "ai-structured-v2", candidates.intentParse);
  const validation = validateItinerary(request, places, itinerary, policy);
  if (!validation.valid) return { intentParse: candidates.intentParse, selected: places, budgetGuard, reason: validation.reason };
  return { intentParse: candidates.intentParse, selected: places, budgetGuard };
}

export function validateModelSelection(request: PlanRequest, selectedIds: string[], candidates: CandidateResult, aiReasons?: Record<string, string>) {
  const inspection = inspectModelSelection(request, selectedIds, candidates);
  if (inspection.reason || !inspection.selected) return { intentParse: inspection.intentParse, reason: inspection.reason ?? "The model selection failed deterministic validation.", budgetGuard: inspection.budgetGuard };
  const itinerary = buildItineraryFromSelection(request, inspection.selected, "ai-structured-v2", inspection.intentParse, { aiReasons });
  storeItinerary(itinerary);
  return { intentParse: inspection.intentParse, itinerary, budgetGuard: inspection.budgetGuard };
}
