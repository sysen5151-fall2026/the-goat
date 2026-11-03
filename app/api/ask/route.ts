import { NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { authErrorBody, isAuthConfigured, isAuthError, requireAuthenticatedUser } from "@/lib/auth";
import { askHistorySchema, askStopsSchema, buildAskPrompt, replacementOptions, rulesAsk, validateModelAnswer, wantedTags, type AskResult } from "@/lib/nyc-ask";
import { reserveDailyModelCallBudget } from "@/lib/nyc-guards";
import { getConfiguredPlannerModel } from "@/lib/nyc-model-planner";
import { nycPlanRequestSchema } from "@/lib/nyc-plan-contract";
import type { PlanRequest } from "@/lib/nyc-types";

const bodySchema = z.object({
  message: z.string().trim().min(1).max(300),
  history: askHistorySchema.default([]),
  request: nycPlanRequestSchema,
  stops: askStopsSchema.default([]),
});

// Per-account chat limit (in memory, like the plan guard): 20 turns per 10 minutes.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_TURNS = 20;
const turnsByUser = new Map<string, number[]>();
function allowTurn(userId: string, now = Date.now()) {
  const recent = (turnsByUser.get(userId) ?? []).filter((time) => now - time < WINDOW_MS);
  if (recent.length >= MAX_TURNS) { turnsByUser.set(userId, recent); return false; }
  recent.push(now); turnsByUser.set(userId, recent);
  if (turnsByUser.size > 5000) turnsByUser.delete(turnsByUser.keys().next().value as string);
  return true;
}

export async function POST(request: Request) {
  const requestId = `ask_${crypto.randomUUID()}`;
  if (!isAuthConfigured())
    return NextResponse.json({ error: { code: "AUTH_CONFIGURATION_ERROR", message: "Sign-in isn't available right now.", retryable: false }, requestId }, { status: 503 });
  let userId: string;
  try {
    userId = (await requireAuthenticatedUser(request)).id;
  } catch (error) {
    if (isAuthError(error)) return NextResponse.json(authErrorBody(error, requestId), { status: error.status });
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Sign-in can't be verified right now.", retryable: true }, requestId }, { status: 500 });
  }
  if (!allowTurn(userId))
    return NextResponse.json({ error: { code: "rate_limited", message: "That's a lot of messages — wait a few minutes and try again.", retryable: true }, requestId }, { status: 429 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "invalid_request", message: "That message couldn't be read.", retryable: false }, requestId }, { status: 400 });
  const { message, history, stops } = parsed.data;
  const plan = parsed.data.request as PlanRequest;

  // Rules answer first: it is the reply when no model is configured, the daily cap is hit, or the model fails validation.
  const fallback = rulesAsk(message, plan, stops);
  const config = getConfiguredPlannerModel();
  if (!config) return NextResponse.json({ requestId, ...fallback });
  const budget = await reserveDailyModelCallBudget();
  if (!budget.allowed) return NextResponse.json({ requestId, ...fallback });

  const tags = wantedTags(message);
  const options = Object.fromEntries(stops.map((stop) => [stop.id, replacementOptions(stops, stop.id, plan, tags)]));
  let answer: AskResult | null = null;
  try {
    const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, timeout: 20_000, maxRetries: 0 });
    const completion = await client.chat.completions.create({
      model: config.modelId,
      temperature: 0.2,
      // oxlint-disable-next-line typescript/no-deprecated -- DeepSeek's chat API uses max_tokens.
      max_tokens: 350,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildAskPrompt(plan, stops, options) },
        ...history.map((turn) => ({ role: turn.role, content: turn.text })),
        { role: "user", content: message },
      ],
    });
    answer = validateModelAnswer(completion.choices[0]?.message?.content ?? "", stops, options);
  } catch {
    answer = null;
  }
  console.info(JSON.stringify({ event: answer ? "ask.model_answer" : "ask.rules_fallback", requestId, action: (answer ?? fallback).action.type }));
  return NextResponse.json({ requestId, ...(answer ?? fallback) });
}
