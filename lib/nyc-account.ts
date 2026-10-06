import { supabase } from "@/lib/supabase";
import type { Itinerary, PlanMode, PlanRequest } from "@/lib/nyc-types";

/**
 * Server-only account storage for Wayly NYC (nyc_* tables, see
 * supabase/schema.nyc.sql). Every call runs after lib/auth.ts verified the
 * caller, and every query is scoped by user_id here — the secret key bypasses
 * RLS, so this scoping is the authorization boundary.
 */

export type SavedItinerary = { id: string; title: string; planMode: PlanMode | null; itinerary: Itinerary; createdAt: string };
export type NycPreferences = Pick<PlanRequest, "totalBudgetUsd" | "partySize" | "interests" | "transportPreference" | "walkingPreference" | "dining"> & { updatedAt?: string };
export type NycProfile = { displayName: string | null; avatarEmoji: string | null; email: string | null };

const MAX_SAVED_ITINERARIES = 30;

function db() {
  if (!supabase) throw new Error("The account service isn't configured.");
  return supabase;
}

export async function listItineraries(userId: string): Promise<SavedItinerary[]> {
  const { data, error } = await db().from("nyc_itineraries").select("id, title, plan_mode, itinerary_json, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(MAX_SAVED_ITINERARIES);
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.id, title: row.title, planMode: row.plan_mode, itinerary: row.itinerary_json as Itinerary, createdAt: row.created_at }));
}

export async function saveItinerary(userId: string, itinerary: Itinerary, planMode: PlanMode | null): Promise<SavedItinerary> {
  const client = db();
  const { count, error: countError } = await client.from("nyc_itineraries").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (countError) throw countError;
  if ((count ?? 0) >= MAX_SAVED_ITINERARIES) throw new Error(`You can keep up to ${MAX_SAVED_ITINERARIES} saved plans. Delete an older one first.`);
  const title = `${itinerary.title} · ${itinerary.stops.map((stop) => stop.name).slice(0, 2).join(", ")}${itinerary.stops.length > 2 ? "…" : ""}`.slice(0, 200);
  const { data, error } = await client.from("nyc_itineraries").insert({ user_id: userId, title, plan_mode: planMode, itinerary_json: itinerary }).select("id, title, plan_mode, itinerary_json, created_at").single();
  if (error) throw error;
  return { id: data.id, title: data.title, planMode: data.plan_mode, itinerary: data.itinerary_json as Itinerary, createdAt: data.created_at };
}

export async function deleteItinerary(userId: string, id: string) {
  const { error, count } = await db().from("nyc_itineraries").delete({ count: "exact" }).eq("id", id).eq("user_id", userId);
  if (error) throw error;
  if (!count) throw new Error("That plan wasn't found, or it isn't yours.");
}

export async function getPreferences(userId: string): Promise<NycPreferences | null> {
  const { data, error } = await db().from("nyc_user_preferences").select("total_budget_usd, party_size, interests, transport_preference, walking_preference, dining, updated_at").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { totalBudgetUsd: data.total_budget_usd, partySize: data.party_size, interests: data.interests, transportPreference: data.transport_preference, walkingPreference: data.walking_preference, dining: data.dining, updatedAt: data.updated_at };
}

export async function savePreferences(userId: string, preferences: NycPreferences) {
  const { error } = await db().from("nyc_user_preferences").upsert({
    user_id: userId,
    total_budget_usd: preferences.totalBudgetUsd,
    party_size: preferences.partySize,
    interests: preferences.interests,
    transport_preference: preferences.transportPreference,
    walking_preference: preferences.walkingPreference,
    dining: preferences.dining,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) throw error;
}

export async function getProfile(userId: string, email: string | null): Promise<NycProfile> {
  const { data, error } = await db().from("profiles").select("display_name, avatar_emoji").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return { displayName: data?.display_name ?? null, avatarEmoji: data?.avatar_emoji ?? null, email };
}

export async function saveProfile(userId: string, displayName: string) {
  const { error } = await db().from("profiles").update({ display_name: displayName, updated_at: new Date().toISOString() }).eq("user_id", userId);
  if (error) throw error;
}

export type FeedbackInput = { itineraryId: string; rating: "helpful" | "not_helpful"; satisfactionScore?: number; trustScore?: number; issueType?: string; note?: string; itineraryVersion?: string; dataVersionId?: string };

const memoryFeedback: Array<FeedbackInput & { createdAt: string }> = [];

/** Persists to nyc_feedback when Supabase is configured; otherwise keeps a labelled in-memory copy. */
export async function saveFeedback(userId: string | null, input: FeedbackInput) {
  if (!supabase) {
    memoryFeedback.unshift({ ...input, createdAt: new Date().toISOString() });
    return { persisted: false, storage: "memory" as const };
  }
  const { error } = await supabase.from("nyc_feedback").insert({
    user_id: userId,
    itinerary_id: input.itineraryId,
    rating: input.rating,
    satisfaction_score: input.satisfactionScore ?? null,
    trust_score: input.trustScore ?? null,
    issue_type: input.issueType ?? null,
    note: input.note ?? null,
    itinerary_version: input.itineraryVersion ?? null,
    data_version_id: input.dataVersionId ?? null,
  });
  if (error) throw error;
  return { persisted: true, storage: "supabase" as const };
}

export async function listFeedback() {
  if (!supabase) return memoryFeedback.slice(0, 20);
  const { data, error } = await supabase.from("nyc_feedback").select("itinerary_id, rating, satisfaction_score, trust_score, issue_type, note, itinerary_version, data_version_id, created_at").order("created_at", { ascending: false }).limit(20);
  if (error) throw error;
  return (data ?? []).map((row) => ({ itineraryId: row.itinerary_id, rating: row.rating, satisfactionScore: row.satisfaction_score ?? undefined, trustScore: row.trust_score ?? undefined, issueType: row.issue_type ?? undefined, note: row.note ?? undefined, itineraryVersion: row.itinerary_version ?? undefined, dataVersionId: row.data_version_id ?? undefined, createdAt: row.created_at }));
}
