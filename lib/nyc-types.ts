/**
 * NYC planner types. The planning pipeline is ported from Wayly MVP v2 (Beijing):
 * code builds a bounded, auditable candidate shortlist; DeepSeek picks one route
 * from it; code validates everything and falls back to the controlled planner.
 */

export type PlaceCategory =
  | "landmark"
  | "museum"
  | "architecture"
  | "park"
  | "waterfront"
  | "food";

/** Catalog records may carry extra descriptive tags (e.g. "history"). */
export type PlaceInterest = PlaceCategory | "history";

export type TransportPreference = "smart" | "public_transit" | "taxi" | "walk";

export type WeekdayCode = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/**
 * How a planning allowance must be multiplied for the travelling party.
 * - per_person_reference: catalog allowance per person
 * - group_fixed: one amount for the whole party
 * - free: no admission
 * - category_estimate: live map listing priced by a fixed per-person category
 *   estimate (e.g. restaurant $25) — always shown as "estimated, not verified"
 * - unknown: no defensible price; never treated as free, never planned
 */
export type ExpectedSpendSemantics =
  | "per_person_reference"
  | "group_fixed"
  | "free"
  | "category_estimate"
  | "unknown";

/**
 * curated = human-reviewed nyc-poi-v1 record.
 * realtime_geoapify = live OpenStreetMap listing recalled via Geoapify Places
 * at planning time; never written back into the curated catalog.
 */
export type PlaceDataOrigin = "curated" | "realtime_geoapify";

export type NycPlace = {
  id: string;
  name: string;
  neighborhood: string;
  latitude: number;
  longitude: number;
  interests: PlaceInterest[];
  planningAllowanceUsd: number;
  expectedSpendSemantics?: ExpectedSpendSemantics;
  suggestedMinutes: number;
  sourceName: string;
  sourceUrl: string;
  reviewedOn: string;
  accessNote: string;
  priceNote: string;
  imageUrl: string;
  imageCreditUrl: string;
  /** English Wikipedia article title; the UI pulls a lead image from it when imageUrl is missing or fails. */
  wikipediaTitle?: string;
  wikidataId?: string;
  published: boolean;
  /** Everyday names used to detect "the user named this place" (e.g. "the met"). */
  aliases?: string[];
  keywordTags?: string[];
  /**
   * Weekly fixed closing days, only when verified from the source. An empty
   * list means "no known fixed closing day", not "open every day".
   */
  closedWeekdays?: WeekdayCode[];
  dataOrigin?: PlaceDataOrigin;
  address?: string;
};

/**
 * v2 adjustment model (ported from mvp2): pin / add / remove / never-visit plus
 * pace signals. The legacy `action` field from the NYC UI is still accepted and
 * translated server-side.
 */
export type PlanAdjustment = {
  itineraryId: string;
  action?: "replace" | "shorten" | "budget";
  targetStopId?: string;
  /** Place IDs of the itinerary being adjusted, in case the server lost it. */
  previousPlaceIds?: string[];
  pinnedPlaceIds?: string[];
  addPlaceIds?: string[];
  removePlaceIds?: string[];
  neverVisitPlaceIds?: string[];
  laterStart?: boolean;
  earlierEnd?: boolean;
  fewerStops?: boolean;
  moreRest?: boolean;
};

export type PlanRequest = {
  cityCode: "nyc";
  date: string;
  duration: "half_day" | "full_day";
  durationHours?: number;
  partySize: number;
  totalBudgetUsd: number;
  interests: PlaceCategory[];
  intentText: string;
  transportPreference: TransportPreference;
  walkingPreference: "easy" | "balanced" | "active";
  dining: "no_preference" | "vegetarian" | "coffee" | "local";
  accessibility: boolean;
  adjustment?: PlanAdjustment;
};

export type ItineraryStop = {
  id: string;
  placeId: string;
  name: string;
  time: string;
  durationMinutes: number;
  expectedSpendUsd: number;
  /** True when the spend comes from a category estimate, not a reviewed allowance. */
  spendEstimated: boolean;
  reason: string;
  reasonSource: "ai" | "rules";
  sourceName: string;
  sourceUrl: string;
  dataOrigin: PlaceDataOrigin;
  /** Snapshot of the place, so live listings render without a catalog lookup. */
  place: NycPlace;
};

export type TransportSegment = {
  fromStopId: string;
  toStopId: string;
  recommendedMode: "walk" | "public_transit" | "taxi";
  estimatedMinutes: { min: number; max: number };
  estimatedCostUsd: { min: number; max: number } | null;
  uncertaintyNotice: string;
};

export type TimeWindow = {
  policyVersion: string;
  daypart: "morning" | "afternoon" | "evening" | "night" | "default";
  startTime: string;
  signals: string[];
};

export type AdjustmentPreservation = {
  pinnedPlaceIds: string[];
  keptPlaceIds: string[];
  removedPlaceIds: string[];
  addedPlaceIds: string[];
};

export type Itinerary = {
  id: string;
  status: "valid";
  title: string;
  overview: string;
  stops: ItineraryStop[];
  transportSegments: TransportSegment[];
  timeWindow: TimeWindow;
  estimatedWalkKm: number;
  estimatedTotalSpendUsd: { min: number; max: number; status: "estimated" };
  confidenceNote: string;
  warnings: string[];
  version: string;
  dataVersionId: "nyc-poi-v1";
  /** Street route line as [lng, lat] pairs; present when Geoapify routing succeeded. */
  routeGeometry?: { type: "LineString"; coordinates: [number, number][] };
  /** geoapify = every leg street-routed, partial = some legs, estimate = straight-line only. */
  routeSource?: "geoapify" | "partial" | "estimate";
  adjustmentPreservation?: AdjustmentPreservation;
};

export type PlanMode = "ai_structured" | "controlled_fallback" | "insufficient_information";

export type IntentParse = {
  originalText: string;
  detectedSignals: string[];
  confidence: "low" | "medium";
  note: string;
};

export type InsufficiencyKind =
  | "quantity"
  | "affordability"
  | "accessibility_block"
  | "vegetarian_block"
  | "city_block"
  | "evidence_hard_block";

export type PlannerResult =
  | { mode: "ai_structured" | "controlled_fallback"; itinerary: Itinerary; insufficiencyReason?: never; intentParse: IntentParse }
  | { mode: "insufficient_information"; itinerary: null; insufficiencyReason: string; intentParse: IntentParse };
