import OpenAI from "openai";
import { z } from "zod";
import { CANDIDATE_FILTERING_VERSION } from "@/lib/nyc-candidate-filtering";
import {
  calculateRouteMetrics,
  hasUnsupportedClaim,
  inspectModelSelection,
  validateModelSelection,
  type BudgetGuardAudit,
  type CandidateResult,
} from "@/lib/nyc-planner";
import { publishedPlaces } from "@/lib/nyc-places";
import { STOP_COUNT_POLICY_VERSION, type StopCountPolicy } from "@/lib/nyc-stop-count-policy";
import { TIME_WINDOW_POLICY_VERSION } from "@/lib/nyc-time-window";
import { inspectRouteMetricsToolArguments, type RouteMetricsToolArgumentAudit } from "@/lib/nyc-tool-argument-guard";
import type { NycPlace, PlanRequest, PlannerResult } from "@/lib/nyc-types";

/**
 * DeepSeek route selection, ported from mvp2 lib/model-planner.ts.
 *
 * Contract (single final route): the model receives only the deterministic
 * shortlist (≤ 8 IDs), must call `calculate_route_metrics` exactly once with
 * its one chosen ordered route, then returns strict JSON with the same IDs plus
 * one short reason per stop. Code validates IDs, stop count, budget, sources and
 * walking limits; each stage gets at most one repair, otherwise the API returns
 * the controlled (rule-based) route. The model never invents places, prices,
 * hours or transport facts; its reasons are screened for real-time promises.
 */

export const PLANNER_STRUCTURED_SCHEMA_NAME = "wayly_itinerary_selection";
export const PLANNER_STRUCTURED_SCHEMA_VERSION = "wayly-nyc-itinerary-selection-v1";
export const WAYLY_PLANNER_PROMPT_VERSION = "wayly-nyc-planner-prompt-v1";
export const WAYLY_PLANNER_RUNTIME_VERSION = "wayly-nyc-planner-runtime-v1";
const WAYLY_ORCHESTRATION_CONTRACT_VERSION = "single-final-route-tool-call-v2";
const MAX_REASON_LENGTH = 140;

export const waylyNycPlannerPrompt = `You are the route planner for "Wayly", a trusted New York City exploration app.

Using the user's request and the system-provided candidate_pois, choose one credible, practical short NYC route. Use 1–5 stops as the stop_count_policy allows; never add an unsuitable place just to reach a count.

Rules:
1. Only use places from candidate_pois. Never add, guess or rename a place.
2. Satisfy hard constraints first: time, total budget, area, must-include and must-avoid requests.
3. Use only facts given in the input. Never invent opening hours, ticket prices, distances, travel times, ratings, ticket availability or any real-time status.
4. Balance interest fit, stop order, time, budget, spatial sense and variety; avoid obvious back-tracking.
5. Candidates with dataOrigin "realtime_geoapify" are unreviewed live map listings; prefer curated places when they fit equally well.
6. For each chosen stop write one short, specific reason (max ${MAX_REASON_LENGTH} characters) explaining why it suits this user and this route. No prices, hours, dollar amounts or promises.
7. All place IDs must exactly match the IDs in candidate_pois.
8. The final message is only JSON matching the system JSON Schema — no Markdown, code fences or extra text.`;

type ModelSelection = { stopIds: string[]; reasons: Array<{ placeId: string; reason: string }> };

function selectionSchemaFor(policy: StopCountPolicy) {
  return z.object({
    stopIds: z.array(z.string()).min(policy.minStops).max(policy.maxStops),
    reasons: z.array(z.object({ placeId: z.string(), reason: z.string() })).max(5),
  });
}

function structuredSchemaFor(policy: StopCountPolicy) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["stopIds", "reasons"],
    properties: {
      stopIds: { type: "array", items: { type: "string" }, minItems: policy.minStops, maxItems: policy.maxStops },
      reasons: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["placeId", "reason"],
          properties: { placeId: { type: "string" }, reason: { type: "string" } },
        },
      },
    },
  };
}

function routeMetricsToolFor(candidateIds: string[], policy: StopCountPolicy) {
  return {
    type: "function" as const,
    name: "calculate_route_metrics",
    description:
      "After choosing your single final route from candidate_pois, call this exactly once to compute static walking distance, travel time and fare estimates for that route. Never use it to compare alternatives. placeIds must be canonical IDs from candidate_pois, in visiting order.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["placeIds"],
      properties: {
        placeIds: { type: "array", minItems: policy.minStops, maxItems: policy.maxStops, uniqueItems: true, items: { type: "string", enum: candidateIds } },
      },
    },
  };
}

