import { supabase } from "@/lib/supabase";

/**
 * Request guards ported from mvp2 (lib/plan-rate-limit.ts, lib/daily-model-budget.ts).
 * Both are per-instance, in-memory limits: a cost/abuse safety net, not a durable
 * quota. Add an edge rate rule in production for a hard guarantee.
 */

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 8;
const requestsByClient = new Map<string, number[]>();

function clientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  return request.headers.get("cf-connecting-ip") ?? forwarded?.split(",")[0]?.trim() ?? "unknown-client";
}

/** At most 8 planning requests per client per 10 minutes. */
export function checkPlanRateLimit(request: Request, now = Date.now()) {
  const key = clientKey(request);
  const recent = (requestsByClient.get(key) ?? []).filter((time) => now - time < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
    requestsByClient.set(key, recent);
    return { allowed: false, retryAfterSeconds: Math.ceil((WINDOW_MS - (now - recent[0])) / 1000) };
  }
  recent.push(now);
  requestsByClient.set(key, recent);
  if (requestsByClient.size > 5000) requestsByClient.delete(requestsByClient.keys().next().value as string);
  return { allowed: true, retryAfterSeconds: 0 };
}

const DEFAULT_DAILY_LIMIT = 50;
let dailyCounter = { date: "", count: 0 };

export function resolveDailyModelCallLimit() {
  const parsed = Number(process.env.DAILY_MODEL_CALL_LIMIT);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_DAILY_LIMIT;
}

/**
 * Reserves one real DeepSeek call for today (UTC). Uses the atomic Supabase
 * function nyc_reserve_daily_model_call_budget (shared across instances) when
 * configured, otherwise a per-instance memory counter. Over the cap → the
 * controlled planner, not an error.
 */
export async function reserveDailyModelCallBudget(now = new Date()) {
  const limit = resolveDailyModelCallLimit();
  const date = now.toISOString().slice(0, 10);
  if (supabase) {
    try {
      const { data, error } = await supabase.rpc("nyc_reserve_daily_model_call_budget", { p_limit: limit, p_date: date });
      const row = Array.isArray(data) ? data[0] : data;
      if (!error && row && typeof row.allowed === "boolean") return { allowed: row.allowed as boolean, limit, callCount: Number(row.call_count), source: "supabase" as const };
    } catch {
      // fall through to the in-memory counter
    }
  }
  if (dailyCounter.date !== date) dailyCounter = { date, count: 0 };
  if (dailyCounter.count >= limit) return { allowed: false, limit, callCount: dailyCounter.count, source: "memory" as const };
  dailyCounter.count += 1;
  return { allowed: true, limit, callCount: dailyCounter.count, source: "memory" as const };
}
