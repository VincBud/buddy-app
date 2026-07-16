-- Public feed hardening + assigned-job data repair.
--
-- Bug: jobs that were already assigned to a helper could still surface in the
-- public nearby feed. Two causes:
--   1. nearby_open_jobs only filtered `status = 'open'` — it did not also exclude
--      jobs that already have an assigned helper or an accepted application. A
--      job left in an inconsistent state (open + assigned) therefore leaked.
--   2. Historical inconsistent rows exist (from the earlier review_job_application
--      "ambiguous id" failure): jobs still 'open' although a helper was assigned
--      or an application was accepted.
--
-- This migration:
--   A. Re-defines nearby_open_jobs with defense-in-depth exclusions so the DB is
--      the source of truth for public availability. Signature, grants, owner and
--      search_path are unchanged. No raw coordinates are ever returned.
--   B. Repairs the inconsistent historical rows to 'matched' so they leave the
--      public feed while remaining fully accessible to owner + assigned helper
--      (RLS unchanged — jobs_read_assigned already covers the helper).
--
-- RLS is NOT modified: owner (creator_id) and assigned helper (assigned_buddy_id)
-- keep full read access to their own job through existing policies.

-- ── A. Harden the public feed RPC ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.nearby_open_jobs(
  p_lat       double precision,
  p_lng       double precision,
  p_radius_km double precision DEFAULT 20,
  p_limit     integer          DEFAULT 50,
  p_offset    integer          DEFAULT 0
)
RETURNS TABLE (
  id            uuid,
  creator_id    uuid,
  title         text,
  description   text,
  price         text,
  time_mode     text,
  radius_km     numeric,
  category      text,
  status        text,
  expires_at    timestamptz,
  created_at    timestamptz,
  updated_at    timestamptz,
  payload       jsonb,
  distance_km   double precision,
  city          text,
  postal_code   text,
  geo_precision text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_origin  geography;
BEGIN
  -- Authentication
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  -- Input validation
  IF p_lat IS NULL OR p_lat < -90 OR p_lat > 90 THEN
    RAISE EXCEPTION 'invalid_latitude' USING ERRCODE = 'P0001';
  END IF;
  IF p_lng IS NULL OR p_lng < -180 OR p_lng > 180 THEN
    RAISE EXCEPTION 'invalid_longitude' USING ERRCODE = 'P0001';
  END IF;
  IF p_radius_km IS NULL OR p_radius_km <= 0 OR p_radius_km > 50 THEN
    RAISE EXCEPTION 'invalid_radius' USING ERRCODE = 'P0001';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'invalid_limit' USING ERRCODE = 'P0001';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'invalid_offset' USING ERRCODE = 'P0001';
  END IF;

  -- Caller's search origin (PostGIS point order is (lng, lat)).
  v_origin := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;

  RETURN QUERY
  SELECT
    j.id,
    j.creator_id,
    j.title,
    j.description::text,
    j.price::text,
    j.time_mode::text,
    j.radius_km::numeric,
    j.category::text,
    j.status::text,
    j.expires_at,
    j.created_at,
    j.updated_at,
    j.payload,
    round((ST_Distance(jl.geo, v_origin) / 1000.0)::numeric, 2)::double precision AS distance_km,
    jl.city,
    jl.postal_code,
    jl.geo_precision
  FROM public.jobs j
  JOIN public.job_locations jl ON jl.job_id = j.id      -- only jobs WITH a location
  WHERE j.status = 'open'                                -- exactly open (never matched/active/completed/expired/cancelled)
    AND j.assigned_buddy_id IS NULL                      -- never a job that already has a helper
    AND j.creator_id <> v_user_id                        -- never your own jobs
    AND ST_DWithin(jl.geo, v_origin, p_radius_km * 1000) -- within radius (metres)
    AND NOT EXISTS (                                     -- never a job with an accepted application
      SELECT 1 FROM public.job_applications acc
       WHERE acc.job_id = j.id
         AND acc.status = 'accepted'
    )
    AND NOT EXISTS (                                     -- not already applied to by the caller
      SELECT 1 FROM public.job_applications a
       WHERE a.job_id   = j.id
         AND a.buddy_id = v_user_id
    )
  ORDER BY ST_Distance(jl.geo, v_origin) ASC, j.created_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
END;
$$;

REVOKE ALL    ON FUNCTION public.nearby_open_jobs(double precision, double precision, double precision, integer, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.nearby_open_jobs(double precision, double precision, double precision, integer, integer) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.nearby_open_jobs(double precision, double precision, double precision, integer, integer) TO service_role;
ALTER FUNCTION public.nearby_open_jobs(double precision, double precision, double precision, integer, integer) OWNER TO postgres;

-- ── B. Repair inconsistent assigned-job rows ──────────────────────────────────
-- These are safe, targeted corrections. Only jobs currently 'open' but already
-- assigned/accepted are touched; unrelated history is left untouched.

-- B1. Open jobs that already have an assigned helper → matched.
UPDATE public.jobs j
   SET status = 'matched', updated_at = now()
 WHERE j.status = 'open'
   AND j.assigned_buddy_id IS NOT NULL;

-- B2. Open jobs with an accepted application but no assigned helper → assign the
--     accepted helper and flip to matched (mirrors review_job_application).
UPDATE public.jobs j
   SET assigned_buddy_id = acc.buddy_id,
       status            = 'matched',
       updated_at        = now()
  FROM public.job_applications acc
 WHERE acc.job_id = j.id
   AND acc.status = 'accepted'
   AND j.status = 'open'
   AND j.assigned_buddy_id IS NULL;

-- ── Reload PostgREST schema so the updated RPC is immediately callable ─────────

NOTIFY pgrst, 'reload schema';