export type PlannerModelConfig = {
  provider: "deepseek";
  baseURL: string;
  apiKey: string;
  modelId: string;
  modelVersionId: string;
  promptVersionId: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  maxRetries: number;
};

/** DeepSeek only (product decision). Returns null when no key is configured → controlled planner. */
export function getConfiguredPlannerModel(): PlannerModelConfig | null {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  const modelId = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  return {
    provider: "deepseek",
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    apiKey,
    modelId,
    modelVersionId: modelId,
    promptVersionId: WAYLY_PLANNER_PROMPT_VERSION,
    temperature: 0,
    maxOutputTokens: 700,
    timeoutMs: 30_000,
    maxRetries: 1,
  };
}

export type ModelPlannerFailureEvidence = {
  errorStage: "tool_request" | "required_tool_missing" | "tool_call_count" | "tool_arguments_json_parse" | "tool_arguments_schema" | "tool_argument_guard" | "stop_count_policy" | "budget_guard" | "json_parse" | "json_schema" | "model_selection_validation";
  message: string;
  repairCount: number;
  details: string[];
};

export class ModelPlannerError extends Error {
  readonly evidence: ModelPlannerFailureEvidence;
  constructor(message: string, evidence: ModelPlannerFailureEvidence) {
    super(message);
    this.name = "ModelPlannerError";
    this.evidence = evidence;
  }
}

export type ModelPlannerExecution = {
  planner: Extract<PlannerResult, { itinerary: NonNullable<PlannerResult["itinerary"]> }>;
  candidateIds: string[];
  repairCount: number;
  latencyMs: number;
  usage: { inputTokens: number; outputTokens: number };
  aiReasonCount: number;
};

function modelInputFor(request: PlanRequest, candidates: CandidateResult) {
  const costs = new Map(candidates.budgetFeasibility.candidateCosts.map((cost) => [cost.placeId, cost]));
  const { adjustment: _adjustment, ...publicRequest } = request;
  void _adjustment;
  return JSON.stringify({
    request: publicRequest,
    planning_policy: {
      stop_count_policy: candidates.stopCountPolicy,
      candidate_filtering: {
        version: CANDIDATE_FILTERING_VERSION,
        initial_count: candidates.trace.initialCount,
        eligible_count: candidates.trace.eligibleCount,
        shortlisted_count: candidates.trace.shortlistedCount,
        spatial_strategy: candidates.trace.spatialStrategy,
        ranking_reasons: candidates.trace.rankingReasons,
      },
      budget_feasibility: candidates.budgetFeasibility,
      intent_parse: candidates.intentParse,
      orchestration_contract: {
        version: WAYLY_ORCHESTRATION_CONTRACT_VERSION,
        steps: ["Choose one final route from candidate_pois.", "Call calculate_route_metrics exactly once for that route.", "After the validated metrics, output the structured final selection."],
        forbidden: "Do not use multiple calculate_route_metrics calls to compare routes.",
      },
      versions: { stop_count_policy: STOP_COUNT_POLICY_VERSION, time_window_policy: TIME_WINDOW_POLICY_VERSION },
    },
    candidate_pois: candidates.candidates.map((place) => ({
      id: place.id,
      name: place.name,
      neighborhood: place.neighborhood,
      interests: place.interests,
      planningAllowanceUsd: place.planningAllowanceUsd,
      expectedSpendSemantics: place.expectedSpendSemantics,
      groupSpendUsd: costs.get(place.id)?.groupSpendUsd ?? null,
      remainingBudgetUsd: costs.get(place.id)?.remainingBudgetUsd ?? null,
      dataOrigin: place.dataOrigin ?? "curated",
      sourceName: place.sourceName,
      reviewedOn: place.reviewedOn,
      evidence: `${place.accessNote} ${place.priceNote}`,
    })),
  });
}

function assistantMessageText(response: OpenAI.Responses.Response) {
  const texts = response.output.flatMap((item) => (item.type === "message" ? item.content.filter((content) => content.type === "output_text").map((content) => content.text) : []));
  return texts.length ? texts.join("\n") : null;
}

function usageOf(responses: OpenAI.Responses.Response[]) {
  return responses.reduce((total, response) => ({ inputTokens: total.inputTokens + (response.usage?.input_tokens ?? 0), outputTokens: total.outputTokens + (response.usage?.output_tokens ?? 0) }), { inputTokens: 0, outputTokens: 0 });
}

type ToolAttempt = { valid: boolean; errorStage: ModelPlannerFailureEvidence["errorStage"] | null; toolCallCount: number; audit: RouteMetricsToolArgumentAudit | null; selectionReason: string | null; budgetGuard: BudgetGuardAudit | null };

