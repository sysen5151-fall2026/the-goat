import type { CandidateFilteringResult } from "@/lib/nyc-candidate-filtering";
import { isIndividuallyAffordable } from "@/lib/nyc-budget";
import { distanceKm } from "@/lib/nyc-geo";
import type { ExpectedSpendSemantics, NycPlace, PlaceCategory, PlanRequest } from "@/lib/nyc-types";

/**
 * Curated + realtime dual-layer candidates (ported from mvp2's Amap fallback,
 * using Geoapify Places / OpenStreetMap instead).
 *
 * The curated shortlist is the trusted layer. For ordinary requests this module
 * also recalls a few live listings for the user's explicit interests, so the
 * model sees both stable reviewed places and nearby alternatives. It never runs
 * for affordability, accessibility, vegetarian, city or evidence hard blocks —
 * a live lookup must not paper over a deliberate refusal.
 *
 * Pricing (product decision 2026-10): OpenStreetMap has no admission prices.
 * - Parks, viewpoints, squares, memorials, or listings tagged fee=no → free.
 * - Restaurants, cafés, museums, galleries, markets, paid attractions → a fixed
 *   per-person category estimate, marked `category_estimate` and shown in the UI
 *   as "estimated, not verified".
 * Live listings are never written into the curated nyc-poi-v1 catalog.
 */
export const REALTIME_POI_RETRIEVAL_VERSION = "realtime-poi-retrieval-geoapify-v1";

const PLACES_URL = "https://api.geoapify.com/v2/places";
const TIMEOUT_MS = 4000;
const MAX_RESULTS_PER_CATEGORY = 10;
const MAX_REALTIME_CANDIDATES_PER_REQUEST = 3;
const MAX_MIXED_CANDIDATE_COUNT = 8;
const SECONDARY_FILTER_RADIUS_KM = 15;
const DUPLICATE_RADIUS_KM = 0.12;
const CACHE_TTL_MS = 30 * 60 * 1000;
const MIDTOWN = { latitude: 40.758, longitude: -73.9855 };

/** Geoapify category queries per Wayly interest. */
const CATEGORY_QUERY: Record<PlaceCategory, string> = {
  landmark: "tourism.sights,tourism.attraction",
  museum: "entertainment.museum",
  park: "leisure.park",
  waterfront: "beach,leisure.park",
  food: "catering.restaurant,commercial.marketplace",
  views: "tourism.attraction.viewpoint",
  architecture: "tourism.sights",
  history: "heritage,tourism.sights.memorial",
  art: "entertainment.culture.gallery,entertainment.culture.arts_centre",
  science: "entertainment.planetarium,entertainment.zoo,entertainment.aquarium",
  performance: "entertainment.culture.theatre",
  family: "entertainment.zoo,entertainment.aquarium,entertainment.theme_park",
};
const COFFEE_QUERY = "catering.cafe";

/** Per-person category estimates (USD) for listings without a free signal. */
const CATEGORY_ESTIMATE_USD: Array<{ prefix: string; usd: number; label: string }> = [
  { prefix: "catering.restaurant", usd: 25, label: "restaurant" },
  { prefix: "catering.cafe", usd: 8, label: "café" },
  { prefix: "commercial.marketplace", usd: 15, label: "market" },
  { prefix: "entertainment.museum", usd: 25, label: "museum" },
  { prefix: "entertainment.culture.gallery", usd: 0, label: "gallery" },
  { prefix: "entertainment.culture.arts_centre", usd: 15, label: "arts center" },
  { prefix: "entertainment.culture.theatre", usd: 60, label: "show" },
  { prefix: "entertainment.zoo", usd: 30, label: "zoo" },
  { prefix: "entertainment.aquarium", usd: 35, label: "aquarium" },
  { prefix: "entertainment.planetarium", usd: 25, label: "planetarium" },
  { prefix: "entertainment.theme_park", usd: 40, label: "amusement park" },
  { prefix: "tourism.attraction", usd: 20, label: "attraction" },
];
const FREE_PREFIXES = ["leisure.park", "beach", "heritage", "tourism.attraction.viewpoint", "tourism.sights.memorial", "tourism.sights", "leisure.square"];

type GeoapifyFeature = {
  properties?: {
    place_id?: string;
    /** OSM names can arrive as numbers (e.g. a restaurant called "886"). */
    name?: string | number;
    lat?: number;
    lon?: number;
    categories?: string[];
    formatted?: string;
    address_line2?: string;
    suburb?: string;
    district?: string;
    city?: string;
    state_code?: string;
    website?: string;
    datasource?: { raw?: Record<string, unknown> };
  };
};

export type RealtimeFallbackDeps = { fetchImpl?: typeof fetch; apiKey?: string; now?: () => string };

const cache = new Map<string, { at: number; features: GeoapifyFeature[] }>();

