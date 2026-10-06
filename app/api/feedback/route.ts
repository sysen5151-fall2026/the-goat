import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, newRequestId } from "@/lib/api-helpers";
import { getCurrentUser } from "@/lib/auth";
import { listFeedback, saveFeedback } from "@/lib/nyc-account";

const feedbackSchema = z.object({
  itineraryId: z.string().min(1).max(200),
  rating: z.enum(["helpful", "not_helpful"]),
  satisfactionScore: z.number().int().min(1).max(5).optional(),
  trustScore: z.number().int().min(1).max(5).optional(),
  issueType: z.enum(["data", "fit", "route", "transport", "budget", "walking", "other"]).optional(),
  note: z.string().max(500).optional(),
  itineraryVersion: z.string().max(120).optional(),
  dataVersionId: z.string().max(120).optional(),
});

export async function GET() {
  const requestId = newRequestId();
  try {
    return NextResponse.json({ requestId, feedback: await listFeedback() });
  } catch (error) {
    return errorResponse(error, requestId, "Feedback can't be loaded right now.", 500);
  }
}

export async function POST(request: Request) {
  const requestId = newRequestId();
  try {
    const payload = feedbackSchema.parse(await request.json());
    // Feedback is attributed when the caller is signed in; otherwise anonymous.
    const userId = request.headers.get("authorization") ? await getCurrentUser(request).then((user) => user.id).catch(() => null) : null;
    const result = await saveFeedback(userId, payload);
    return NextResponse.json({ ok: true, requestId, ...result });
  } catch (error) {
    return errorResponse(error, requestId, "Feedback couldn't be saved right now.");
  }
}
