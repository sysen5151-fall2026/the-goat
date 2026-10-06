import { NextResponse } from "next/server";
import { errorResponse, newRequestId } from "@/lib/api-helpers";
import { requireAuthenticatedUser } from "@/lib/auth";
import { deleteItinerary } from "@/lib/nyc-account";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = newRequestId();
  try {
    const user = await requireAuthenticatedUser(request);
    const { id } = await context.params;
    await deleteItinerary(user.id, id);
    return NextResponse.json({ requestId, ok: true });
  } catch (error) {
    return errorResponse(error, requestId, "This plan couldn't be deleted.");
  }
}
