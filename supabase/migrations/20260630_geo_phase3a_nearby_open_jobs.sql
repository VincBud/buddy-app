-- Geo-Matching — Phase 3A: secure "nearby open jobs" RPC.
--
-- This is the ONLY feed-safe way to expose proximity. Exact coordinates remain
-- private in public.job_locations (no anon/authenticated grant); this function
-- runs SECURITY DEFINER (owned by postgres) so it can read that side-table, but
-- it returns ONLY a rounded distance_km plus coarse display fields
-- (city / postal_code / geo_precision). It NEVER returns raw lat/lng or the geo
-- geography. Jobs without a location row are not returned.
--
-- Privacy invariants enforced here:
--   * status = 'open' only
--   * creator's own jobs excluded
--   * jobs the caller already applied to excluded
--   * radius bounded server-side (≤ 50 km)
--   * no exact coordinates in the result set
--
-- This migration is database-only: no app/service changes, no jobs RLS changes,
-- no job_locations grant changes, and set_job_location is untouched.

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
SET search_path = public, pg_temp
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
  WHERE j.status = 'open'
    AND j.creator_id <> v_user_id                       -- never your own jobs
    AND ST_DWithin(jl.geo, v_origin, p_radius_km * 1000) -- within radius (metres)
    AND NOT EXISTS (                                    -- not already applied to
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

-- postgres has BYPASSRLS; SECURITY DEFINER as the postgres owner lets the
-- function read the private job_locations side-table. Clients still cannot
-- select job_locations directly — this RPC only ever emits a rounded distance
-- and coarse city/postal_code/precision, never raw coordinates.
ALTER FUNCTION public.nearby_open_jobs(double precision, double precision, double precision, integer, integer) OWNER TO postgres;

-- ── Reload PostgREST schema so the RPC is immediately callable ─────────────────

NOTIFY pgrst, 'reload schema';
