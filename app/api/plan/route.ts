import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorBody, isAuthConfigured, isAuthError, requireAuthenticatedUser } from "@/lib/auth";
import { checkPlanRateLimit, reserveDailyModelCallBudget } from "@/lib/nyc-guards";
import {
  executeConfiguredModelPlanner,
  getConfiguredPlannerModel,
  ModelPlannerError,
  WAYLY_PLANNER_PROMPT_VERSION,
  WAYLY_PLANNER_RUNTIME_VERSION,
} from "@/lib/nyc-model-planner";
import { effectiveInterests } from "@/lib/nyc-hashtags";
import { queryLocalIndexIds } from "@/lib/ch10-local-index-client";
import { nycPlanRequestSchema } from "@/lib/nyc-plan-contract";
import { planWithResolvedCandidates, rankedPlaces, resolveCandidatesWithRealtimeFallback } from "@/lib/nyc-planner";
import { NYC_POI_DATA_VERSION } from "@/lib/nyc-places";
import { validateItineraryRoute } from "@/lib/nyc-routing";
import type { Itinerary, PlanRequest } from "@/lib/nyc-types";

/**
 * Planning pipeline (ported from mvp2 app/api/plan):
 * validate → rate limit → deterministic candidates (+ Geoapify live listings)
 * → controlled fallback route → DeepSeek single-route selection when configured,
 * not an adjustment, and under the daily cap → any model failure returns the
 * controlled route → Geoapify per-leg route validation.
 */

function logPlanEvent(event: string, detail: Record<string, string | number | boolean>) {
  console.info(JSON.stringify({ event, ...detail }));
}

function versions(modelVersionId: string) {
  return {
    dataVersionId: NYC_POI_DATA_VERSION,
    promptVersionId: WAYLY_PLANNER_PROMPT_VERSION,
    modelVersionId,
    runtimeVersion: WAYLY_PLANNER_RUNTIME_VERSION,
    appVersion: process.env.APP_VERSION ?? "local-preview",
  };
}

async function withRouteValidation(itinerary: Itinerary, partySize: number) {
  try {
    return await validateItineraryRoute(itinerary, partySize);
  } catch {
    return { ...itinerary, routeSource: "estimate" as const };
  }
}

