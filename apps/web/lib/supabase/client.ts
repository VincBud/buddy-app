"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Browser-side Supabase client for the landing page.
// Only the anon (publishable) key is used here — never the service role.
// The waitlist insert is allowed via an RLS INSERT policy on
// public.landing_waitlist for anon + authenticated roles.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

let cached: SupabaseClient | null = null;

export const getSupabaseBrowserClient = (): SupabaseClient => {
  if (cached) return cached;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Supabase env vars are missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local."
    );
  }
  cached = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
};
