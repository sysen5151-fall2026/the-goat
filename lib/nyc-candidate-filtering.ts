import { isIndividuallyAffordable } from "@/lib/nyc-budget";
import { distanceKm } from "@/lib/nyc-geo";
import { parseHashtags } from "@/lib/nyc-hashtags";
import type { InsufficiencyKind, IntentParse, NycPlace, PlaceCategory, PlanRequest, WeekdayCode } from "@/lib/nyc-types";

/**
 * Deterministic pre-model shortlist, ported from mvp2 lib/candidate-filtering.ts.
 * Stages: hard eligibility → explicit refusal checks → relevance scoring →
 * spatial coherence → bounded shortlist (≤ 8). Every derived feature comes from
 * the request text plus the published record's name/tags/evidence/coordinates.
 */
export const CANDIDATE_FILTERING_VERSION = "candidate-filtering-v1" as const;
export const MAX_CANDIDATE_COUNT = 8;

type SpecificitySignal = { label: string; intentTerms: string[]; placeTerms: string[]; matchNameOnly?: boolean; remoteAnchor?: boolean };

// English equivalents of mvp2's Beijing theme signals (长城 / 园林 / 798 / 胡同 …).
const specificitySignals: SpecificitySignal[] = [
  { label: "Harbor & immigration history", intentTerms: ["statue of liberty", "lady liberty", "ellis island", "immigration"], placeTerms: ["liberty", "ellis", "immigration", "tenement"], remoteAnchor: true },
  { label: "Art", intentTerms: ["art", "painting", "gallery", "modern art", "impressionist", "sculpture"], placeTerms: ["art", "moma", "guggenheim", "metropolitan", "brooklyn museum", "whitney", "frick", "neue galerie", "cloisters", "noguchi", "sculpture", "ps1", "galerie", "design"] },
  { label: "Science & natural history", intentTerms: ["science", "dinosaur", "natural history", "space", "aircraft", "planetarium", "animals", "zoo", "aquarium"], placeTerms: ["natural history", "intrepid", "space", "zoo", "aquarium", "botanical"] },
  { label: "History & memorials", intentTerms: ["history", "historic", "memorial", "9/11", "revolution", "colonial"], placeTerms: ["memorial", "ellis", "history", "historical", "liberty", "tenement", "federal hall", "fraunces", "castle clinton", "grant", "hamilton", "stonewall", "trinity"] },
  { label: "Skyline views", intentTerms: ["skyline", "view", "views", "observation", "observatory", "rooftop", "lookout"], placeTerms: ["observatory", "observation", "empire state", "edge", "one world", "rockefeller", "brooklyn bridge", "summit", "gantry", "domino", "tramway", "brooklyn bridge park", "photo spot", "promenade", "rooftop", "lookout", "viewpoint", "tudor city"] },
  { label: "Bridges & waterfront", intentTerms: ["bridge", "waterfront", "by the water", "river", "harbor", "ferry", "pier", "beach", "boardwalk"], placeTerms: ["bridge", "harbor", "intrepid", "liberty", "ellis", "ferry", "pier", "island", "seaport", "battery", "boardwalk", "beach", "riis", "hudson river", "river park", "gantry", "domino"] },
  { label: "Green space", intentTerms: ["green space", "garden", "gardens", "picnic", "nature", "trees", "stroll"], placeTerms: ["park", "high line", "garden", "botanic", "botanical", "wave hill", "green-wood", "governors island", "little island"] },
  { label: "Food markets", intentTerms: ["food hall", "market", "street food", "foodie"], placeTerms: ["market", "smorgasburg", "arthur avenue", "zabar"] },
  { label: "Classic NYC eats", intentTerms: ["pizza", "bagel", "bagels", "deli", "pastrami", "cheesecake", "hot dog", "steak", "steakhouse", "oysters", "soul food"], placeTerms: ["pizza", "russ", "katz", "deli", "junior", "nathan", "luger", "keens", "steak", "oyster", "sylvia", "veselka", "ferrara", "halal"] },
  { label: "Classic architecture", intentTerms: ["architecture", "beaux-arts", "art deco", "library", "train station", "landmark building", "cathedral", "church"], placeTerms: ["library", "grand central", "empire state", "rockefeller", "chrysler", "cathedral", "church", "carnegie", "radio city", "federal hall", "one vanderbilt"] },
  { label: "Music & performance", intentTerms: ["music", "jazz", "concert", "theater", "theatre", "broadway", "show", "opera", "ballet"], placeTerms: ["apollo", "carnegie", "lincoln center", "radio city", "armstrong", "times square"] },
  { label: "Night views", intentTerms: ["night view", "night views", "city lights", "at night", "sunset"], placeTerms: ["empire state", "edge", "one world", "times square", "brooklyn bridge", "rockefeller", "summit", "gantry", "domino"], matchNameOnly: true },
  { label: "Museums", intentTerms: ["museum", "museums", "exhibit", "exhibition"], placeTerms: ["museum", "moma", "collection", "galerie", "ps1"] },
];

