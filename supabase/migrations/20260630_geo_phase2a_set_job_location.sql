-- Geo-Matching — Phase 2A: secure job-location write RPC.
--
-- Exact coordinates live ONLY in the private public.job_locations side-table
-- (Phase 1). anon/authenticated have no direct grant on that table; the ONLY
-- supported way for a client to record a job's location is this SECURITY
-- DEFINER RPC, which:
--   - authenticates the caller (auth.uid()),
--   - enforces that only the job's creator may set its location,
--   - validates the inputs,
--   - upserts the geography point into public.job_locations, and
--   - strips any exact lat/lng out of jobs.payload, leaving only a COARSE
--     payload.location_summary (city / postal_code / precision — never lat/lng)
--     so the existing `select('*')` feed can never leak precise coordinates.
--
-- This migration is database-only: no app/service changes, no jobs RLS changes,
-- no job_locations grant changes, and no nearby-jobs RPC.

-- ── RPC: set_job_location() ───────────────────────────────────────────────────
-- Errors (all ERRCODE 'P0001'): not_authenticated, job_id_required,
-- invalid_latitude, invalid_longitude, invalid_geo_precision, city_too_long,
-- postal_code_too_long, job_not_found, not_job_creator.

CREATE OR REPLACE FUNCTION public.set_job_location(
  p_job_id        uuid,
  p_lat           double precision,
  p_lng           double precision,
  p_geo_precision text DEFAULT 'exact',
  p_city          text DEFAULT NULL,
  p_postal_code   text DEFAULT NULL
)
RETURNS public.job_locations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id    uuid := auth.uid();
  v_creator_id uuid;
  v_city       text := nullif(trim(p_city), '');
  v_postal     text := nullif(trim(p_postal_code), '');
  v_row        public.job_locations;
BEGIN
  -- Authentication
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  -- Input validation
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'job_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_lat IS NULL OR p_lat < -90 OR p_lat > 90 THEN
    RAISE EXCEPTION 'invalid_latitude' USING ERRCODE = 'P0001';
  END IF;
  IF p_lng IS NULL OR p_lng < -180 OR p_lng > 180 THEN
    RAISE EXCEPTION 'invalid_longitude' USING ERRCODE = 'P0001';
  END IF;
  IF p_geo_precision IS NULL OR p_geo_precision NOT IN ('exact', 'approx', 'manual') THEN
    RAISE EXCEPTION 'invalid_geo_precision' USING ERRCODE = 'P0001';
  END IF;
  IF v_city IS NOT NULL AND char_length(v_city) > 120 THEN
    RAISE EXCEPTION 'city_too_long' USING ERRCODE = 'P0001';
  END IF;
  IF v_postal IS NOT NULL AND char_length(v_postal) > 20 THEN
    RAISE EXCEPTION 'postal_code_too_long' USING ERRCODE = 'P0001';
  END IF;

  -- Ownership: only the job creator may set/update the location.
  SELECT j.creator_id INTO v_creator_id
    FROM public.jobs j
   WHERE j.id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_creator_id <> v_user_id THEN
    RAISE EXCEPTION 'not_job_creator' USING ERRCODE = 'P0001';
  END IF;

  -- Upsert the exact point into the private side-table. PostGIS order: (lng, lat).
  INSERT INTO public.job_locations (job_id, geo, geo_precision, city, postal_code, updated_at)
  VALUES (
    p_job_id,
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
    p_geo_precision,
    v_city,
    v_postal,
    now()
  )
  ON CONFLICT (job_id) DO UPDATE
    SET geo           = EXCLUDED.geo,
        geo_precision = EXCLUDED.geo_precision,
        city          = EXCLUDED.city,
        postal_code   = EXCLUDED.postal_code,
        updated_at    = now()
  RETURNING * INTO v_row;

  -- Privacy hardening: strip any exact lat/lng from the world-readable payload
  -- and keep only a coarse, safe-to-display summary. All other payload keys are
  -- preserved. Runs as the postgres owner (BYPASSRLS), so it is not blocked by
  -- the jobs UPDATE policy and the jobs RLS itself is left untouched.
  UPDATE public.jobs
     SET payload = (COALESCE(payload, '{}'::jsonb) - 'location')
                   || jsonb_build_object(
                        'location_summary',
                        jsonb_build_object(
                          'city',          v_city,
                          'postal_code',   v_postal,
                          'geo_precision', p_geo_precision
                        )
                      )
   WHERE id = p_job_id;

  RETURN v_row;
END;
$$;

REVOKE ALL    ON FUNCTION public.set_job_location(uuid, double precision, double precision, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.set_job_location(uuid, double precision, double precision, text, text, text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.set_job_location(uuid, double precision, double precision, text, text, text) TO service_role;

-- postgres has BYPASSRLS; SECURITY DEFINER as the postgres owner lets the
-- function write public.job_locations (no client grant) and jobs.payload past
-- their RLS. Clients still cannot touch job_locations directly — this RPC is
-- the only write path, and there are intentionally no client grants on it.
ALTER FUNCTION public.set_job_location(uuid, double precision, double precision, text, text, text) OWNER TO postgres;

-- ── Reload PostgREST schema so the RPC is immediately callable ─────────────────

NOTIFY pgrst, 'reload schema';
