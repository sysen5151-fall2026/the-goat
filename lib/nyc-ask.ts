import { z } from "zod";
import { parseHashtags, tagFor, TAG_LABELS } from "@/lib/nyc-hashtags";
import { placeById } from "@/lib/nyc-places";
import { suggestReplacements } from "@/lib/nyc-replacements";
import { PLACE_CATEGORIES, type Itinerary, type NycPlace, type PlaceCategory, type PlanRequest } from "@/lib/nyc-types";

/**
 * Ask Wayly: a chat turn about the current route. Same split as the planner —
 * code builds the allowed options (stops, catalog replacements), the model may
 * only pick among them, and code validates the result. Every action is shown to
 * the user as a proposal and runs through /api/plan only when they tap Apply.
 * Without a model (no key / daily cap / failure) the rule parser answers.
 */
export const ASK_PROMPT_VERSION = "nyc-ask-v1" as const;

export type AskStop = { id: string; placeId: string; name: string };
export type AskAction =
  | { type: "none" }
  | { type: "replan"; intentText: string }
  | { type: "replace"; targetStopId: string; placeId: string; placeName: string }
  | { type: "shorten" }
  | { type: "budget"; totalBudgetUsd: number };
export type AskResult = { reply: string; action: AskAction; source: "model" | "rules" };

export const askHistorySchema = z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(600) })).max(8);
export const askStopsSchema = z.array(z.object({ id: z.string().min(1).max(80), placeId: z.string().min(1).max(80), name: z.string().min(1).max(120) })).max(10);

const ORDINALS: Record<string, number> = { first: 0, "1st": 0, second: 1, "2nd": 1, third: 2, "3rd": 2, fourth: 3, "4th": 3, fifth: 4, "5th": 4 };

