import { resolvePlanDurationHours } from "@/lib/nyc-geo";
import type { PlanRequest } from "@/lib/nyc-types";

// Ported from mvp2 lib/stop-count-policy.ts with English intent signals.
export const STOP_COUNT_POLICY_VERSION = "stop-count-policy-v1";

export type StopCountPolicy = { minStops: number; maxStops: number; reason: string; signals: string[] };

const NUMBER_WORDS: Record<string, number> = { one: 1, single: 1, a: 1, two: 2, couple: 2, three: 3, four: 4, five: 5 };

function explicitStopCount(intentText: string) {
  const pattern = /\b(a single|one|single|two|a couple of|three|four|five|[1-5])\s+(?:main\s+|big\s+)?(?:places?|stops?|museums?|parks?|sights?|spots?|destinations?|landmarks?|attractions?)\b/g;
  const matched = [...intentText.toLowerCase().matchAll(pattern)];
  if (!matched.length) return null;
  const total = matched.reduce((sum, match) => {
    const token = match[1].replace(/^a /, "").replace(/ of$/, "");
    return sum + (Number(token) || NUMBER_WORDS[token] || 0);
  }, 0);
  return total >= 1 && total <= 5 ? total : null;
}

/** Request-aware stop-count contract shared by the controlled planner, the model tool and validation. */
export function deriveStopCountPolicy(request: PlanRequest, candidateCount?: number): StopCountPolicy {
  const text = request.intentText.toLowerCase();
  const signals: string[] = [];
  const explicit = explicitStopCount(text);
  if (explicit) {
    signals.push(`User asked for ${explicit} core stop${explicit > 1 ? "s" : ""}`);
    const capped = candidateCount !== undefined ? Math.min(explicit, Math.max(1, candidateCount)) : explicit;
    return { minStops: capped, maxStops: capped, reason: "The user stated an explicit number of places, which overrides duration rules.", signals };
  }

  const hours = resolvePlanDurationHours(request);
  let minStops: number;
  let maxStops: number;
  if (hours <= 2) {
    minStops = 1; maxStops = 1; signals.push("1–2 hours: one core stop");
  } else if (hours <= 4) {
    minStops = 1; maxStops = 2; signals.push("Short half day: 1–2 stops");
  } else if (hours >= 8) {
    minStops = 2; maxStops = 4; signals.push("Full day: 2–4 stops");
  } else {
    minStops = request.interests.length >= 2 ? 2 : 1; maxStops = 3; signals.push("Half day: 1–3 stops");
  }

  const slowPace = /\b(relaxed|slow|slowly|take it easy|not too (?:much|many|rushed|busy)|keep it simple|less walking|bad knees?|knees? hurt|leisurely|don'?t want to walk (?:too )?much|easy day)\b/.test(text);
  if (slowPace) {
    minStops = hours >= 8 ? 2 : 1;
    maxStops = Math.max(1, maxStops - 1);
    signals.push("Slow-pace wording lowers the stop limit");
  }
  if (request.walkingPreference === "easy") {
    minStops = 1;
    maxStops = Math.min(maxStops, 2);
    signals.push("Easy walking pace allows at most 2 core stops");
  }
  if (/\b(statue of liberty|liberty island|ellis island)\b/.test(text)) {
    minStops = 1;
    maxStops = /\b(only|just) (one|that)\b/.test(text) ? 1 : Math.min(maxStops, 2);
    signals.push("Harbor ferry destination allows a single main stop");
  }
  if (candidateCount !== undefined) {
    maxStops = Math.min(maxStops, Math.max(1, candidateCount));
    minStops = Math.min(minStops, maxStops);
    signals.push(`Limited by ${candidateCount} relevant candidates`);
  }
  return { minStops, maxStops, reason: signals.join("; "), signals };
}
