-- Fix: 42804 datatype_mismatch on job_applications INSERT after uuid conversion.
--
-- Root cause: PostgREST schema cache was not refreshed after
-- 20260526_job_applications_uuid.sql converted job_applications.job_id
-- from text → uuid. PostgREST still sends the job_id INSERT parameter
-- with type annotation "text". PostgreSQL rejects the assignment of a
-- text-typed parameter to a uuid column in extended query protocol (42804).
--
-- Fix:
--   1. Verify job_id is uuid (no-op if already correct, loud if not).
--   2. Recreate both BEFORE INSERT trigger functions (forces fresh compilation
--      with the current column types — guards against any stale plan cache).
--   3. NOTIFY pgrst to force PostgREST schema reload.

-- ── 1. Pre-flight: confirm job_id is uuid ────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'job_applications'
       AND column_name  = 'job_id'
       AND data_type    = 'uuid'
  ) THEN
    RAISE EXCEPTION
      'job_applications.job_id is not uuid. Apply 20260526_job_applications_uuid.sql first.';
  END IF;
END;
$$;

-- ── 2. Recreate BEFORE INSERT trigger functions (fresh compilation) ───────────

-- guard_job_application_finalized: no functional change, just forces recompile
-- so its internal plan uses uuid for NEW.job_id instead of any cached text type.
CREATE OR REPLACE FUNCTION public.guard_job_application_finalized()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_status text;
BEGIN
  SELECT status
    INTO v_existing_status
    FROM public.job_applications
   WHERE job_id   = NEW.job_id   -- uuid = uuid after migration
     AND buddy_id = NEW.buddy_id;

  IF FOUND AND v_existing_status IN ('accepted', 'rejected') THEN
    RAISE EXCEPTION 'application_already_finalized'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_job_application_finalized() FROM PUBLIC;

-- sanitize_job_application_reputation v2: no functional change, just recompile.
CREATE OR REPLACE FUNCTION public.sanitize_job_application_reputation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT
    ROUND(AVG(r.rating)::numeric, 2),
    COUNT(*)::integer
  INTO
    NEW.buddy_rating_average,
    NEW.buddy_rating_count
  FROM public.reviews r
  WHERE r.reviewee_id = NEW.buddy_id;

  IF NEW.buddy_rating_count = 0 THEN
    NEW.buddy_rating_average := NULL;
  END IF;

  NEW.buddy_score          := NULL;
  NEW.buddy_completed_jobs := NULL;
  NEW.buddy_reliability    := NULL;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sanitize_job_application_reputation() FROM PUBLIC;

-- ── 3. Reload PostgREST schema cache ─────────────────────────────────────────
-- Tells PostgREST to re-introspect pg_catalog so it knows job_id is uuid
-- and sends INSERT parameters with the correct type binding.

NOTIFY pgrst, 'reload schema';
