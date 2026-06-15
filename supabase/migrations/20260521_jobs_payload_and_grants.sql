-- Phase 1 patch: align jobs table with app expectations.
-- Safe to run multiple times (all statements are idempotent).

-- 1. Add `title` column used by the app as a convenience search field.
--    The full job content lives in `payload`; title mirrors payload.problem.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '';

-- 2. Ensure the payload column is not null for older rows.
UPDATE public.jobs SET payload = '{}' WHERE payload IS NULL;

-- 3. GRANTs required for Supabase Data API (PostgREST) access.
--    RLS policies are irrelevant without these table-level grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jobs             TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_applications TO authenticated;

-- 4. Add missing buddy snapshot columns to job_applications.
--    These are sent by the app on every application upsert.
ALTER TABLE public.job_applications ADD COLUMN IF NOT EXISTS buddy_score          numeric;
ALTER TABLE public.job_applications ADD COLUMN IF NOT EXISTS buddy_rating_average numeric;
ALTER TABLE public.job_applications ADD COLUMN IF NOT EXISTS buddy_rating_count   integer;
ALTER TABLE public.job_applications ADD COLUMN IF NOT EXISTS buddy_completed_jobs integer;
ALTER TABLE public.job_applications ADD COLUMN IF NOT EXISTS buddy_reliability    text;

-- 5. GIN index on payload for future JSONB queries (dashboard / search).
CREATE INDEX IF NOT EXISTS jobs_payload_idx ON public.jobs USING gin (payload);

-- 6. Ensure RLS remains enabled (idempotent).
ALTER TABLE public.jobs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_applications ENABLE ROW LEVEL SECURITY;
