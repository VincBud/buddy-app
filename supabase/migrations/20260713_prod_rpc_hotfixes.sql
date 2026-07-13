-- Versioning of production hotfixes applied manually in Supabase.
--
-- These changes were made live in the hosted database to unblock TestFlight and
-- are captured here so the repo matches the deployed state. No new logic is
-- introduced — this file only mirrors what was already applied in production.
--
-- 1. public.review_job_application  — fix "column reference id is ambiguous"
--    The RETURNS TABLE output columns (id / job_id / status) shadow the same-named
--    columns of public.job_applications and public.jobs. Every id/status/job_id
--    reference in the UPDATE / SELECT / RETURN QUERY statements is now qualified
--    with a table alias so it is unambiguous. Signature and behaviour unchanged.
--
-- 2. public.set_job_location        — search_path fix
--    PostGIS was relocated to the `extensions` schema, so ST_SetSRID / ST_MakePoint
--    and the geography type were no longer resolvable. search_path now includes
--    `extensions`. Body unchanged.
--
-- 3. public.nearby_open_jobs        — same PostGIS search_path fix (ST_Distance,
--    ST_DWithin, geography). Body unchanged.

-- ── 1. review_job_application: qualify all ambiguous column references ─────────

CREATE OR REPLACE FUNCTION public.review_job_application(
  p_job_id uuid,
  p_buddy_id uuid,
  p_decision text
)
RETURNS TABLE (
  id uuid,
  job_id uuid,
  buddy_id uuid,
  status text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner_id uuid;
BEGIN
  -- Verify job exists and caller is the owner
  SELECT j.creator_id INTO v_owner_id
    FROM public.jobs j WHERE j.id = p_job_id;

  IF NOT FOUND OR v_owner_id IS NULL THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_owner_id != auth.uid() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'P0001';
  END IF;

  -- Rate limit: 60 review decisions per hour per owner (M-1 protection)
  IF NOT public.check_rate_limit(auth.uid(), 'job_review', 60, 3600) THEN
    RAISE EXCEPTION 'rate_limit_exceeded' USING ERRCODE = 'P0001';
  END IF;

  -- Identity verification required (Phase 1)
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.identity_verified_at IS NOT NULL
      AND p.verification_status = 'approved'
  ) THEN
    RAISE EXCEPTION 'identity_verification_required' USING ERRCODE = 'P0001';
  END IF;

  -- Update the application row to reflect the decision.
  -- The `ja` alias qualifies job_id / status so they are never ambiguous against
  -- the RETURNS TABLE output columns of the same name.
  UPDATE public.job_applications AS ja
     SET status = CASE
           WHEN p_decision = 'accepted' THEN 'accepted'
           WHEN p_decision = 'rejected' THEN 'rejected'
           ELSE ja.status
         END,
         updated_at = now()
   WHERE ja.job_id = p_job_id
     AND ja.buddy_id = p_buddy_id;

  -- If accepting: flip parent jobs row to 'matched' + record assigned buddy
  IF p_decision = 'accepted' THEN
    UPDATE public.jobs AS j
       SET status            = 'matched',
           assigned_buddy_id = p_buddy_id,
           updated_at        = now()
     WHERE j.id = p_job_id
       AND j.status IN ('open', 'paused');

    -- Atomically reject all other pending applications for this job
    UPDATE public.job_applications AS ja
       SET status = 'rejected',
           updated_at = now()
     WHERE ja.job_id = p_job_id
       AND ja.buddy_id != p_buddy_id
       AND ja.status = 'pending';
  END IF;

  -- Return the updated application row
  RETURN QUERY
  SELECT ja.id, ja.job_id, ja.buddy_id, ja.status, ja.created_at, ja.updated_at
    FROM public.job_applications ja
   WHERE ja.job_id = p_job_id
     AND ja.buddy_id = p_buddy_id;
END;
$$;

-- ── 2. set_job_location: add `extensions` to search_path (PostGIS moved) ───────

ALTER FUNCTION public.set_job_location(uuid, double precision, double precision, text, text, text)
  SET search_path TO 'public', 'extensions', 'pg_temp';

-- ── 3. nearby_open_jobs: add `extensions` to search_path (PostGIS moved) ───────

ALTER FUNCTION public.nearby_open_jobs(double precision, double precision, double precision, integer, integer)
  SET search_path TO public, extensions, pg_temp;

-- ── Reload PostgREST schema so the updated RPCs are immediately callable ───────

NOTIFY pgrst, 'reload schema';