function apiKey(deps: RealtimeFallbackDeps) {
  return deps.apiKey ?? (process.env.GEOAPIFY_KEY || process.env.NEXT_PUBLIC_GEOAPIFY_KEY || "");
}

async function searchPlaces(categories: string, center: { latitude: number; longitude: number }, deps: RealtimeFallbackDeps): Promise<{ ok: true; features: GeoapifyFeature[] } | { ok: false; reason: string }> {
  const key = apiKey(deps);
  if (!key) return { ok: false, reason: "GEOAPIFY_KEY is not configured" };
  const cacheKey = `${categories}|${center.latitude.toFixed(3)},${center.longitude.toFixed(3)}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return { ok: true, features: cached.features };
  const params = new URLSearchParams({
    categories,
    filter: `circle:${center.longitude},${center.latitude},${SECONDARY_FILTER_RADIUS_KM * 1000}`,
    bias: `proximity:${center.longitude},${center.latitude}`,
    limit: String(MAX_RESULTS_PER_CATEGORY),
    lang: "en",
    apiKey: key,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await (deps.fetchImpl ?? fetch)(`${PLACES_URL}?${params}`, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
    const payload = (await response.json()) as { features?: GeoapifyFeature[] };
    const features = payload.features ?? [];
    cache.set(cacheKey, { at: Date.now(), features });
    return { ok: true, features };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "network error" };
  } finally {
    clearTimeout(timer);
  }
}

function pricingFor(categories: string[], raw: Record<string, unknown>): { usd: number; semantics: ExpectedSpendSemantics; note: string } {
  const fee = typeof raw.fee === "string" ? raw.fee.toLowerCase() : "";
  if (fee === "no") return { usd: 0, semantics: "free", note: "Listed as free on OpenStreetMap; not verified by Wayly." };
  for (const { prefix, usd, label } of CATEGORY_ESTIMATE_USD) {
    if (categories.some((category) => category.startsWith(prefix))) {
      if (usd === 0) return { usd: 0, semantics: "free", note: `Most ${label}s are free to enter; not verified by Wayly.` };
      return { usd, semantics: "category_estimate", note: `Estimated ~$${usd}/person for a ${label} — a category estimate, not a verified price.` };
    }
  }
  if (fee !== "yes" && categories.some((category) => FREE_PREFIXES.some((prefix) => category.startsWith(prefix))))
    return { usd: 0, semantics: "free", note: "Public space, typically free; not verified by Wayly." };
  if (fee === "yes") return { usd: 20, semantics: "category_estimate", note: "Charges admission (OpenStreetMap); estimated ~$20/person, not verified." };
  return { usd: 0, semantics: "unknown", note: "No price information." };
}

function sourceUrlFor(properties: NonNullable<GeoapifyFeature["properties"]>, raw: Record<string, unknown>) {
  const website = (typeof raw.website === "string" && raw.website) || properties.website;
  if (website) return website.startsWith("http") ? website : `https://${website}`;
  const osmType = raw.osm_type === "n" ? "node" : raw.osm_type === "w" ? "way" : raw.osm_type === "r" ? "relation" : null;
  const osmId = typeof raw.osm_id === "number" || typeof raw.osm_id === "string" ? String(raw.osm_id) : null;
  if (osmType && osmId) return `https://www.openstreetmap.org/${osmType}/${osmId}`;
  return null;
}

/** OSM image hints: a direct https `image` tag and/or an English `wikipedia` tag ("en:Title"). */
function osmImage(raw: Record<string, unknown>): Pick<NycPlace, "imageUrl" | "imageCreditUrl" | "wikipediaTitle"> {
  const image = typeof raw.image === "string" && raw.image.startsWith("https://") ? raw.image : "";
  const wiki = typeof raw.wikipedia === "string" && raw.wikipedia.startsWith("en:") ? raw.wikipedia.slice(3).trim() : "";
  return { imageUrl: image, imageCreditUrl: image, ...(wiki ? { wikipediaTitle: wiki } : {}) };
}

