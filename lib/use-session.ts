"use client";

import { useCallback, useEffect, useState } from "react";
import { getBrowserAccessToken, getSupabaseBrowserClient } from "@/lib/supabase-browser";

export type SessionUser = { email: string | null; role: "user" | "admin" | "super_admin"; displayName: string | null };
export type SessionState = { status: "loading" } | { status: "disabled" } | { status: "guest" } | { status: "authed"; user: SessionUser };

/**
 * Consumer session state. The server (/api/auth/me) stays the only source of
 * truth for role and account status; nothing role-related is cached locally.
 * "disabled" means the account service isn't configured (local preview).
 */
export function useSession() {
  const [session, setSession] = useState<SessionState>({ status: "loading" });

  const refresh = useCallback(async () => {
    if (!getSupabaseBrowserClient("consumer")) {
      setSession({ status: "disabled" });
      return;
    }
    const token = await getBrowserAccessToken("consumer");
    if (!token) {
      setSession({ status: "guest" });
      return;
    }
    try {
      const response = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } });
      const payload = (await response.json()) as { user?: { email?: string | null; role?: SessionUser["role"]; displayName?: string | null } };
      if (!response.ok || !payload.user?.role) {
        setSession({ status: "guest" });
        return;
      }
      setSession({ status: "authed", user: { email: payload.user.email ?? null, role: payload.user.role, displayName: payload.user.displayName ?? null } });
    } catch {
      setSession({ status: "guest" });
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    const client = getSupabaseBrowserClient("consumer");
    const subscription = client?.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") void refresh();
    });
    return () => {
      window.clearTimeout(timer);
      subscription?.data.subscription.unsubscribe();
    };
  }, [refresh]);

  const signOut = useCallback(async () => {
    const client = getSupabaseBrowserClient("consumer");
    if (client) await client.auth.signOut();
    setSession({ status: "guest" });
  }, []);

  return { session, refresh, signOut };
}
