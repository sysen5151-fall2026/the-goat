import { PLACE_CATEGORIES, type PlaceCategory } from "@/lib/nyc-types";

/**
 * #tags in the trip request are the interest filter (the chips were removed).
 * The same parser runs in the input box (blue highlight + suggestions) and on
 * the server (/api/plan), so what the user sees highlighted is exactly what
 * the planner filters on. Unknown #words are ignored, not guessed.
 */
export const TAG_LABELS: Record<PlaceCategory, string> = {
  landmark: "landmarks", museum: "museums", park: "parks", waterfront: "waterfront", food: "food",
  views: "views", architecture: "architecture", history: "history", art: "art",
  science: "science", performance: "shows", family: "family",
};

/** Everyday spellings → canonical tag. Every canonical label is included. */
const TAG_ALIASES: Record<string, PlaceCategory> = {
  landmark: "landmark", landmarks: "landmark", sights: "landmark", sightseeing: "landmark", iconic: "landmark",
  museum: "museum", museums: "museum", exhibits: "museum",
  park: "park", parks: "park", garden: "park", gardens: "park", nature: "park", outdoors: "park",
  waterfront: "waterfront", water: "waterfront", beach: "waterfront", beaches: "waterfront", river: "waterfront", harbor: "waterfront",
  food: "food", foodie: "food", eat: "food", eats: "food", restaurants: "food", restaurant: "food", dining: "food",
  views: "views", view: "views", skyline: "views", rooftop: "views", sunset: "views",
  architecture: "architecture", buildings: "architecture", building: "architecture",
  history: "history", historic: "history", heritage: "history",
  art: "art", arts: "art", gallery: "art", galleries: "art", design: "art",
  science: "science", stem: "science", animals: "science", zoo: "science",
  shows: "performance", show: "performance", performance: "performance", music: "performance", theater: "performance", theatre: "performance", broadway: "performance", jazz: "performance",
  family: "family", kids: "family", kid: "family", children: "family",
};

const HASHTAG = /#([a-z][a-z-]{0,23})/gi;

export type HashtagToken = { text: string; tag: PlaceCategory | null; hashtag: boolean };

export function tagFor(word: string): PlaceCategory | null {
  return TAG_ALIASES[word.toLowerCase()] ?? null;
}

/** Canonical tags written as #words, in the order typed, de-duplicated. */
export function parseHashtags(text: string): PlaceCategory[] {
  const found: PlaceCategory[] = [];
  for (const match of text.matchAll(HASHTAG)) {
    const tag = tagFor(match[1]);
    if (tag && !found.includes(tag)) found.push(tag);
  }
  return found;
}

/** Splits text into plain runs and #tag runs for highlighting. */
export function tokenizeHashtags(text: string): HashtagToken[] {
  const tokens: HashtagToken[] = [];
  let last = 0;
  for (const match of text.matchAll(HASHTAG)) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ text: text.slice(last, index), tag: null, hashtag: false });
    tokens.push({ text: match[0], tag: tagFor(match[1]), hashtag: true });
    last = index + match[0].length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last), tag: null, hashtag: false });
  return tokens;
}

/** Tag suggestions for a partial "#wor" just before the caret. */
export function suggestTags(partial: string): PlaceCategory[] {
  const query = partial.toLowerCase();
  const byLabel = PLACE_CATEGORIES.filter((tag) => TAG_LABELS[tag].startsWith(query));
  const byAlias = Object.entries(TAG_ALIASES).filter(([alias]) => alias.startsWith(query)).map(([, tag]) => tag);
  return [...new Set([...byLabel, ...byAlias])];
}

export const DEFAULT_INTERESTS: PlaceCategory[] = ["landmark", "museum", "park"];

/**
 * Interests the planner filters on: #tags win; otherwise the saved/default
 * interests on the request; otherwise a balanced default.
 */
export function effectiveInterests(intentText: string, fallback: readonly PlaceCategory[] = []): PlaceCategory[] {
  const tags = parseHashtags(intentText);
  if (tags.length) return tags;
  return fallback.length ? [...fallback] : [...DEFAULT_INTERESTS];
}
