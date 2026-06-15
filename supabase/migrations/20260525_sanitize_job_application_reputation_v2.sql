-- Upgrade sanitize_job_application_reputation() to snapshot authoritative
-- reputation data from public.reviews on INSERT into job_applications.
--
-- Previously all five reputation fields were set to NULL (placeholder strategy).
-- public.reviews now exists, so buddy_rating_average and buddy_rating_count
-- can be derived from it at insert time.
--
-- Fields now authoritative (sourced from public.reviews):
--   buddy_rating_average  — ROUND(AVG(rating), 2) from reviews WHERE reviewee_id = buddy_id
--   buddy_rating_count    — COUNT(*) from reviews WHERE reviewee_id = buddy_id
--
-- Fields still placeholder (no authoritative DB source yet):
--   buddy_score           — NULL (no scoring table)
--   buddy_completed_jobs  — NULL (no completed-jobs counter table)
--   buddy_reliability     — NULL (no reliability-tier table)
--
-- The SECURITY DEFINER + SET search_path guarantee:
--   - RLS on public.reviews is bypassed so we aggregate across ALL reviews
--     for the buddy, not just those visible to the inserting user.
--   - Client-supplied values in those columns are unconditionally overwritten.
--
-- Trigger order is unchanged (alphabetical BEFORE INSERT on job_applications):
--   1. trg_guard_job_application_finalized
--   2. trg_sanitize_job_application_reputation  ← this function

CREATE OR REPLACE FUNCTION public.sanitize_job_application_reputation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- ── Authoritative: derived from public.reviews ────────────────────────────
  SELECT
    ROUND(AVG(r.rating)::numeric, 2),
    COUNT(*)::integer
  INTO
    NEW.buddy_rating_average,
    NEW.buddy_rating_count
  FROM public.reviews r
  WHERE r.reviewee_id = NEW.buddy_id;

  -- COUNT(*) returns 0 for no rows; keep average NULL when there are no reviews.
  IF NEW.buddy_rating_count = 0 THEN
    NEW.buddy_rating_average := NULL;
  END IF;

  -- ── Placeholder: no authoritative DB source yet ───────────────────────────
  NEW.buddy_score          := NULL;
  NEW.buddy_completed_jobs := NULL;
  NEW.buddy_reliability    := NULL;

  -- buddy_name: derive from authoritative profiles.username (never trust client)
  NEW.buddy_name := COALESCE(
    (SELECT username FROM public.profiles WHERE id = NEW.buddy_id),
    ''
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sanitize_job_application_reputation() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_sanitize_job_application_reputation
  ON public.job_applications;

CREATE TRIGGER trg_sanitize_job_application_reputation
  BEFORE INSERT ON public.job_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.sanitize_job_application_reputation();
