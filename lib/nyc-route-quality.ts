import { distanceKm, resolvePlanDurationHours } from "@/lib/nyc-geo";
import { resolveTimeWindowPolicy } from "@/lib/nyc-time-window";
import type { NycPlace, PlaceCategory, PlanRequest, TransportSegment } from "@/lib/nyc-types";

/**
 * Route-shape rules adapted from the team's nyc-data branch planner
 * (multi-start ordering, lunch alignment, visit trimming, food caps, whole-route
 * scoring). They work *inside* the ≤8 candidate shortlist: the shortlist and
 * the model/AI boundary are unchanged; this only decides how a controlled route
 * is chosen and ordered, and how any route is scheduled.
 */
export const ROUTE_QUALITY_VERSION = "route-quality-v1";

const LUNCH_MINUTES = 12 * 60 + 30;
const LUNCH_OFFSET_KM_PER_HOUR = 1.5;
const MIN_VISIT_SHARE = 0.6;
const MIN_VISIT_MINUTES = 30;
const SAME_VENUE_KM = 0.08;
const FOOD_ONLY_VENUE_LIMIT = 4;
const HOURS_PER_FOOD_VENUE = 5;
const COVERAGE_BONUS = 1.2;
const UTILIZATION_BONUS = 3;
const TRAVEL_HOUR_PENALTY = 2.5;
const STOP_SHORTFALL_PENALTY = 0.8;
const LUNCH_PENALTY_PER_HOUR = 1.5;
const DEFAULT_RELEVANCE = 0.8;
const INTENT_TERM_BONUS = 4;
const THEME_BONUS = 2;
const INTENT_CATEGORY_BONUS = 1.6;

/** How strongly each walking pace dislikes distance between stops (per km). */
export const DISTANCE_WEIGHT: Record<PlanRequest["walkingPreference"], number> = { easy: 0.9, balanced: 0.6, active: 0.35 };
/** Longest leg the "smart" transport mode will still recommend walking. */
export const WALK_LIMIT_KM: Record<PlanRequest["walkingPreference"], number> = { easy: 0.8, balanced: 1.5, active: 2.5 };

const FERRY_AREA = /New York Harbor|Staten Island/;
const FOOD_WORDS = /\b(food|eat|eating|lunch|dinner|brunch|pizza|bagels?|deli|pastrami|cheesecake|steak|oysters?|dessert|snack|foodie|hot dogs?)\b/i;

export function isFoodVenue(place: NycPlace) {
  return place.interests[0] === "food";
}

/** Food-only days may hold several eateries; otherwise about one per five hours (min 1). */
export function foodVenueLimit(request: PlanRequest) {
  if (request.interests.length === 1 && request.interests[0] === "food") return FOOD_ONLY_VENUE_LIMIT;
  const asksForFood = FOOD_WORDS.test(request.intentText);
  return request.interests.includes("food") || request.dining === "local" || asksForFood ? Math.max(1, Math.round(resolvePlanDurationHours(request) / HOURS_PER_FOOD_VENUE)) : 1;
}

/** A leg that starts or ends on a harbor island (Liberty / Ellis / Governors / Staten Island) needs a ferry. */
export function needsFerry(from: NycPlace, to: NycPlace) {
  const fromFerry = FERRY_AREA.test(from.neighborhood);
  const toFerry = FERRY_AREA.test(to.neighborhood);
  if (!fromFerry && !toFerry) return false;
  return !(from.neighborhood.includes("Staten Island") && to.neighborhood.includes("Staten Island"));
}

function startMinutes(request: PlanRequest, offsetMinutes = 0) {
  const [hours, minutes] = resolveTimeWindowPolicy(request).startTime.split(":").map(Number);
  return hours * 60 + minutes + offsetMinutes;
}