/** Tags a message asks for: #tags first, then plain words that map to a tag ("food", "kids"). */
export function wantedTags(message: string): PlaceCategory[] {
  const tags = parseHashtags(message);
  for (const word of message.toLowerCase().split(/[^a-z]+/)) {
    const tag = word.length >= 3 ? tagFor(word) : null;
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/** Which stop the message points at: "stop 2", "the second one", "the last stop", or a stop's name. */
export function targetStop(message: string, stops: AskStop[]): AskStop | null {
  const text = message.toLowerCase();
  const numbered = /\bstop\s*#?\s*(\d)\b/.exec(text) ?? /#(\d)\b/.exec(text);
  if (numbered) return stops[Number(numbered[1]) - 1] ?? null;
  for (const [word, index] of Object.entries(ORDINALS)) if (new RegExp(`\\b${word}\\b`).test(text)) return stops[index] ?? null;
  if (/\blast\b/.test(text)) return stops[stops.length - 1] ?? null;
  const byName = stops.find((stop) => {
    const name = stop.name.toLowerCase();
    const core = name.replace(/^the\s+/, "").split(/[(–,-]/)[0].trim();
    return text.includes(name) || (core.length >= 4 && text.includes(core));
  });
  if (byName) return byName;
  for (const word of new Set(text.split(/[^a-z']+/).filter((item) => item.length >= 4 && !STOP_WORDS.has(item)))) {
    const stem = word.replace(/'s$/, "").slice(0, Math.max(4, word.length - 1)); // "pizza" → "pizz" matches "Pizzeria"
    const matches = stops.filter((stop) => new RegExp(`\\b${stem}`).test(stop.name.toLowerCase()));
    if (matches.length === 1) return matches[0];
  }
  return null;
}

const STOP_WORDS = new Set(["swap", "replace", "change", "skip", "instead", "switch", "want", "really", "don't", "dont", "something", "somewhere", "with", "that", "this", "there", "please", "could", "would", "stop", "place", "get", "more", "less", "make", "into", "from", "about", "like", "have", "want", "it's"]);

function asItinerary(stops: AskStop[]): Itinerary {
  return { stops: stops.map((stop) => ({ ...stop, place: placeById[stop.placeId] })) } as unknown as Itinerary;
}

/** Catalog replacements for one stop, preferring the tags asked for. Code-owned candidate set. */
export function replacementOptions(stops: AskStop[], stopId: string, request: PlanRequest, tags: PlaceCategory[], limit = 4): NycPlace[] {
  const pool = suggestReplacements(asItinerary(stops), stopId, { ...request, interests: tags.length ? tags : request.interests }, 12);
  const tagged = tags.length ? pool.filter((place) => place.interests.some((tag) => tags.includes(tag))) : pool;
  // A place whose primary type is the asked-for tag ("#food" → a restaurant) beats one that only carries it as a side tag.
  const ranked = tags.length ? [...tagged].sort((a, b) => Number(!tags.includes(a.interests[0])) - Number(!tags.includes(b.interests[0]))) : tagged;
  return (ranked.length ? ranked : pool).slice(0, limit);
}

const label = (tags: PlaceCategory[]) => tags.map((tag) => `#${TAG_LABELS[tag]}`).join(" ");

/** Deterministic answer used without a model, and as the model's safety net. */
export function rulesAsk(message: string, request: PlanRequest, stops: AskStop[]): AskResult {
  const text = message.toLowerCase();
  const hasRoute = stops.length > 0;
  const target = hasRoute ? targetStop(message, stops) : null;
  // Words that point at the stop being replaced ("the park", "the pizza place") are not what the user wants instead.
  const targetName = target?.name.toLowerCase() ?? "";
  const tags = wantedTags(message.replace(/(^|[^#a-z])([a-z']+)/gi, (all, lead: string, word: string) => (target && word.length >= 4 && new RegExp(`\\b${word.toLowerCase().replace(/'s$/, "").slice(0, Math.max(4, word.length - 1))}`).test(targetName) ? lead : all)));
  const wantsSwap = /\b(swap|replace|change|skip|instead|switch|don't want|dont want|not interested|remove)\b/.test(text);
  const result = (reply: string, action: AskAction): AskResult => ({ reply, action, source: "rules" });

  if (hasRoute) {
    const amount = /\$\s?(\d{1,5})|\b(\d{2,5})\s?(?:dollars|usd|bucks)\b|\bbudget\D{0,12}(\d{2,5})\b|\bunder\s\$?(\d{2,5})\b/.exec(text);
    if (amount || /\b(cheaper|less money|lower (?:the )?budget|too expensive|save money)\b/.test(text)) {
      const value = amount ? Number(amount.slice(1).find(Boolean)) : Math.max(0, Math.round((request.totalBudgetUsd * 0.7) / 10) * 10);
      const totalBudgetUsd = Math.min(10_000, Math.max(0, value));
      return result(`I can re-plan this day for a total budget of $${totalBudgetUsd}, keeping stops that still fit.`, { type: "budget", totalBudgetUsd });
    }
    if (/\b(shorter|shorten|less time|fewer stops|end earlier|finish earlier|leave early|too long|tired)\b/.test(text))
      return result("I can shorten the day by about two hours and drop the stops that no longer fit.", { type: "shorten" });
    if (!target && wantsSwap && !/\b(new|another|different) (route|plan|day)\b/.test(text))
      return result(`Which stop should I change? ${stops.map((stop, index) => `${index + 1}. ${stop.name}`).join(" · ")} — e.g. “swap stop 2 for #food”.`, { type: "none" });
    if (target && wantsSwap) {
      const [option] = replacementOptions(stops, target.id, request, tags, 1);
      if (option) return result(`How about ${option.name} instead of ${target.name}?${tags.length ? ` It matches ${label(tags)}.` : ""}`, { type: "replace", targetStopId: target.id, placeId: option.id, placeName: option.name });
      return result(`I couldn't find a published place that fits the budget to replace ${target.name}. Try a different stop or raise the budget.`, { type: "none" });
    }
  }
  if (tags.length || /\b(plan|go|visit|see|want|take me|looking for|day|trip|eat|tonight|today|tomorrow)\b/.test(text)) {
    const intentText = message.trim().slice(0, 300);
    return result(hasRoute ? `I can build a new route from that${tags.length ? ` (${label(tags)})` : ""}. Your current route will be replaced.` : `I can plan a route from that${tags.length ? ` (${label(tags)})` : ""}.`, { type: "replan", intentText });
  }
  return result(hasRoute
    ? "I can swap a stop, shorten the day, change the budget, or plan a new route. Try “swap stop 2 for #food” or “make it cheaper”."
    : "Tell me what you'd like to do today — for example “art and dumplings in the Lower East Side” — and I'll plan it.", { type: "none" });
}

const modelOutputSchema = z.object({
  reply: z.string().min(1).max(500),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("none") }),
    z.object({ type: z.literal("replan"), intentText: z.string().min(1).max(300) }),
    z.object({ type: z.literal("replace"), targetStopId: z.string(), placeId: z.string() }),
    z.object({ type: z.literal("shorten") }),
    z.object({ type: z.literal("budget"), totalBudgetUsd: z.number().int().min(0).max(10_000) }),
  ]),
});

export function buildAskPrompt(request: PlanRequest, stops: AskStop[], options: Record<string, NycPlace[]>) {
  const route = stops.length
    ? stops.map((stop, index) => { const place = placeById[stop.placeId]; return `${index + 1}. id=${stop.id} "${stop.name}"${place ? ` tags=${place.interests.join(",")} spend≈$${place.planningAllowanceUsd}/person` : " (live listing)"}`; }).join("\n")
    : "(no route yet)";
  const replacements = Object.entries(options).map(([stopId, places]) => `for ${stopId}: ${places.map((place) => `${place.id} "${place.name}" [${place.interests.join(",")}]`).join("; ") || "none"}`).join("\n");
  return `You are Wayly, a concise NYC day-trip assistant inside an app. Reply in the user's language, at most 2 short sentences.
Return ONLY a JSON object: {"reply": string, "action": {...}} where action is one of:
{"type":"none"} | {"type":"replan","intentText":string ≤300, may use #tags} | {"type":"replace","targetStopId":<a stop id below>,"placeId":<an id from that stop's replacement list>} | {"type":"shorten"} | {"type":"budget","totalBudgetUsd":integer}.
Rules: never invent places, opening hours, prices, tickets or availability — say they should check the stop's source link. Use only ids listed below. Prefer the smallest change. Tags: ${PLACE_CATEGORIES.map((tag) => `#${TAG_LABELS[tag]}`).join(" ")}.
Trip: ${request.date}, ${request.durationHours ?? (request.duration === "full_day" ? 10 : 6)} hours, ${request.partySize} people, total budget $${request.totalBudgetUsd}.
Current route:
${route}
Replacement options (code-checked: affordable, not already in the route):
${replacements || "(none)"}`;
}

/** Validates a model answer against the code-owned options. Returns null if anything is off. */
export function validateModelAnswer(raw: string, stops: AskStop[], options: Record<string, NycPlace[]>): AskResult | null {
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return null; }
  const parsed = modelOutputSchema.safeParse(json);
  if (!parsed.success) return null;
  const { reply, action } = parsed.data;
  if (/\b(open (?:until|till|from)|opens at|closes at|tickets? (?:are|cost)|costs? \$|is free today|sold out)\b/i.test(reply)) return null;
  if (action.type === "replace") {
    const option = options[action.targetStopId]?.find((place) => place.id === action.placeId);
    if (!option || !stops.some((stop) => stop.id === action.targetStopId)) return null;
    return { reply, action: { type: "replace", targetStopId: action.targetStopId, placeId: option.id, placeName: option.name }, source: "model" };
  }
  if ((action.type === "shorten" || action.type === "budget") && !stops.length) return null;
  return { reply, action, source: "model" };
}
