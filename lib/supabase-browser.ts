"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client (ported from mvp2). Receives only the public
 * publishable/anon key — elevated keys stay server-side. Consumer and ops
 * sessions use separate storage keys so signing into one never signs into the other.
 */
export type AuthSurface = "consumer" | "ops";

const clients: Partial<Record<AuthSurface, SupabaseClient | null>> = {};

export function getSupabaseBrowserClient(surface: AuthSurface = "consumer"): SupabaseClient | null {
  if (surface in clients) return clients[surface] ?? null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const client = url && publicKey ? createClient(url, publicKey, { auth: { storageKey: `wayly-nyc-${surface}-auth` } }) : null;
  clients[surface] = client;
  return client;
}

export function isBrowserAuthConfigured() {
  return Boolean(getSupabaseBrowserClient("consumer"));
}

export async function getBrowserAccessToken(surface: AuthSurface = "consumer") {
  const client = getSupabaseBrowserClient(surface);
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  return error ? null : data.session?.access_token ?? null;
}

/** fetch() that attaches the signed-in user's bearer token when there is one. */
export async function authFetch(input: string, init: RequestInit = {}) {
  const token = await getBrowserAccessToken("consumer");
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
