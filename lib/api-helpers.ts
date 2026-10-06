import { NextResponse } from "next/server";
import { authErrorBody, isAuthError } from "@/lib/auth";

export function newRequestId() {
  return `req_${crypto.randomUUID()}`;
}

/** Maps auth errors to their status; everything else to a safe 400/500 message. */
export function errorResponse(error: unknown, requestId: string, fallback: string, status: 400 | 500 = 400) {
  if (isAuthError(error)) return NextResponse.json(authErrorBody(error, requestId), { status: error.status });
  const message = error instanceof Error && error.message ? error.message : fallback;
  return NextResponse.json({ error: { code: status === 500 ? "INTERNAL_ERROR" : "INVALID_REQUEST", message, retryable: status === 500 }, requestId }, { status });
}
