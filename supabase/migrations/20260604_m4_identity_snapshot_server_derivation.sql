-- M-4 Security Fix: Server-side derivation of identity snapshot fields
--
-- Finding: buddy_name and all other identity snapshot fields were previously
-- derived from client-supplied values. This violates the principle of deriving
-- all identity data from authoritative server sources.
--
-- Fix: Move buddy_name derivation to the server-side trigger
-- trg_sanitize_job_application_reputation. The client now only supplies buddy_id;
-- the server derives buddy_name from profiles.username.
--
-- Backward compatibility: The apply_to_job RPC still accepts p_buddy_name for
-- compatibility, but the value is ignored. The BEFORE INSERT trigger unconditionally
-- overwrites it with the authoritative value from profiles.username.

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