export function clockLabel(totalMinutes: number) {
  const minutes = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function averageMinutes(segment: TransportSegment) {
  return Math.round((segment.estimatedMinutes.min + segment.estimatedMinutes.max) / 2);
}

export function routeKm(route: NycPlace[]) {
  return route.slice(1).reduce((total, place, index) => total + distanceKm(route[index], place), 0);
}

/** Hours between the first food stop's arrival and 12:30, using a rough 20-minute leg. */
function lunchOffsetHours(route: NycPlace[], request: PlanRequest) {
  let clock = startMinutes(request);
  for (const place of route) {
    if (isFoodVenue(place)) return Math.abs(clock - LUNCH_MINUTES) / 60;
    clock += place.suggestedMinutes + 20;
  }
  return 0;
}

/**
 * Order stops by trying a nearest-neighbour walk from every start (and its
 * reverse), keeping the shortest — with a food stop pulled toward lunchtime.
 */
export function orderRoute(places: NycPlace[], request: PlanRequest) {
  if (places.length < 2) return places;
  let best = places;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const start of places) {
    const ordered = [start];
    const remaining = places.filter((place) => place !== start);
    while (remaining.length) {
      const last = ordered[ordered.length - 1];
      const nearestIndex = remaining.reduce((bestIndex, candidate, index) => (distanceKm(last, candidate) < distanceKm(last, remaining[bestIndex]) ? index : bestIndex), 0);
      ordered.push(remaining.splice(nearestIndex, 1)[0]);
    }
    for (const route of [ordered, [...ordered].reverse()]) {
      const cost = routeKm(route) + LUNCH_OFFSET_KM_PER_HOUR * lunchOffsetHours(route, request);
      if (cost < bestCost) {
        best = route;
        bestCost = cost;
      }
    }
  }
  return best;
}

export type VisitSchedule = { times: string[]; visits: number[]; travelMinutes: number; trimmed: boolean; fits: boolean };

/**
 * Sequential schedule: each stop starts when the previous visit plus the leg
 * ends. If the suggested visits don't fit the available hours, every visit is
 * shortened proportionally (never below 60% or 30 min); `fits` is false when
 * even the shortened day overruns.
 */
export function planVisitSchedule(request: PlanRequest, route: NycPlace[], segments: TransportSegment[], offsetMinutes = 0): VisitSchedule {
  const available = resolvePlanDurationHours(request) * 60;
  const legs = segments.map(averageMinutes);
  const travelMinutes = legs.reduce((total, minutes) => total + minutes, 0);
  const ideal = route.map((place) => place.suggestedMinutes);
  const idealTotal = ideal.reduce((total, minutes) => total + minutes, 0);
  let visits = ideal;
  let trimmed = false;
  let fits = true;
  if (travelMinutes + idealTotal > available) {
    const minimum = ideal.map((minutes) => Math.min(minutes, Math.max(MIN_VISIT_MINUTES, Math.round(minutes * MIN_VISIT_SHARE))));
    const minimumTotal = minimum.reduce((total, minutes) => total + minutes, 0);
    trimmed = true;
    if (travelMinutes + minimumTotal > available) {
      visits = minimum;
      fits = false;
    } else {
      const share = idealTotal === minimumTotal ? 0 : (available - travelMinutes - minimumTotal) / (idealTotal - minimumTotal);
      visits = ideal.map((minutes, index) => Math.max(minimum[index], Math.floor((minimum[index] + (minutes - minimum[index]) * share) / 5) * 5));
    }
  }
  let clock = startMinutes(request, offsetMinutes);
  const times = route.map((_, index) => {
    const label = clockLabel(clock);
    clock += visits[index] + (legs[index] ?? 0);
    return label;
  });
  return { times, visits, travelMinutes, trimmed, fits };
}

export type RouteEvaluator = {
  /** Transport segments for an ordered route (the shared route-metrics implementation). */
  segmentsFor: (route: NycPlace[]) => TransportSegment[];
  /** Hard budget check for an ordered route. */
  withinBudget: (route: NycPlace[]) => boolean;
  /** Shortlist relevance score per place id (from candidate filtering). */
  scoreById: Map<string, number>;
  /** Request themes each place covers ("term:…", "cat:…", "theme:…"). */
  signalsById?: Map<string, string[]>;
};

