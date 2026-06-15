/**
 * Profiles service — thin wrapper around the Supabase `profiles` table.
 *
 * The `profiles` table extends auth.users (id FK → auth.users.id).
 * RLS policy: auth.uid() = id — all writes must use the authenticated user's id.
 *
 * DB columns: id, username, avatar_url, bio, skills, radius_km, discovery_source
 */
import { supabase } from '../lib/supabase/client';

export type Profile = {
  id: string;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  skills: string[] | null;
  radius_km: number | null;
  discovery_source: string | null;
  identity_verified_at: string | null;
  verification_status:
    | 'not_started' | 'pending' | 'approved' | 'rejected' | 'manual_review' | 'expired'
    | null;
};

/**
 * Fetch profile row for userId. Returns null if not found or on error.
 */
export const getProfile = async (userId: string): Promise<Profile | null> => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, avatar_url, bio, skills, radius_km, discovery_source, identity_verified_at, verification_status')
      .eq('id', userId)
      .single();
    if (error || !data) return null;
    return data as Profile;
  } catch {
    return null;
  }
};

/**
 * Create profile row if it doesn't exist yet.
 * Uses upsert with ignoreDuplicates to avoid overwriting existing data.
 * Safe to call multiple times (idempotent).
 */
export const ensureProfile = async (user: {
  id: string;
  email?: string | undefined;
}): Promise<void> => {
  try {
    const username = user.email ? user.email.split('@')[0] : null;
    await supabase.from('profiles').upsert(
      { id: user.id, username, avatar_url: null },
      { onConflict: 'id', ignoreDuplicates: true }
    );
  } catch {
    // Non-fatal — app works without the profile row
  }
};

/**
 * Update mutable profile fields for the authenticated user only.
 * Security: userId is derived from auth.uid(); caller cannot specify a different user.
 * RLS policy profiles_update_own enforces auth.uid() = id as an additional layer.
 * Only writes columns that exist in the DB; keeps app working if columns are absent.
 * avatar_url stores a local device URI for now — Supabase Storage upload is a future step.
 */
export const updateProfile = async (data: {
  username?: string;
  avatar_url?: string | null;
  bio?: string | null;
  skills?: string[] | null;
  radius_km?: number | null;
  discovery_source?: string | null;
}): Promise<void> => {
  try {
    const { data: authUser } = await supabase.auth.getUser();
    if (!authUser.user?.id) {
      console.warn('[profiles.service] updateProfile: user not authenticated');
      return;
    }
    await supabase.from('profiles').update(data).eq('id', authUser.user.id);
  } catch {
    // Non-fatal — local state is the source of truth until full migration
  }
};
