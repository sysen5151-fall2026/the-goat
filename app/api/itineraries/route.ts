import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, newRequestId } from "@/lib/api-helpers";
import { requireAuthenticatedUser } from "@/lib/auth";
import { listItineraries, saveItinerary } from "@/lib/nyc-account";
import type { Itinerary } from "@/lib/nyc-types";

// Shape and size check only; a saved plan belongs to its owner, so this mainly
// blocks oversized or obviously non-itinerary bodies.
const payloadSchema = z.object({
  planMode: z.enum(["ai_structured", "controlled_fallback"]).nullable().optional(),
  itinerary: z.object({ id: z.string().min(1).max(200), title: z.string().min(1).max(200), stops: z.array(z.unknown()).min(1).max(10) }).loose(),
});

export async function GET(request: Request) {
  const requestId = newRequestId();
  try {
    const user = await requireAuthenticatedUser(request);
    return NextResponse.json({ requestId, itineraries: await listItineraries(user.id) });
  } catch (error) {
    return errorResponse(error, requestId, "Saved plans can't be loaded right now.", 500);
  }
}

export async function POST(request: Request) {
  const requestId = newRequestId();
  try {
    const user = await requireAuthenticatedUser(request);
    const payload = payloadSchema.parse(await request.json());
    const saved = await saveItinerary(user.id, payload.itinerary as unknown as Itinerary, payload.planMode ?? null);
    return NextResponse.json({ requestId, ok: true, itinerary: saved });
  } catch (error) {
    return errorResponse(error, requestId, "This plan couldn't be saved.");
  }
}