/** Everyday words that point at a catalog category even when that interest chip isn't selected. */
const CATEGORY_KEYWORDS: Record<PlaceCategory, string[]> = {
  landmark: ["landmark", "landmarks", "iconic", "famous", "monument", "sightseeing", "sights", "touristy"],
  museum: ["museum", "museums", "exhibit", "exhibits", "exhibition", "exhibitions", "indoor", "indoors", "rainy"],
  park: ["park", "parks", "garden", "gardens", "green", "nature", "outdoor", "outdoors", "picnic", "stroll", "hike", "hiking", "trees"],
  waterfront: ["water", "waterfront", "river", "harbor", "beach", "beaches", "ferry", "pier", "boardwalk", "island", "seaside"],
  food: ["food", "eat", "eating", "lunch", "dinner", "brunch", "breakfast", "pizza", "bagel", "bagels", "deli", "market", "snack", "dessert", "steak", "foodie", "restaurant", "restaurants", "dumplings", "tacos"],
  views: ["view", "views", "skyline", "observatory", "observation", "rooftop", "lookout", "panorama", "sunset", "viewpoint"],
  architecture: ["architecture", "architectural", "building", "buildings", "skyscraper", "skyscrapers", "cathedral", "church", "synagogue", "deco"],
  history: ["history", "historic", "historical", "heritage", "memorial", "colonial", "revolutionary", "immigration", "founding"],
  art: ["art", "arts", "artist", "gallery", "galleries", "painting", "paintings", "sculpture", "photography", "design"],
  science: ["science", "scientific", "dinosaur", "dinosaurs", "space", "planetarium", "math", "technology", "animals", "zoo", "aquarium"],
  performance: ["music", "jazz", "concert", "concerts", "theater", "theatre", "broadway", "show", "shows", "opera", "ballet", "gospel"],
  family: ["kids", "kid", "children", "child", "family", "toddler", "toddlers", "stroller", "playground"],
};

/** Words too common to count as a place or neighborhood hit ("near", "walk", "york" …). */
const STOPWORDS = new Set([
  "about", "also", "around", "classic", "city", "day", "family", "friends", "from", "good", "great", "have", "into", "just", "kids",
  "like", "long", "love", "maybe", "more", "morning", "afternoon", "evening", "museum", "museums", "near", "nice", "night", "park",
  "parks", "place", "places", "plus", "relaxed", "short", "some", "that", "then", "there", "this", "time", "tour", "tours", "trip",
  "view", "views", "visit", "walk", "walking", "want", "what", "when", "where", "which", "with", "would", "york", "center", "garden",
  "gardens", "food", "market", "first", "only", "need", "best", "really", "lots", "people", "spend", "stop", "stops",
  "history", "historic", "historical", "music", "design", "science", "modern", "national", "natural", "american", "street", "square",
  "east", "west", "north", "south", "upper", "lower", "side", "kids", "shows", "tonight", "today", "tomorrow",
]);

