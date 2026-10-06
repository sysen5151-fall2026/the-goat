import { supabase } from "@/lib/supabase";

/**
 * Server-side identity (ported from mvp2 lib/auth.ts). Verifies the caller's
 * Supabase JWT first, then reads account status and role from server tables.
 * Browser-provided roles are never trusted. Shared with Wayly Beijing: one
 * account, one profile, one role row.
 */
export const WAYLY_ROLES = ["user", "admin", "super_admin"] as const;
export type WaylyRole = (typeof WAYLY_ROLES)[number];

export type CurrentUser = { id: string; email: string | null; role: WaylyRole; status: "active" | "disabled"; displayName: string | null };

export class AuthError extends Error {
  constructor(
    public readonly status: 401 | 403 | 500,
    public readonly code: "UNAUTHORIZED" | "FORBIDDEN" | "ACCOUNT_DISABLED" | "AUTH_CONFIGURATION_ERROR" | "ACCOUNT_NOT_READY",
    message: string,
  ) {
    super(message);
  }
}

export function isAuthConfigured() {
  return Boolean(supabase);
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) throw new AuthError(401, "UNAUTHORIZED", "Please sign in to continue.");
  return token;
}

function isWaylyRole(value: unknown): value is WaylyRole {
  return typeof value === "string" && (WAYLY_ROLES as readonly string[]).includes(value);
}

export async function getCurrentUser(request: Request): Promise<CurrentUser> {
  const token = bearerToken(request);
  if (!supabase) throw new AuthError(500, "AUTH_CONFIGURATION_ERROR", "The account service isn't configured.");
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  const authUser = authData.user;
  if (authError || !authUser) throw new AuthError(401, "UNAUTHORIZED", "Your session has expired. Please sign in again.");

  const [{ data: profile, error: profileError }, { data: roleRow, error: roleError }] = await Promise.all([
    supabase.from("profiles").select("user_id, status, display_name").eq("user_id", authUser.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", authUser.id).maybeSingle(),
  ]);
  if (profileError || roleError) throw new AuthError(500, "AUTH_CONFIGURATION_ERROR", "Account details can't be read right now.");
  if (!profile || !roleRow || !isWaylyRole(roleRow.role)) throw new AuthError(403, "ACCOUNT_NOT_READY", "Your account is still being set up. Try again in a moment.");
  if (profile.status === "disabled") throw new AuthError(403, "ACCOUNT_DISABLED", "This account has been disabled.");
  if (profile.status !== "active") throw new AuthError(403, "ACCOUNT_NOT_READY", "This account can't be used right now.");
  return { id: authUser.id, email: authUser.email ?? null, role: roleRow.role, status: profile.status, displayName: profile.display_name ?? null };
}

export const requireAuthenticatedUser = getCurrentUser;

export async function requireRole(request: Request, allowed: readonly WaylyRole[]) {
  const user = await getCurrentUser(request);
  if (!allowed.includes(user.role)) throw new AuthError(403, "FORBIDDEN", "Your account doesn't have permission for this.");
  return user;
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}

export function authErrorBody(error: AuthError, requestId: string) {
  return { error: { code: error.code, message: error.message, retryable: false }, requestId };
}