/** Whole-route score: relevance × time spent, interest coverage, time use, minus travel, distance, missing stops and a late lunch. */
export function routeQuality(route: NycPlace[], schedule: VisitSchedule, request: PlanRequest, maxStops: number, evaluator: RouteEvaluator) {
  const relevance = route.reduce((total, place, index) => {
    const score = evaluator.scoreById.get(place.id);
    const normalized = score === undefined ? DEFAULT_RELEVANCE : Math.max(0.2, score / 50);
    return total + normalized * Math.sqrt(schedule.visits[index] / 60);
  }, 0);
  const covered = new Set(route.flatMap((place) => place.interests.filter((interest) => request.interests.includes(interest as PlaceCategory))));
  const visitMinutes = schedule.visits.reduce((total, minutes) => total + minutes, 0);
  const utilization = UTILIZATION_BONUS * Math.min(1, visitMinutes / (resolvePlanDurationHours(request) * 60)) - TRAVEL_HOUR_PENALTY * (schedule.travelMinutes / 60);
  // Reward covering more of what the user typed: a named area/word counts most, then a theme, then a category.
  const signals = new Set(route.flatMap((place) => evaluator.signalsById?.get(place.id) ?? []));
  const count = (prefix: string) => [...signals].filter((signal) => signal.startsWith(prefix)).length;
  const coverage = 2 * COVERAGE_BONUS * covered.size + INTENT_TERM_BONUS * Math.min(3, count("term:")) + THEME_BONUS * Math.min(3, count("theme:")) + INTENT_CATEGORY_BONUS * Math.min(2, count("cat:"));
  const shortfall = STOP_SHORTFALL_PENALTY * Math.max(0, maxStops - route.length);
  const lunch = route.some(isFoodVenue) ? LUNCH_PENALTY_PER_HOUR * lunchOffsetHours(route, request) : 0;
  return relevance + coverage + utilization - shortfall - lunch - DISTANCE_WEIGHT[request.walkingPreference] * routeKm(route);
}

function subsets<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  const visit = (start: number, current: T[]) => {
    if (current.length === size) {
      result.push(current);
      return;
    }
    for (let index = start; index <= items.length - (size - current.length); index += 1) visit(index + 1, [...current, items[index]]);
  };
  visit(0, []);
  return result;
}

/**
 * Exhaustive search over the ≤8 shortlist (≤ a few hundred subsets): every
 * route of an allowed size that keeps all named places, respects the food cap,
 * avoids two stops at the same venue, fits the budget and (with trimming) the
 * hours, is ordered and scored; the best one wins.
 */
export function chooseBestRoute(
  candidates: NycPlace[],
  request: PlanRequest,
  policy: { minStops: number; maxStops: number },
  requiredIds: Set<string>,
  evaluator: RouteEvaluator,
): { route: NycPlace[]; schedule: VisitSchedule; quality: number } | null {
  const required = candidates.filter((place) => requiredIds.has(place.id));
  const optional = candidates.filter((place) => !requiredIds.has(place.id));
  const foodLimit = foodVenueLimit(request);
  let best: { route: NycPlace[]; schedule: VisitSchedule; quality: number } | null = null;
  for (let size = Math.max(policy.minStops, required.length); size <= policy.maxStops; size += 1) {
    const fillCount = size - required.length;
    if (fillCount < 0 || fillCount > optional.length) continue;
    for (const fill of subsets(optional, fillCount)) {
      const places = [...required, ...fill];
      if (places.filter(isFoodVenue).length > Math.max(foodLimit, required.filter(isFoodVenue).length)) continue;
      if (places.some((place, index) => places.slice(index + 1).some((other) => distanceKm(place, other) < SAME_VENUE_KM))) continue;
      const route = orderRoute(places, request);
      if (!evaluator.withinBudget(route)) continue;
      const schedule = planVisitSchedule(request, route, evaluator.segmentsFor(route));
      if (!schedule.fits) continue;
      const quality = routeQuality(route, schedule, request, policy.maxStops, evaluator);
      if (!best || quality > best.quality) best = { route, schedule, quality };
    }
  }
  return best;
}