function toPlace(feature: GeoapifyFeature, interest: PlaceCategory, retrievedAt: string): NycPlace | null {
  const properties = feature.properties;
  const name = typeof properties?.name === "string" || typeof properties?.name === "number" ? String(properties.name).trim() : "";
  if (!properties || !name || typeof properties.lat !== "number" || typeof properties.lon !== "number" || !properties.place_id) return null;
  const raw = properties.datasource?.raw ?? {};
  const categories = properties.categories ?? [];
  const sourceUrl = sourceUrlFor(properties, raw);
  if (!sourceUrl) return null;
  const pricing = pricingFor(categories, raw);
  const isFood = categories.some((category) => category.startsWith("catering") || category.startsWith("commercial.marketplace"));
  const isPark = categories.some((category) => category.startsWith("leisure.park"));
  const interests: NycPlace["interests"] = isFood ? ["food"] : [interest];
  return {
    id: `geo-${properties.place_id.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20)}`,
    name,
    neighborhood: properties.suburb ?? properties.district ?? properties.city ?? "New York",
    latitude: properties.lat,
    longitude: properties.lon,
    interests,
    planningAllowanceUsd: pricing.usd,
    expectedSpendSemantics: pricing.semantics,
    suggestedMinutes: isFood ? 75 : isPark ? 90 : 60,
    sourceName: "OpenStreetMap via Geoapify (live listing)",
    sourceUrl,
    reviewedOn: retrievedAt.slice(0, 10),
    accessNote: `Live map listing${properties.address_line2 ? ` at ${properties.address_line2}` : ""}. Hours, access and prices are not reviewed by Wayly — check before you go.`,
    priceNote: pricing.note,
    ...osmImage(raw),
    published: false,
    keywordTags: categories,
    closedWeekdays: [],
    dataOrigin: "realtime_geoapify",
    address: properties.formatted,
  };
}

function requestedCategories(request: PlanRequest): Array<{ interest: PlaceCategory; query: string }> {
  const wanted = request.interests.map((interest) => ({ interest, query: CATEGORY_QUERY[interest] }));
  if (request.dining === "coffee") wanted.push({ interest: "food", query: COFFEE_QUERY });
  return wanted;
}

/**
 * Recalls live listings for the request's explicit interests, then lets
 * deterministic distance / duplicate / budget / price-semantics checks decide
 * whether any can join the bounded candidate whitelist (at most 3 slots).
 */
export async function augmentCandidatesWithRealtimeGeoapify(
  request: PlanRequest,
  filtering: CandidateFilteringResult,
  curatedCatalog: NycPlace[],
  deps: RealtimeFallbackDeps = {},
): Promise<CandidateFilteringResult> {
  if (filtering.insufficiencyKind && filtering.insufficiencyKind !== "quantity") return filtering;
  const wanted = requestedCategories(request);
  if (!wanted.length) return filtering;

  const retrievedAt = deps.now ? deps.now() : new Date().toISOString();
  const center = filtering.candidates[0] ?? MIDTOWN;
  const queries: string[] = [];
  const errors: string[] = [];
  const accepted: NycPlace[] = [];
  let totalFound = 0;

  const results = await Promise.all(wanted.map(async ({ interest, query }) => ({ interest, query, result: await searchPlaces(query, center, deps) })));
  for (const { interest, query, result } of results) {
    queries.push(query);
    if (!result.ok) {
      errors.push(`[${interest}] ${result.reason}`);
      continue;
    }
    totalFound += result.features.length;
    for (const feature of result.features) {
      const place = toPlace(feature, interest, retrievedAt);
      if (!place) continue;
      const anchors = [...filtering.candidates, ...accepted];
      const duplicate = [...curatedCatalog, ...accepted].some((other) => other.name.toLowerCase() === place.name.toLowerCase() || distanceKm(other, place) <= DUPLICATE_RADIUS_KM);
      const coherent = !anchors.length || anchors.some((anchor) => distanceKm(anchor, place) <= SECONDARY_FILTER_RADIUS_KM);
      // Unknown price is never "free": the shared budget helper rejects it.
      if (!duplicate && coherent && isIndividuallyAffordable(place, request)) accepted.push(place);
    }
  }

  const trace = {
    ...filtering.trace,
    usedRealtimeFallback: true,
    realtimeQuery: queries,
    realtimeCandidateCount: totalFound,
    realtimeCandidatesAccepted: accepted.length,
    realtimeFetchErrors: errors,
  };
  if (!accepted.length) return { ...filtering, trace };

  // Interleave interests so one category doesn't take every live slot.
  const byInterest = new Map<string, NycPlace[]>();
  for (const place of accepted) byInterest.set(place.interests[0], [...(byInterest.get(place.interests[0]) ?? []), place]);
  const interleaved: NycPlace[] = [];
  while (interleaved.length < accepted.length) for (const list of byInterest.values()) if (list.length) interleaved.push(list.shift() as NycPlace);
  const realtime = interleaved.slice(0, MAX_REALTIME_CANDIDATES_PER_REQUEST);
  const curatedSlots = Math.max(0, MAX_MIXED_CANDIDATE_COUNT - realtime.length);
  const merged = [...filtering.candidates.slice(0, curatedSlots), ...realtime];
  return {
    candidates: merged,
    intentParse: filtering.intentParse,
    insufficiencyReason: undefined,
    insufficiencyKind: undefined,
    trace: { ...trace, shortlistedCount: merged.length, selectedCandidateIds: merged.map((place) => place.id) },
  };
}
