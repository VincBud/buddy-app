-- Fix schema mismatches discovered during A/B testing.
--
-- Issue 1: public.job_applications.buddy_name
--   The deployed table is missing this column (or it was never committed).
--   jobs.service inserts buddy_name; PostgREST returns a schema-cache error
--   and the entire application insert fails, preventing the DB trigger from
--   firing and the job owner from receiving a notification.
--
-- Issue 2: public.jobs INSERT failures
--   jobs.service.ts previously tried to insert description/price/time_mode/
--   radius_km columns that do not exist in the deployed schema. Those columns
--   have been removed from the TypeScript layer (all content lives in payload).
--   No SQL change needed for this issue.
--
-- Issue 3: public.job_applications.id type
--   The deployed column is uuid (gen_random_uuid()). The client was sending
--   a composite "jobId_buddyId" string which is not a valid uuid. Fixed in the
--   TypeScript layer — id is no longer sent; the DB generates it.
--   No SQL change needed for this issue.
--
-- Grants are restated for safety in case they were lost in a prior partial run.

-- ── job_applications: add buddy_name if missing ────────────────────────────────

ALTER TABLE public.job_applications
  ADD COLUMN IF NOT EXISTS buddy_name text NOT NULL DEFAULT '';

-- ── Grants (idempotent) ────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jobs             TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_applications TO authenticated;

-- ── RLS (idempotent) ──────────────────────────────────────────────────────────

ALTER TABLE public.jobs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_applications ENABLE ROW LEVEL SECURITY;
