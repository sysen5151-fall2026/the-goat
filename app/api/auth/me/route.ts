import { NextResponse } from "next/server";
import { errorResponse, newRequestId } from "@/lib/api-helpers";
import { requireAuthenticatedUser } from "@/lib/auth";

export async function GET(request: Request) {
  const requestId = newRequestId();
  try {
    const user = await requireAuthenticatedUser(request);
    return NextResponse.json({ requestId, user: { id: user.id, email: user.email, role: user.role, status: user.status, displayName: user.displayName } });
  } catch (error) {
    return errorResponse(error, requestId, "Account details can't be read right now.", 500);
  }
}
