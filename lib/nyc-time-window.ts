import { resolvePlanDurationHours } from "@/lib/nyc-geo";
import type { PlanRequest, TimeWindow } from "@/lib/nyc-types";

// Ported from mvp2 lib/time-window-policy.ts with English intent signals.
export const TIME_WINDOW_POLICY_VERSION = "time-window-policy-v1";

function timeLabel(minutes: number) {
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Time-of-day requests are a deterministic scheduling constraint; they never invent opening hours. */
export function resolveTimeWindowPolicy(request: PlanRequest): TimeWindow {
  const text = request.intentText.toLowerCase();
  const matched = (daypart: TimeWindow["daypart"], startMinutes: number, signal: string): TimeWindow => ({
    policyVersion: TIME_WINDOW_POLICY_VERSION,
    daypart,
    startTime: timeLabel(startMinutes),
    signals: [signal],
  });
  if (/\b(tonight|at night|night ?time|late night)\b/.test(text)) return matched("night", 18 * 60 + 30, "Detected a night-time request");
  if (/\b(sunset|dusk|evening|night view|night views|city lights)\b/.test(text)) return matched("evening", 17 * 60 + 30, "Detected an evening / sunset request");
  if (/\bafternoon\b/.test(text)) return matched("afternoon", 14 * 60, "Detected an afternoon request");
  if (/\b(morning|early start|start early|sunrise)\b/.test(text)) return matched("morning", 9 * 60, "Detected a morning request");
  const hours = resolvePlanDurationHours(request);
  return matched("default", hours >= 8 ? 9 * 60 + 30 : 10 * 60, hours >= 8 ? "Full day starts in the morning by default" : "Half day starts mid-morning by default");
}