function intentTokens(text: string) {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function intentCategories(tokens: string[]) {
  return new Set((Object.entries(CATEGORY_KEYWORDS) as Array<[PlaceCategory, string[]]>).filter(([, keywords]) => tokens.some((token) => keywords.includes(token))).map(([category]) => category));
}

/** Full neighborhood names written in the request, e.g. "lower east side", "harlem", "long island city". */
function neighborhoodHits(place: NycPlace, text: string) {
  return place.neighborhood.toLowerCase().split(/\s*(?:\/|,|–|—|\(|\))\s*/)
    .map((part) => part.trim()).filter((part) => part.length >= 4)
    .filter((part) => new RegExp(`(^|[^a-z0-9])${escapeRegex(part)}($|[^a-z0-9])`).test(text));
}

/** Request words (≥4 letters, not stopwords) that appear in a place's name or neighborhood, e.g. "harlem", "williamsburg". */
function placeTermHits(place: NycPlace, terms: string[]) {
  const haystack = `${place.name} ${place.neighborhood}`.toLowerCase();
  return terms.filter((term) => haystack.includes(term) || (term.length > 4 && term.endsWith("s") && haystack.includes(term.slice(0, -1))));
}

/** `signals` are the request themes this place covers ("term:harlem", "cat:food", "theme:Art"), used to reward routes that cover more of what was asked. */
export type CandidateRankingReason = { placeId: string; score: number; reasons: string[]; signals?: string[] };

export type CandidateFilteringTrace = {
  version: typeof CANDIDATE_FILTERING_VERSION;
  initialCount: number;
  eligibleCount: number;
  closedTodayExcludedCount: number;
  semanticCount: number;
  spatialCount: number;
  shortlistedCount: number;
  selectedCandidateIds: string[];
  rankingReasons: CandidateRankingReason[];
  exclusionSummary: string[];
  spatialStrategy: string;
  usedRealtimeFallback: boolean;
  realtimeQuery: string[];
  realtimeCandidateCount: number;
  realtimeCandidatesAccepted: number;
  realtimeFetchErrors: string[];
};

export type CandidateFilteringResult = {
  candidates: NycPlace[];
  intentParse: IntentParse;
  trace: CandidateFilteringTrace;
  insufficiencyReason?: string;
  insufficiencyKind?: InsufficiencyKind;
};

type ScoredCandidate = { place: NycPlace; score: number; reasons: string[]; specificMatches: string[]; namedMention: boolean; signals: string[] };

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const GENERIC_AREA_WORDS = new Set(["brooklyn", "queens", "bronx", "manhattan", "harlem", "staten island", "new york", "jewish", "battery"]);

/** Names a person would actually type for this place. */
function placeAliases(place: NycPlace) {
  const name = place.name.toLowerCase();
  const stripped = name
    .replace(/^the /, "")
    .replace(/ (national monument|national museum of immigration|memorial & museum|observation deck|building|terminal|center|museum)$/, "");
  // "Brooklyn Museum" → "brooklyn" or "Queens Museum" → "queens" would make every borough mention a named place.
  const strippedAlias = GENERIC_AREA_WORDS.has(stripped) ? name : stripped;
  return [...new Set([name, strippedAlias, ...(place.aliases ?? []).map((alias) => alias.toLowerCase())])].filter((alias) => alias.length >= 4);
}

/** Word-boundary alias match, so "met" never fires inside "metropolitan" or "metro". */
export function placeMentionedInText(place: NycPlace, text: string) {
  if (!text) return false;
  return placeAliases(place).some((alias) => new RegExp(`(^|[^a-z0-9])${escapeRegex(alias)}($|[^a-z0-9])`).test(text));
}

function mentionedPlaces(places: NycPlace[], text: string) {
  return places.filter((place) => placeMentionedInText(place, text));
}

const WEEKDAY_BY_UTC_INDEX: WeekdayCode[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function weekdayFromDate(date: string): WeekdayCode | null {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(parsed.getTime()) ? null : WEEKDAY_BY_UTC_INDEX[parsed.getUTCDay()];
}

/** Only verified fixed closing days exclude a place; an empty list never does. */
export function isClosedOnRequestDate(place: NycPlace, date: string) {
  if (!place.closedWeekdays?.length) return false;
  const weekday = weekdayFromDate(date);
  return weekday ? place.closedWeekdays.includes(weekday) : false;
}

export function hasCompleteEvidence(place: NycPlace) {
  return Boolean(place.sourceName && place.sourceUrl && place.reviewedOn && place.accessNote);
}

export function isPublishedPlaceAvailableForRequest(place: NycPlace, request: PlanRequest) {
  return (place.published || place.dataOrigin === "realtime_geoapify") && hasCompleteEvidence(place) && isIndividuallyAffordable(place, request) && !isClosedOnRequestDate(place, request.date);
}

function largestDistanceKm(places: NycPlace[]) {
  return places.reduce((largest, place, index) => Math.max(largest, ...places.slice(index + 1).map((other) => distanceKm(place, other))), 0);
}

function requiredNamedPlaceReason(request: PlanRequest, places: NycPlace[], text: string) {
  const requiresAll = /\b(both|all of|as well as|and also)\b/.test(text);
  if (!requiresAll) return undefined;
  const mentioned = mentionedPlaces(places, text);
  if (mentioned.length < 2) return undefined;
  const closed = mentioned.filter((place) => isClosedOnRequestDate(place, request.date));
  if (closed.length) return `${closed.map((place) => place.name).join(", ")} ${closed.length > 1 ? "are" : "is"} closed on the selected date. Pick another date and Wayly will plan the full set instead of quietly substituting.`;
  const isShort = request.duration === "half_day" || (request.durationHours !== undefined && request.durationHours <= 6);
  if (isShort && mentioned.length >= 3 && largestDistanceKm(mentioned) > 25) return "The places you named are too far apart for a half day. Keep one or two priorities, or switch to a full day.";
  return undefined;
}

function regionalMismatchReason(text: string) {
  if (/\b(surf|surfing|ski|skiing|snowboard|grand canyon|niagara falls|disney ?world|disneyland)\b/.test(text))
    return "That activity isn't part of New York City or the reviewed NYC catalog. Tell me something NYC can offer and I'll plan it carefully.";
  return undefined;
}

function requestedUnavailablePlaceReason(text: string, places: NycPlace[]) {
  const match = text.match(/\b(?:must|have to|need to|definitely|make sure to)\s+(?:include|add|visit|see|go to|stop at)\s+(?:the\s+)?([a-z0-9'’ .&-]{3,48}?)(?=[,.;!?]|$|\s+(?:and|then|before|after|in)\b)/);
  if (!match) return undefined;
  const phrase = match[1].trim();
  const hasPlaceCue = /\b(museum|park|bridge|building|tower|market|center|centre|square|library|station|gallery|zoo|garden|island|observatory|deck|memorial|cathedral|church|pier)\b/.test(phrase);
  if (!hasPlaceCue || places.some((place) => placeMentionedInText(place, phrase))) return undefined;
  return "The place you asked to include isn't in the published NYC catalog, so Wayly won't pass off an unreviewed substitute as meeting that request.";
}

function ungroundedRequirementReason(text: string) {
  if (/\b(ignore|skip|without|don'?t need|no need for)\b.{0,20}\b(sources?|reviews?|verification|verified|vetting)\b/.test(text))
    return "You asked to skip source review, but every Wayly route must use published places with complete sources.";
  return undefined;
}

function contradictoryExplicitPlaceReason(request: PlanRequest, places: NycPlace[], text: string) {
  if (!/\b(both\b.{0,40}\band|as well as|all of them)\b/.test(text)) return undefined;
  const mentioned = mentionedPlaces(places, text);
  if (mentioned.length < 2) return undefined;
  const shortOrLowMobility = /\b([1-4]\s*hours?|half a day|half-day|one hour|two hours)\b/.test(text) || request.walkingPreference === "easy";
  const excludesTransport = /\b(no subway|no taxi|no transit|walk only|walking only|only walk|don'?t want to walk)\b/.test(text);
  if (shortOrLowMobility && excludesTransport && largestDistanceKm(mentioned) > 12)
    return "The places you named are too far apart for this time, walking and transport limit. Keep one area or allow transit.";
  return undefined;
}

/** Rule-based intent parsing: only places the user actually named, never guessed categories. */
export function parseIntent(intentText: string, allPlaces: NycPlace[]): IntentParse {
  const text = intentText.trim().toLowerCase();
  const detectedSignals = text ? mentionedPlaces(allPlaces, text).map((place) => place.name) : [];
  return {
    originalText: intentText,
    detectedSignals,
    confidence: detectedSignals.length ? "medium" : "low",
    note: detectedSignals.length
      ? `Detected places you named: ${detectedSignals.join(", ")}.`
      : "No specific place was named, so Wayly planned from your interests and constraints.",
  };
}

function coherenceRadiusKm(request: PlanRequest) {
  if (request.walkingPreference === "easy") return request.transportPreference === "taxi" ? 5 : 4.5;
  if (request.durationHours ? request.durationHours <= 7 : request.duration === "half_day") return 6;
  return request.transportPreference === "taxi" ? 12 : 10;
}

type RankedCandidate = ScoredCandidate & { centralityKm?: number };

/**
 * Ties break toward the most central candidate (lowest average distance to the
 * other relevant candidates), so the spatial anchor sits where most options are
 * — NYC's counterpart of mvp2's priority-batch tie-break — then lower allowance.
 */
function compareCandidates(a: RankedCandidate, b: RankedCandidate) {
  return b.score - a.score || (a.centralityKm ?? 0) - (b.centralityKm ?? 0) || a.place.planningAllowanceUsd - b.place.planningAllowanceUsd || a.place.name.localeCompare(b.place.name);
}

function withCentrality<T extends ScoredCandidate>(items: T[]): Array<T & { centralityKm: number }> {
  return items.map((item) => ({
    ...item,
    centralityKm: items.length > 1 ? items.reduce((sum, other) => sum + distanceKm(item.place, other.place), 0) / (items.length - 1) : 0,
  }));
}

function emptyTrace(initialCount: number) {
  return { version: CANDIDATE_FILTERING_VERSION as typeof CANDIDATE_FILTERING_VERSION, initialCount, usedRealtimeFallback: false, realtimeQuery: [] as string[], realtimeCandidateCount: 0, realtimeCandidatesAccepted: 0, realtimeFetchErrors: [] as string[] };
}

export function filterAndRankCandidates(request: PlanRequest, allPlaces: NycPlace[], scoredPlaceIds?: ReadonlySet<string>): CandidateFilteringResult {
  const intentParse = parseIntent(request.intentText, allPlaces);
  const initialCount = allPlaces.length;

  // Hard gates: published, complete evidence, individually affordable for the party.
  const resourceEligible = allPlaces.filter((place) => place.published && hasCompleteEvidence(place) && isIndividuallyAffordable(place, request));
  const eligible = resourceEligible.filter((place) => !isClosedOnRequestDate(place, request.date));
  const closedTodayExcludedCount = resourceEligible.length - eligible.length;

  const text = request.intentText.toLowerCase();
  // Typed #tags filter the pool: a place must carry one of them. Places the user
  // named, and food when a dining preference is set, always stay eligible.
  const hashtagFilter = parseHashtags(request.intentText);
  const keepsFood = request.dining !== "no_preference";
  const tagEligible = hashtagFilter.length
    ? eligible.filter((place) => place.interests.some((tag) => hashtagFilter.includes(tag)) || (keepsFood && place.interests.includes("food")) || placeMentionedInText(place, text))
    : eligible;
  const unavailablePlaceReason = requestedUnavailablePlaceReason(text, allPlaces);
  const ungroundedReason = ungroundedRequirementReason(text);
  const namedPlaceReason = requiredNamedPlaceReason(request, allPlaces, text);
  const regionalReason = regionalMismatchReason(text);
  const contradictoryPlaceReason = contradictoryExplicitPlaceReason(request, allPlaces, text);
  const activeSpecificSignals = specificitySignals.filter((signal) => signal.intentTerms.some((term) => new RegExp(`\\b${escapeRegex(term)}\\b`).test(text)));
  const priceSensitive = /\b(cheap|free|low[- ]cost|low budget|on a budget|tight budget|save money|inexpensive|affordable)\b/.test(text);
  const localFood = request.dining === "local";
  const tokens = intentTokens(text);
  const wantedCategories = intentCategories(tokens);
  // Names of places the user named ("Brooklyn Bridge") are not area or keyword requests ("brooklyn", "bridge").
  const areaText = allPlaces.filter((place) => placeMentionedInText(place, text))
    .flatMap((place) => placeAliases(place)).sort((a, b) => b.length - a.length)
    .reduce((current, alias) => current.replace(new RegExp(`(^|[^a-z0-9])${escapeRegex(alias)}($|[^a-z0-9])`, "g"), "$1 $2"), text);
  const terms = [...new Set(intentTokens(areaText).filter((token) => token.length >= 4 && !STOPWORDS.has(token)))];

  const scoredRaw = tagEligible
    .filter((place) => !scoredPlaceIds || scoredPlaceIds.has(place.id))
    .map((place): ScoredCandidate => {
      const reasons: string[] = [];
      let score = 0;
      const matchedInterests = place.interests.filter((interest) => (request.interests as string[]).includes(interest));
      if (matchedInterests.length) {
        score += 50 + (matchedInterests.length - 1) * 10;
        reasons.push(`Matches your ${matchedInterests.join(" & ")} interest`);
      }
      // A named place must outrank everything else, so it reliably reaches the shortlist.
      const namedMention = placeMentionedInText(place, text);
      if (namedMention) {
        score += 200;
        reasons.push("You named this place");
      }
      const placeText = `${place.name} ${place.accessNote} ${(place.keywordTags ?? []).join(" ")} ${(place.aliases ?? []).join(" ")}`.toLowerCase();
      const specificMatches = activeSpecificSignals
        .filter((signal) => signal.placeTerms.some((term) => (signal.matchNameOnly ? place.name.toLowerCase() : placeText).includes(term)))
        .map((signal) => signal.label);
      if (specificMatches.length) {
        score += specificMatches.length * 60;
        reasons.push(`Matches theme: ${specificMatches.join(", ")}`);
      }
      const textCategories = place.interests.filter((interest) => wantedCategories.has(interest as PlaceCategory) && !matchedInterests.includes(interest));
      if (textCategories.length) {
        score += 30 * Math.min(2, textCategories.length);
        reasons.push(`Fits the ${textCategories.slice(0, 2).join(" & ")} you described`);
      }
      const areaHits = namedMention ? [] : neighborhoodHits(place, areaText);
      if (areaHits.length) {
        score += 90;
        reasons.push(`In ${areaHits[0]}, as requested`);
      }
      const termHits = namedMention ? [] : placeTermHits(place, terms).filter((term) => !areaHits.some((area) => area.includes(term)));
      if (termHits.length) {
        // A neighborhood or place word the user typed ("harlem", "williamsburg") outweighs a ticked interest chip.
        score += 70 * Math.min(2, termHits.length);
        reasons.push(`Matches "${termHits.slice(0, 2).join('", "')}" from your request`);
      }
      if (priceSensitive) {
        score += Math.max(0, 30 - Math.min(30, place.planningAllowanceUsd));
        reasons.push("Lower planning allowance preferred");
      }
      if (localFood && place.interests.includes("food")) {
        score += 20;
        reasons.push("Local food preference");
      }
      const signals = [...areaHits.map((area) => `term:${area}`), ...termHits.map((term) => `term:${term}`), ...textCategories.map((category) => `cat:${category}`), ...specificMatches.map((label) => `theme:${label}`)];
      return { place, score, reasons, specificMatches, namedMention, signals };
    })
    .filter((item) => item.score > 0);
  const scored = withCentrality(scoredRaw).sort(compareCandidates);

  const explicitBlockReason = ungroundedReason ?? namedPlaceReason ?? regionalReason ?? unavailablePlaceReason ?? contradictoryPlaceReason;

  if (!scored.length) {
    const allClosedToday = resourceEligible.length > 0 && eligible.length === 0;
    return {
      candidates: [],
      intentParse,
      trace: {
        ...emptyTrace(initialCount),
        eligibleCount: eligible.length,
        closedTodayExcludedCount,
        semanticCount: 0,
        spatialCount: 0,
        shortlistedCount: 0,
        selectedCandidateIds: [],
        rankingReasons: [],
        exclusionSummary: [
          `Hard eligibility excluded ${initialCount - resourceEligible.length} places`,
          ...(closedTodayExcludedCount ? [`Fixed closing day excluded ${closedTodayExcludedCount} places`] : []),
          "No remaining place matched your interests or named places.",
        ],
        spatialStrategy: "No candidates available.",
      },
      insufficiencyReason: explicitBlockReason ?? (allClosedToday
        ? "Every place that fits your budget and interests is closed on the selected date. Try another date or relax one constraint."
        : "No published place fits the party budget and your interests together. Raise the total budget or relax one constraint."),
      insufficiencyKind: explicitBlockReason ? "evidence_hard_block" : resourceEligible.length === 0 ? "affordability" : "quantity",
    };
  }

  // Spatial coherence around the top theme anchor (named places are always kept).
  const hasSpecificTheme = activeSpecificSignals.length > 0;
  const themed = scored.filter((item) => item.specificMatches.length > 0 || item.namedMention || (item.signals ?? []).some((signal) => signal.startsWith("term:")));
  const semanticPool = hasSpecificTheme && themed.length ? themed : scored;
  const remoteAnchor = activeSpecificSignals.some((signal) => signal.remoteAnchor);
  const namedAnchors = semanticPool.filter((item) => item.namedMention);
  const anchors = remoteAnchor
    ? semanticPool
    : namedAnchors.length > 1
      ? namedAnchors
      : activeSpecificSignals.length > 1
        ? semanticPool.filter((item) => item.specificMatches.length > 0)
        : semanticPool.slice(0, 1);
  const radiusKm = coherenceRadiusKm(request);
  const spatialPool = remoteAnchor
    ? semanticPool
    : semanticPool.filter((item) =>
        (activeSpecificSignals.length > 1 && item.specificMatches.length > 0) ||
        item.namedMention ||
        anchors.some((anchor) => distanceKm(anchor.place, item.place) <= radiusKm));
  const rankedSpatialPool = spatialPool
    .map((item) => {
      const nearby = anchors.some((anchor) => anchor.place.id !== item.place.id && distanceKm(anchor.place, item.place) <= radiusKm);
      return nearby ? { ...item, score: item.score + 15, reasons: [...item.reasons, "Close to the route's main anchor"] } : item;
    })
    .sort(compareCandidates);

  // Keep one relevant candidate per explicit interest where one exists, then fill by score.
  const interestCoverage = request.interests.flatMap((category) => {
    const candidate = rankedSpatialPool.find((item) => item.place.interests.includes(category));
    return candidate ? [candidate] : [];
  });
  const coverageUnique = interestCoverage.filter((item, index) => interestCoverage.findIndex((other) => other.place.id === item.place.id) === index);
  const shortlisted = [
    ...rankedSpatialPool.filter((item) => item.namedMention),
    ...coverageUnique.filter((item) => !item.namedMention),
    ...rankedSpatialPool.filter((item) => !item.namedMention && !coverageUnique.some((covered) => covered.place.id === item.place.id)),
  ].slice(0, MAX_CANDIDATE_COUNT);
  const candidates = shortlisted.map((item) => item.place);

  return {
    candidates,
    intentParse,
    trace: {
      ...emptyTrace(initialCount),
      eligibleCount: eligible.length,
      closedTodayExcludedCount,
      semanticCount: semanticPool.length,
      spatialCount: spatialPool.length,
      shortlistedCount: candidates.length,
      selectedCandidateIds: candidates.map((place) => place.id),
      rankingReasons: shortlisted.map((item) => ({ placeId: item.place.id, score: item.score, reasons: item.reasons, signals: item.signals })),
      exclusionSummary: [
        `Hard eligibility excluded ${initialCount - resourceEligible.length} places`,
        ...(closedTodayExcludedCount ? [`Fixed closing day excluded ${closedTodayExcludedCount} places`] : []),
        ...(hashtagFilter.length ? [`#tag filter (${hashtagFilter.map((tag) => `#${tag}`).join(" ")}) excluded ${eligible.length - tagEligible.length} places`] : []),
        `Relevance stage excluded ${Math.max(0, eligible.length - semanticPool.length)} places`,
        `Spatial coherence excluded ${Math.max(0, semanticPool.length - spatialPool.length)} places`,
        ...(spatialPool.length > MAX_CANDIDATE_COUNT ? [`Shortlist cap of ${MAX_CANDIDATE_COUNT} excluded ${spatialPool.length - MAX_CANDIDATE_COUNT} lower-ranked places`] : []),
      ],
      spatialStrategy: remoteAnchor
        ? "Remote harbor anchor: keep only candidates for the same explicit theme."
        : `Keep relevant candidates within ${radiusKm} km of the top anchor; named places are always kept.`,
    },
    ...(explicitBlockReason ? { insufficiencyReason: explicitBlockReason, insufficiencyKind: "evidence_hard_block" as const } : {}),
  };
}
