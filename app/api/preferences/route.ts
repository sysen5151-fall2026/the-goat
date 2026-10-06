import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, newRequestId } from "@/lib/api-helpers";
import { requireAuthenticatedUser } from "@/lib/auth";
import { getPreferences, savePreferences } from "@/lib/nyc-account";

const preferencesSchema = z.object({
  totalBudgetUsd: z.number().int().min(0).max(10_000),
  partySize: z.number().int().min(1).max(8),
  interests: z.array(z.enum(["landmark", "museum", "architecture", "park", "waterfront", "food"])).min(1),
  transportPreference: z.enum(["smart", "public_transit", "taxi", "walk"]),
  walkingPreference: z.enum(["easy", "balanced", "active"]),
  dining: z.enum(["no_preference", "vegetarian", "coffee", "local"]),
});

export async function GET(request: Request) {
  const requestId = newRequestId();
  try {
    const user = await requireAuthenticatedUser(request);
    return NextResponse.json({ requestId, preferences: await getPreferences(user.id) });
  } catch (error) {
    return errorResponse(error, requestId, "Saved preferences can't be loaded right now.", 500);
  }
}

export async function PUT(request: Request) {
  const requestId = newRequestId();
  try {
    const user = await requireAuthenticatedUser(request);
    await savePreferences(user.id, preferencesSchema.parse(await request.json()));
    return NextResponse.json({ requestId, ok: true });
  } catch (error) {
    return errorResponse(error, requestId, "Preferences couldn't be saved.");
  }
}
