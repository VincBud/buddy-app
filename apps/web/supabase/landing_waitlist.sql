-- Buddy landing page — public.landing_waitlist (waitlist) table definition.
--
-- This file mirrors the VERIFIED PRODUCTION STATE of the Supabase project
-- (region eu-central-2, Zürich). It is intentionally NOT placed in
-- /supabase/migrations so it stays isolated from the mobile-app migration
-- chain and so re-running it never affects unrelated tables.
--
-- The script is idempotent:
--   * Safe to apply against an empty database (creates the table from scratch).
--   * Safe to apply against the live, already-cleaned production database
--     (re-asserts every check/grant/policy without raising errors).
--
-- Apply manually in the Supabase SQL editor:
--   Project → SQL editor → paste this file → Run.

-- ── 1. Table ────────────────────────────────────────────────────────────────
-- Fresh installs get the canonical shape directly.

CREATE TABLE IF NOT EXISTS public.landing_waitlist (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text,
  email       text NOT NULL,
  city        text,
  role        text,
  message     text,
  source      text        DEFAULT 'landing_page',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 2. Column nullability ──────────────────────────────────────────────────
-- Bring an already-existing table into line with the canonical schema.
-- DROP NOT NULL is a no-op when the column is already nullable.

ALTER TABLE public.landing_waitlist ALTER COLUMN name DROP NOT NULL;

-- ── 3. CHECK constraints (DROP-then-ADD so the file is authoritative) ─────
-- Postgres has no CREATE CONSTRAINT IF NOT EXISTS prior to v17; the
-- DROP IF EXISTS / ADD pattern is the standard idempotent workaround.

ALTER TABLE public.landing_waitlist DROP CONSTRAINT IF EXISTS landing_waitlist_name_check;
ALTER TABLE public.landing_waitlist DROP CONSTRAINT IF EXISTS landing_waitlist_email_check;
ALTER TABLE public.landing_waitlist DROP CONSTRAINT IF EXISTS landing_waitlist_city_check;
ALTER TABLE public.landing_waitlist DROP CONSTRAINT IF EXISTS landing_waitlist_role_check;
ALTER TABLE public.landing_waitlist DROP CONSTRAINT IF EXISTS landing_waitlist_message_check;
ALTER TABLE public.landing_waitlist DROP CONSTRAINT IF EXISTS landing_waitlist_source_check;

ALTER TABLE public.landing_waitlist
  ADD CONSTRAINT landing_waitlist_name_check
    CHECK (name IS NULL OR length(name) <= 120);

-- Length cap + basic email pattern. The regex enforces "<local>@<domain>.<tld>"
-- without whitespace; it is intentionally permissive enough not to reject
-- legitimate addresses (e.g. plus-tags, subdomains) but blocks obvious junk.
ALTER TABLE public.landing_waitlist
  ADD CONSTRAINT landing_waitlist_email_check
    CHECK (
      email IS NOT NULL
      AND length(email) <= 254
      AND email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    );

ALTER TABLE public.landing_waitlist
  ADD CONSTRAINT landing_waitlist_city_check
    CHECK (city IS NULL OR length(city) <= 120);

-- Production-canonical role taxonomy. Note: the landing-page form currently
-- ships an older set of role labels; the client values must be remapped to
-- this taxonomy in a follow-up UI sync (out of scope for this SQL file).
ALTER TABLE public.landing_waitlist
  ADD CONSTRAINT landing_waitlist_role_check
    CHECK (
      role IS NULL
      OR role IN ('job_creator', 'buddy', 'both', 'partner', 'investor', 'other')
    );

ALTER TABLE public.landing_waitlist
  ADD CONSTRAINT landing_waitlist_message_check
    CHECK (message IS NULL OR length(message) <= 2000);

ALTER TABLE public.landing_waitlist
  ADD CONSTRAINT landing_waitlist_source_check
    CHECK (source IS NULL OR source = 'landing_page');

-- ── 4. Indexes ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS landing_waitlist_created_at_idx
  ON public.landing_waitlist (created_at DESC);

CREATE INDEX IF NOT EXISTS landing_waitlist_email_idx
  ON public.landing_waitlist (lower(email));

-- ── 5. Row Level Security ──────────────────────────────────────────────────
-- Enable RLS, then drop EVERY policy that could exist on this table
-- (including the legacy broad "Anyone can join landing waitlist" policy
-- some early environments shipped) before re-creating only the two
-- production-approved INSERT policies.

ALTER TABLE public.landing_waitlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can join landing waitlist"      ON public.landing_waitlist;
DROP POLICY IF EXISTS "landing_waitlist_insert_anon"          ON public.landing_waitlist;
DROP POLICY IF EXISTS "landing_waitlist_insert_authenticated" ON public.landing_waitlist;

CREATE POLICY "landing_waitlist_insert_anon"
  ON public.landing_waitlist FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "landing_waitlist_insert_authenticated"
  ON public.landing_waitlist FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Intentionally NO SELECT, UPDATE or DELETE policies for anon/authenticated.
-- Postgres defaults to "deny" when no matching policy exists, so reads,
-- updates and deletes from these roles are blocked.
-- service_role bypasses RLS via BYPASSRLS and retains full access.

-- ── 6. GRANTs ──────────────────────────────────────────────────────────────
-- Authoritative: revoke everything first, then grant only what is approved.
-- This neutralises any default-privileges leftovers or earlier broad grants
-- without having to know the prior state.

REVOKE ALL ON public.landing_waitlist FROM PUBLIC;
REVOKE ALL ON public.landing_waitlist FROM anon;
REVOKE ALL ON public.landing_waitlist FROM authenticated;

GRANT INSERT ON public.landing_waitlist TO anon;
GRANT INSERT ON public.landing_waitlist TO authenticated;

-- Preserve service_role's full table access (matches verified production
-- grants: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE).
GRANT ALL ON public.landing_waitlist TO service_role;

-- ── 7. PostgREST schema reload ─────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';
