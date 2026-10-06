import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, newRequestId } from "@/lib/api-helpers";
import { requireAuthenticatedUser } from "@/lib/auth";
import { getProfile, saveProfile } from "@/lib/nyc-account";

const profileSchema = z.object({ displayName: z.string().trim().min(1).max(24) });

export async function GET(request: Request) {
  const requestId = newRequestId();
  try {
    const user = await requireAuthenticatedUser(request);
    return NextResponse.json({ requestId, profile: await getProfile(user.id, user.email) });
  } catch (error) {
    return errorResponse(error, requestId, "Your profile can't be loaded right now.", 500);
  }
}

export async function PUT(request: Request) {
  const requestId = newRequestId();
  try {
    const user = await requireAuthenticatedUser(request);
    await saveProfile(user.id, profileSchema.parse(await request.json()).displayName);
    return NextResponse.json({ requestId, ok: true });
  } catch (error) {
    return errorResponse(error, requestId, "Your profile couldn't be saved.");
  }
}
