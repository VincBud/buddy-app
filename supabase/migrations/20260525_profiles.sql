-- Auditable schema, GRANTs, and RLS for public.profiles.
--
-- Background: the profiles table predates the migration system. This migration
-- documents the expected schema and enforces security without touching existing
-- data. Every statement is safe to run against a live database.
--
-- Columns confirmed from services/profiles.service.ts and app usage:
--   id               uuid  PK, FK → auth.users(id) ON DELETE CASCADE
--   username         text  derived from email prefix on first sign-in
--   avatar_url       text  local device URI for now; Storage upload is future
--   bio              text  freeform about-me text
--   skills           text[] buddy skill tags (≥3 required to complete onboarding)
--   radius_km        numeric geographic search radius
--   discovery_source text  how the user heard about the app
--   created_at       timestamptz audit timestamp (added here if missing)
--
-- Public profile reads: NOT required. Every read in the current codebase
-- queries id = auth.uid() (own profile only). Cross-user profile access is not
-- implemented. If buddy profile discovery is added later, a separate targeted
-- policy should be created with explicit column restrictions.
--
-- RLS design: owner-only SELECT / INSERT / UPDATE. No DELETE policy — profile
-- rows are removed automatically via ON DELETE CASCADE when auth.users is
-- deleted by Supabase Auth.

-- ── Schema ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE
);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username         text,
  ADD COLUMN IF NOT EXISTS avatar_url       text,
  ADD COLUMN IF NOT EXISTS bio              text,
  ADD COLUMN IF NOT EXISTS skills           text[],
  ADD COLUMN IF NOT EXISTS radius_km        numeric,
  ADD COLUMN IF NOT EXISTS discovery_source text,
  ADD COLUMN IF NOT EXISTS created_at       timestamptz NOT NULL DEFAULT now();

-- ── GRANTs ────────────────────────────────────────────────────────────────────

-- anon has no access — profiles are never publicly queryable without auth.
REVOKE ALL ON public.profiles FROM anon;

-- authenticated may read, create, and update their own row.
-- No DELETE grant — cascade from auth.users handles cleanup.
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- SELECT: users may read only their own profile row.
-- getProfile(userId) always calls with userId = auth.uid().
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  USING (public.profiles.id = auth.uid());

-- INSERT: users may only insert a row whose id equals their own uid.
-- ensureProfile() uses upsert with ignoreDuplicates; the INSERT path is
-- gated here, and the ON CONFLICT DO NOTHING path requires no UPDATE.
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  WITH CHECK (public.profiles.id = auth.uid());

-- UPDATE: users may only update their own row.
-- USING restricts which rows can be targeted; WITH CHECK ensures the id
-- is not changed to another user's uid after the update.
-- updateProfile(data) derives userId from auth.uid() internally; caller cannot specify userId.
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING  (public.profiles.id = auth.uid())
  WITH CHECK (public.profiles.id = auth.uid());
