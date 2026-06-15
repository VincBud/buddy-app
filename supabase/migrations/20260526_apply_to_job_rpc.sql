-- RPC: public.apply_to_job
--
-- Replaces the direct PostgREST INSERT into job_applications that was failing
-- with 42804 (datatype_mismatch). Root cause: PostgREST infers parameter types
-- from its schema cache; even after NOTIFY pgrst 'reload schema', the JS client
-- library sends JSON string values with an explicit ::text annotation in the
-- extended query protocol. PostgreSQL has no implicit text→uuid cast, so the
-- assignment fails even though the string is a valid UUID.
--
-- Fix: a SECURITY DEFINER function whose signature declares p_job_id as uuid.
-- PostgreSQL casts the JSON string to uuid at the call boundary — no type
-- mismatch. The function inserts using the typed parameter directly.
--
-- Security model:
--   - buddy_id is derived from auth.uid() inside the function; the client
--     cannot supply a different buddy_id.
--   - buddy_name is derived server-side by trg_sanitize_job_application_reputation
--     from public.profiles.username; client-supplied p_buddy_name is ignored.
--   - SECURITY DEFINER runs as the function owner (postgres, BYPASSRLS) so the
--     INSERT succeeds regardless of the RLS INSERT policy on job_applications.
--     The policy guard_job_application_finalized BEFORE trigger still enforces
--     the "cannot re-apply to a finalised application" invariant.
--   - The AFTER INSERT trigger notify_job_application_changes fires normally
--     because the INSERT goes through the standard table write path.
--   - A buddy cannot apply to their own job (guard: p_buddy_id ≠ creator_id).
--   - A buddy cannot apply to a non-open job (guard: status = 'open').

CREATE OR REPLACE FUNCTION public.apply_to_job(
  p_job_id    uuid,
  p_buddy_name text DEFAULT ''
)
RETURNS TABLE (
  id                   uuid,
  job_id               uuid,
  buddy_id             uuid,
  buddy_name           text,
  buddy_score          numeric,
  buddy_rating_average numeric,
  buddy_rating_count   integer,
  buddy_completed_jobs integer,
  buddy_reliability    text,
  status               text,
  created_at           timestamptz,
  updated_at           timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p_buddy_id uuid := auth.uid();
  v_job_status  text;
  v_creator_id  uuid;
BEGIN
  -- Caller must be authenticated
  IF p_buddy_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  -- Validate job exists and is open
  SELECT j.status, j.creator_id
    INTO v_job_status, v_creator_id
    FROM public.jobs j
   WHERE j.id = p_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_job_status NOT IN ('open', 'active') THEN
    RAISE EXCEPTION 'job_not_open' USING ERRCODE = 'P0001';
  END IF;

  -- A buddy cannot apply to their own job
  IF v_creator_id = p_buddy_id THEN
    RAISE EXCEPTION 'cannot_apply_to_own_job' USING ERRCODE = 'P0001';
  END IF;

  -- Rate limit: 30 applications per hour per user (M-1 protection)
  IF NOT public.check_rate_limit(p_buddy_id, 'job_apply', 30, 3600) THEN
    RAISE EXCEPTION 'rate_limit_exceeded' USING ERRCODE = 'P0001';
  END IF;

  -- Identity verification required (Phase 1)
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_buddy_id
      AND p.identity_verified_at IS NOT NULL
      AND p.verification_status = 'approved'
  ) THEN
    RAISE EXCEPTION 'identity_verification_required' USING ERRCODE = 'P0001';
  END IF;

  -- Insert; trg_guard_job_application_finalized fires first (BEFORE INSERT),
  -- then trg_sanitize_job_application_reputation, then the row is committed,
  -- then trg_notify_job_application_changes fires (AFTER INSERT).
  RETURN QUERY
  INSERT INTO public.job_applications
    (job_id, buddy_id, buddy_name, status)
  VALUES
    (p_job_id, p_buddy_id, COALESCE(p_buddy_name, ''), 'pending')
  RETURNING
    job_applications.id,
    job_applications.job_id,
    job_applications.buddy_id,
    job_applications.buddy_name,
    job_applications.buddy_score,
    job_applications.buddy_rating_average,
    job_applications.buddy_rating_count,
    job_applications.buddy_completed_jobs,
    job_applications.buddy_reliability,
    job_applications.status,
    job_applications.created_at,
    job_applications.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_to_job(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_to_job(uuid, text) TO authenticated;

-- postgres role has BYPASSRLS; SECURITY DEFINER as postgres owner lets the
-- function INSERT without being blocked by the RLS INSERT policy.
ALTER FUNCTION public.apply_to_job(uuid, text) OWNER TO postgres;

-- Reload PostgREST schema so the new RPC is immediately callable
NOTIFY pgrst, 'reload schema';