export async function POST(request: Request) {
  const requestId = `req_${crypto.randomUUID()}`;
  const startedAt = performance.now();
  const stageMs: Record<string, number> = {};
  const mark = (stage: string, started: number) => { stageMs[stage] = performance.now() - started; };
  const finish = (response: NextResponse) => {
    stageMs.total = performance.now() - startedAt;
    response.headers.set("Server-Timing", Object.entries(stageMs).map(([stage, ms]) => `${stage};dur=${ms.toFixed(2)}`).join(", "));
    if (process.env.CH10_RULE_ONLY === "1") logPlanEvent("chapter10.plan_timing", { requestId, ...stageMs });
    return response;
  };
  const authStarted = performance.now();
  // Planning can trigger a paid model call, so sign-in is enforced on the server
  // (same rule as mvp2). Fails closed: with no account service configured the
  // endpoint refuses instead of becoming public. Hiding the button in the UI
  // is not a boundary; direct requests are rejected here.
  if (!isAuthConfigured())
    return NextResponse.json({ error: { code: "AUTH_CONFIGURATION_ERROR", message: "Sign-in isn't available right now.", retryable: false }, requestId }, { status: 503 });
  {
    try {
      await requireAuthenticatedUser(request);
    } catch (error) {
      if (isAuthError(error)) return NextResponse.json(authErrorBody(error, requestId), { status: error.status });
      return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Sign-in can't be verified right now.", retryable: true }, requestId }, { status: 500 });
    }
  }
  mark("auth", authStarted);

  const validationStarted = performance.now();
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "The request body must be valid JSON.", retryable: false }, requestId }, { status: 400 });
  }

  const parsed = nycPlanRequestSchema.safeParse(payload);
  if (!parsed.success)
    return NextResponse.json({ error: { code: "invalid_request", message: "Check the trip details and try again.", fieldErrors: z.treeifyError(parsed.error), retryable: false }, requestId }, { status: 400 });
  const body = parsed.data as PlanRequest;
  // #tags typed in the request are the interest filter; saved defaults apply only when none are typed.
  body.interests = effectiveInterests(body.intentText ?? "", body.interests);
  mark("validation", validationStarted);

  const rateLimitStarted = performance.now();
  const rateLimit = checkPlanRateLimit(request);
  if (!rateLimit.allowed)
    return NextResponse.json({ error: { code: "rate_limited", message: "That's a lot of plans in a short time — wait a few minutes and try again.", retryable: true }, requestId }, { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } });
  mark("rateLimit", rateLimitStarted);

  const chapter10RuleOnly = process.env.CH10_RULE_ONLY === "1";
  const catalogStarted = performance.now();
  let indexedIds: ReadonlySet<string> | undefined;
  if (process.env.CH10_INDEXED === "1") {
    const indexStarted = performance.now();
    try {
      indexedIds = await queryLocalIndexIds(body);
    } catch {
      return finish(NextResponse.json({ error: { code: "indexed_catalog_unavailable", message: "The local catalog index is unavailable.", retryable: true }, requestId }, { status: 503 }));
    }
    mark("indexService", indexStarted);
  }
  const candidates = indexedIds ? rankedPlaces(body, indexedIds) : chapter10RuleOnly ? rankedPlaces(body) : await resolveCandidatesWithRealtimeFallback(body);
  mark("catalog", catalogStarted);
  const plannerStarted = performance.now();
  const fallback = planWithResolvedCandidates(body, candidates);
  mark("planner", plannerStarted);
  const trace = {
    shortlisted: candidates.trace.shortlistedCount,
    liveListings: candidates.candidates.filter((place) => place.dataOrigin === "realtime_geoapify").length,
    minStops: candidates.stopCountPolicy.minStops,
    maxStops: candidates.stopCountPolicy.maxStops,
  };

  if (fallback.mode === "insufficient_information")
    return finish(NextResponse.json({ requestId, mode: fallback.mode, itinerary: null, insufficiencyReason: fallback.insufficiencyReason, intentParse: fallback.intentParse, constraintStatus: { hardConstraintsSatisfied: false, sourceCoverage: 1 }, trace, versions: versions("not_called") }));

  const controlled = async (warning?: string) => {
    const routingStarted = performance.now();
    const itinerary = chapter10RuleOnly ? fallback.itinerary : await withRouteValidation(fallback.itinerary, body.partySize);
    mark("routing", routingStarted);
    return finish(NextResponse.json({
      requestId,
      mode: fallback.mode,
      itinerary,
      intentParse: fallback.intentParse,
      ...(warning ? { warning } : {}),
      constraintStatus: { hardConstraintsSatisfied: true, sourceCoverage: 1 },
      trace,
      versions: versions("controlled-fallback"),
    }));
  };

  const config = chapter10RuleOnly ? null : getConfiguredPlannerModel();
  // Adjustments are deterministic by design (only the affected stops change).
  if (!config || body.adjustment) return controlled();
  if (candidates.insufficiencyReason) return controlled("Candidate filtering changed, so the rule-based route was returned.");

  const modelBudgetStarted = performance.now();
  const dailyBudget = await reserveDailyModelCallBudget();
  mark("modelBudget", modelBudgetStarted);
  if (!dailyBudget.allowed) {
    logPlanEvent("plan.daily_model_call_budget_exhausted", { requestId, limit: dailyBudget.limit });
    return controlled("Today's AI route limit was reached, so the rule-based route was returned.");
  }

  try {
    const modelStarted = performance.now();
    const execution = await executeConfiguredModelPlanner(body, config, candidates);
    mark("model", modelStarted);
    logPlanEvent("plan.model_route_succeeded", { requestId, candidateCount: execution.candidateIds.length, stopCount: execution.planner.itinerary.stops.length, repairCount: execution.repairCount, aiReasons: execution.aiReasonCount, latencyMs: execution.latencyMs, inputTokens: execution.usage.inputTokens, outputTokens: execution.usage.outputTokens });
    const routingStarted = performance.now();
    const itinerary = await withRouteValidation(execution.planner.itinerary, body.partySize);
    mark("routing", routingStarted);
    return finish(NextResponse.json({
      requestId,
      mode: execution.planner.mode,
      itinerary,
      intentParse: execution.planner.intentParse,
      constraintStatus: { hardConstraintsSatisfied: true, sourceCoverage: 1 },
      trace,
      versions: versions(config.modelVersionId),
    }));
  } catch (error) {
    logPlanEvent("plan.model_path_fell_back", { requestId, errorStage: error instanceof ModelPlannerError ? error.evidence.errorStage : "unclassified_model_error", repairCount: error instanceof ModelPlannerError ? error.evidence.repairCount : 0 });
    return controlled("The AI route didn't pass validation or was unavailable, so the rule-based route was returned.");
  }
}
