import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client (secret / service-role key). Never import this
 * from a client component. Keys come from .env.local (dev) or runtime secrets.
 */
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabase = url && serviceKey ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
