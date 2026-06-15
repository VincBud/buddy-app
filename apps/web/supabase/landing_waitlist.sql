-- Buddy landing page — waitlist table.
--
-- Apply manually in the Supabase SQL editor for the same project the mobile
-- app uses (so NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY can
-- write here from the browser via RLS). This file is intentionally NOT in
-- /supabase/migrations so it stays isolated from the mobile-app migration
-- chain.

CREATE TABLE IF NOT EXISTS public.landing_waitlist (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(btrim(name))  BETWEEN 1 AND 120),
  email       text NOT NULL CHECK (length(btrim(email)) BETWEEN 3 AND 254),
  city        text          CHECK (city  IS NULL OR length(city)  <= 120),
  role        text          CHECK (role  IS NULL OR role IN (
                  'user', 'buddy', 'both', 'investor', 'press', 'other'
                )),
  message     text          CHECK (message IS NULL OR length(message) <= 2000),
  source      text          DEFAULT 'landing_page',
  created_at  timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS landing_waitlist_created_at_idx
  ON public.landing_waitlist (created_at DESC);
CREATE INDEX IF NOT EXISTS landing_waitlist_email_idx
  ON public.landing_waitlist (lower(email));

-- RLS: anyone may submit; nobody may read. Service role (used by the
-- Supabase dashboard / a future ops tool) bypasses RLS and can read.
ALTER TABLE public.landing_waitlist ENABLE ROW LEVEL SECURITY;

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

-- No SELECT/UPDATE/DELETE policies — full denial by default for anon and
-- authenticated. service_role retains full access via BYPASSRLS.

GRANT INSERT ON public.landing_waitlist TO anon;
GRANT INSERT ON public.landing_waitlist TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.landing_waitlist TO service_role;

NOTIFY pgrst, 'reload schema';
