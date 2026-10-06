import type { Itinerary, TransportSegment } from "@/lib/nyc-types";

/**
 * Final-itinerary route validation with the Geoapify Routing API (the NYC
 * counterpart of mvp2's Amap Direction check). Runs on the server after a route
 * is chosen — never during candidate search — one request per leg:
 * walk → mode=walk, taxi → mode=drive, transit → mode=approximated_transit.
 * Each leg is isolated: a failure keeps that leg's static estimate. Fares are
 * not provided by Geoapify, so transit/taxi costs stay planning estimates.
 * Geoapify bills 1 credit per leg; results are cached in memory.
 */
export const ROUTE_VALIDATION_VERSION = "route-validation-geoapify-v1";

type Leg = { coordinates: [number, number][]; meters: number; seconds: number };
type GeoapifyRoute = { features?: Array<{ geometry?: { type: string; coordinates: number[][][] | number[][] }; properties?: { distance?: number; time?: number } }> };

const ROUTING_URL = "https://api.geoapify.com/v1/routing";
const TIMEOUT_MS = 4500;
const cache = new Map<string, Leg>();

function routingKey() {
  return process.env.GEOAPIFY_KEY || process.env.NEXT_PUBLIC_GEOAPIFY_KEY || "";
}

const MODE: Record<TransportSegment["recommendedMode"], string> = { walk: "walk", taxi: "drive", public_transit: "approximated_transit" };
const LABEL: Record<TransportSegment["recommendedMode"], string> = { walk: "walking", taxi: "driving", public_transit: "approximate transit" };

async function fetchLeg(from: [number, number], to: [number, number], mode: string): Promise<Leg | null> {
  const key = routingKey();
  if (!key) return null;
  const waypoints = `${from[1]},${from[0]}|${to[1]},${to[0]}`;
  const cacheKey = `${mode}|${waypoints}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${ROUTING_URL}?waypoints=${encodeURIComponent(waypoints)}&mode=${mode}&apiKey=${encodeURIComponent(key)}`, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const feature = ((await response.json()) as GeoapifyRoute).features?.[0];
    const geometry = feature?.geometry;
    if (!geometry || typeof feature?.properties?.time !== "number" || typeof feature.properties.distance !== "number") return null;
    const lines = (geometry.type === "MultiLineString" ? geometry.coordinates : [geometry.coordinates]) as number[][][];
    const leg = { coordinates: lines.flat().map((point) => [point[0], point[1]] as [number, number]), meters: feature.properties.distance, seconds: feature.properties.time };
    if (cache.size > 500) cache.delete(cache.keys().next().value as string);
    cache.set(cacheKey, leg);
    return leg;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const WALK_SWITCH_MINUTES = 30;

function toMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function label(total: number) {
  const minutes = ((Math.round(total) % 1440) + 1440) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function retime(itinerary: Itinerary, segments: TransportSegment[]) {
  if (!itinerary.stops.length) return itinerary.stops;
  let clock = toMinutes(itinerary.stops[0].time);
  return itinerary.stops.map((stop, index) => {
    const next = { ...stop, time: label(clock) };
    const leg = segments[index];
    clock += stop.durationMinutes + (leg ? Math.round((leg.estimatedMinutes.min + leg.estimatedMinutes.max) / 2) : 0);
    return next;
  });
}

export async function validateItineraryRoute(itinerary: Itinerary, partySize = 1): Promise<Itinerary> {
  if (!routingKey() || itinerary.stops.length < 2) return { ...itinerary, routeSource: "estimate" };
  const point = (stopId: string): [number, number] | null => {
    const stop = itinerary.stops.find((item) => item.id === stopId);
    return stop ? [stop.place.longitude, stop.place.latitude] : null;
  };
  const legs = await Promise.all(itinerary.transportSegments.map(async (segment) => {
    const from = point(segment.fromStopId);
    const to = point(segment.toStopId);
    if (!from || !to) return { from, to, leg: null, mode: segment.recommendedMode };
    const leg = await fetchLeg(from, to, MODE[segment.recommendedMode]);
    // Straight-line distance can hide a river or a pier: a "short" walk that really takes
    // longer than WALK_SWITCH_MINUTES is re-routed as transit instead of shown as a long walk.
    if (leg && segment.recommendedMode === "walk" && leg.seconds / 60 > WALK_SWITCH_MINUTES) {
      const transit = await fetchLeg(from, to, MODE.public_transit);
      if (transit) return { from, to, leg: transit, mode: "public_transit" as const };
    }
    return { from, to, leg, mode: segment.recommendedMode };
  }));

  let walkMeters = 0;
  const transportSegments: TransportSegment[] = itinerary.transportSegments.map((segment, index) => {
    const { leg, mode } = legs[index];
    if (!leg) {
      if (segment.recommendedMode === "walk") walkMeters += Number.NaN; // mark: fall back to the static estimate below
      return segment;
    }
    if (mode === "walk") walkMeters += leg.meters;
    const minutes = Math.max(1, Math.round(leg.seconds / 60));
    const switched = mode !== segment.recommendedMode;
    return {
      ...segment,
      recommendedMode: mode,
      estimatedMinutes: { min: minutes, max: Math.ceil(minutes * 1.15) },
      ...(switched ? { estimatedCostUsd: { min: 2.9 * partySize, max: 5.8 * partySize } } : {}),
      uncertaintyNotice: switched
        ? "Walking here takes much longer than the straight-line distance suggests (river or pier in the way), so transit is suggested; time from a Geoapify approximate-transit route."
        : `Time from a Geoapify ${LABEL[mode]} route; live traffic, service changes and fares still need a check.`,
    };
  });
  const extraCost = transportSegments.reduce((total, segment, index) => (segment.recommendedMode !== itinerary.transportSegments[index].recommendedMode ? { min: total.min + (segment.estimatedCostUsd?.min ?? 0), max: total.max + (segment.estimatedCostUsd?.max ?? 0) } : total), { min: 0, max: 0 });
  // Re-time the day with the routed legs so stop times match the leg times shown.
  const stops = retime(itinerary, transportSegments);
  const validated = legs.filter((item) => item.leg).length;
  const coordinates: [number, number][] = legs.flatMap(({ from, to, leg }) => (leg ? leg.coordinates : from && to ? [from, to] : []));
  return {
    ...itinerary,
    stops,
    transportSegments,
    ...(extraCost.max > 0
      ? {
          estimatedTotalSpendUsd: { ...itinerary.estimatedTotalSpendUsd, min: Math.ceil(itinerary.estimatedTotalSpendUsd.min + extraCost.min), max: Math.ceil(itinerary.estimatedTotalSpendUsd.max + extraCost.max) },
          warnings: [...itinerary.warnings, "A walking leg was switched to transit after street routing; its fare is included in the estimate."],
        }
      : {}),
    estimatedWalkKm: Number.isFinite(walkMeters) ? Number((walkMeters / 1000).toFixed(1)) : itinerary.estimatedWalkKm,
    routeGeometry: validated ? { type: "LineString", coordinates } : undefined,
    routeSource: validated === legs.length ? "geoapify" : validated ? "partial" : "estimate",
  };
}