function inspectToolCall(response: OpenAI.Responses.Response, request: PlanRequest, candidates: CandidateResult, candidateIds: string[], realtimeIds: string[]): ToolAttempt {
  const calls = response.output.filter((item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call" && item.name === "calculate_route_metrics");
  if (calls.length !== 1) return { valid: false, errorStage: calls.length ? "tool_call_count" : "required_tool_missing", toolCallCount: calls.length, audit: null, selectionReason: null, budgetGuard: null };
  const policy = candidates.stopCountPolicy;
  const audit = inspectRouteMetricsToolArguments({
    rawArguments: calls[0].arguments,
    minStops: policy.minStops,
    maxStops: policy.maxStops,
    candidateIds,
    currentDataVersionIds: publishedPlaces.map((place) => place.id),
    additionalRecognizedIds: realtimeIds,
  });
  const selection = audit.valid && audit.placeIds ? inspectModelSelection(request, audit.placeIds, candidates) : null;
  const selectionReason = selection?.reason ?? null;
  const budgetGuard = selection?.budgetGuard ?? null;
  return {
    valid: audit.valid && !selectionReason,
    errorStage: !audit.valid ? audit.errorStage : budgetGuard && !budgetGuard.valid ? "budget_guard" : selectionReason ? "model_selection_validation" : null,
    toolCallCount: 1,
    audit,
    selectionReason,
    budgetGuard,
  };
}

function repairInstruction(attempt: ToolAttempt, policy: StopCountPolicy) {
  if (attempt.toolCallCount !== 1) return "Submit one final route only, with exactly one calculate_route_metrics call. Do not compare alternatives.";
  if (attempt.errorStage === "stop_count_policy") return `You chose ${attempt.audit?.receivedStopCount ?? 0} places; this request allows ${policy.minStops}–${policy.maxStops}. Choose again from the original candidate IDs, then call calculate_route_metrics once.`;
  if (attempt.errorStage === "budget_guard" && attempt.budgetGuard)
    return `That route is estimated at $${attempt.budgetGuard.estimatedTotalSpendUsd ?? "unknown"} but the budget is $${attempt.budgetGuard.totalBudgetUsd}. Choose a budget-feasible route from the original candidate IDs and call calculate_route_metrics once.`;
  return `Resubmit one final route and call calculate_route_metrics once. placeIds must be canonical candidate IDs only — no names, duplicates or outside places.${attempt.selectionReason ? ` Problem: ${attempt.selectionReason}` : ""}`;
}

/** Keeps only reasons for selected stops that are short and make no real-time promises. */
function screenReasons(selection: ModelSelection): Record<string, string> {
  const selected = new Set(selection.stopIds);
  const accepted: Record<string, string> = {};
  for (const { placeId, reason } of selection.reasons) {
    const text = reason.trim().replace(/\s+/g, " ");
    if (!selected.has(placeId) || !text || text.length > MAX_REASON_LENGTH || hasUnsupportedClaim(text)) continue;
    accepted[placeId] = text;
  }
  return accepted;
}

export async function executeConfiguredModelPlanner(request: PlanRequest, config: PlannerModelConfig, candidates: CandidateResult): Promise<ModelPlannerExecution> {
  if (candidates.insufficiencyReason) throw new Error("Candidate filtering already judged this request insufficient.");
  const candidateIds = candidates.candidates.map((place) => place.id);
  const extraPlacesById: Record<string, NycPlace> = Object.fromEntries(candidates.candidates.filter((place) => place.dataOrigin === "realtime_geoapify").map((place) => [place.id, place]));
  const policy = candidates.stopCountPolicy;
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, timeout: config.timeoutMs, maxRetries: config.maxRetries });
  const startedAt = Date.now();
  const modelInput = modelInputFor(request, candidates);
  const responses: OpenAI.Responses.Response[] = [];
  let repairCount = 0;
  const fail = (errorStage: ModelPlannerFailureEvidence["errorStage"], message: string, details: string[] = []) => new ModelPlannerError(message, { errorStage, message, repairCount, details });

  const requestToolCall = async (input: string) => {
    try {
      const response = await client.responses.create({
        model: config.modelId,
        store: false,
        instructions: waylyNycPlannerPrompt,
        input,
        tools: [routeMetricsToolFor(candidateIds, policy)],
        tool_choice: { type: "function", name: "calculate_route_metrics" },
        parallel_tool_calls: false,
        temperature: config.temperature,
        reasoning: { effort: "none" },
        max_output_tokens: config.maxOutputTokens,
      } as OpenAI.Responses.ResponseCreateParamsNonStreaming);
      responses.push(response);
      return response;
    } catch (error) {
      throw fail("tool_request", "The model route-tool request failed.", [error instanceof Error ? error.message.slice(0, 300) : "unknown error"]);
    }
  };

  let attempt = inspectToolCall(await requestToolCall(modelInput), request, candidates, candidateIds, Object.keys(extraPlacesById));
  if (!attempt.valid) {
    repairCount += 1;
    const repairInput = JSON.stringify({ planning_context: JSON.parse(modelInput), repair: { instruction: repairInstruction(attempt, policy), error_stage: attempt.errorStage } });
    attempt = inspectToolCall(await requestToolCall(repairInput), request, candidates, candidateIds, Object.keys(extraPlacesById));
  }
  if (!attempt.valid || !attempt.audit?.placeIds)
    throw fail(attempt.errorStage ?? "tool_argument_guard", "The model route-tool call failed the deterministic argument contract.", [...(attempt.audit?.otherReasons ?? []), ...(attempt.selectionReason ? [attempt.selectionReason] : [])]);

  const routePlaceIds = attempt.audit.placeIds;
  const routeMetrics = calculateRouteMetrics(request, routePlaceIds, extraPlacesById);

  // Stateless finalization turn: planning context + server-validated metrics only.
  const finalizationInput = (parseError?: string) =>
    JSON.stringify({
      planning_context: JSON.parse(modelInput),
      validated_route_metrics: routeMetrics,
      finalization: {
        instruction: `The route tool already ran and its result is validated. Do not call tools. Output only one JSON object matching the schema. stopIds must equal route_place_ids exactly, in the same order. reasons: one short reason (max ${MAX_REASON_LENGTH} characters) per stop, no prices, hours, dollar amounts or real-time promises.`,
        route_place_ids: routePlaceIds,
        stop_count_policy: policy,
      },
      ...(parseError ? { repair: { instruction: "The previous final output failed to parse. Re-output per the finalization contract.", parse_error: parseError } } : {}),
    });
  const requestFinal = async (input: string) => {
    try {
      const response = await client.responses.create({
        model: config.modelId,
        store: false,
        instructions: waylyNycPlannerPrompt,
        input,
        tool_choice: "none",
        text: { format: { type: "json_schema", name: PLANNER_STRUCTURED_SCHEMA_NAME, strict: true, schema: structuredSchemaFor(policy) } },
        reasoning: { effort: "none" },
        temperature: config.temperature,
        max_output_tokens: config.maxOutputTokens,
      } as OpenAI.Responses.ResponseCreateParamsNonStreaming);
      responses.push(response);
      return response;
    } catch (error) {
      throw fail("json_parse", "The model structured-output request failed.", [error instanceof Error ? error.message.slice(0, 300) : "unknown error"]);
    }
  };
  const parseFinal = (response: OpenAI.Responses.Response): { ok: true; selection: ModelSelection } | { ok: false; stage: "json_parse" | "json_schema"; error: string } => {
    const text = assistantMessageText(response);
    if (!text) return { ok: false, stage: "json_parse", error: "assistant message text missing" };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return { ok: false, stage: "json_parse", error: error instanceof Error ? error.message : "json parse failed" };
    }
    const result = selectionSchemaFor(policy).safeParse(parsed);
    return result.success ? { ok: true, selection: result.data } : { ok: false, stage: "json_schema", error: "structured output schema invalid" };
  };

  let final = parseFinal(await requestFinal(finalizationInput()));
  if (!final.ok) {
    repairCount += 1;
    final = parseFinal(await requestFinal(finalizationInput(final.error)));
  }
  if (!final.ok) throw fail(final.stage, "The model's final output failed strict structured parsing.", [final.error]);
  if (final.selection.stopIds.join("|") !== routePlaceIds.join("|")) throw fail("model_selection_validation", "The model's final route differs from the validated route.");

  const aiReasons = screenReasons(final.selection);
  const checked = validateModelSelection(request, final.selection.stopIds, candidates, aiReasons);
  if (!("itinerary" in checked) || !checked.itinerary) throw fail("model_selection_validation", checked.reason ?? "Model selection failed validation.");

  return {
    planner: { mode: "ai_structured", itinerary: checked.itinerary, intentParse: checked.intentParse },
    candidateIds,
    repairCount,
    latencyMs: Date.now() - startedAt,
    usage: usageOf(responses),
    aiReasonCount: Object.keys(aiReasons).length,
  };
}
