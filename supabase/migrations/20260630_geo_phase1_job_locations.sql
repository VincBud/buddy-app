-- Geo-Matching — Phase 1: database foundation (private location side-table).
--
-- Privacy decision: the app currently reads full job rows via
-- services/jobs.service.ts `select('*')`, and the open-jobs feed RLS lets every
-- authenticated user read those rows. Adding an exact `geo` column to
-- public.jobs would therefore broadcast precise coordinates to everyone.
--
-- Instead, exact coordinates live in a SEPARATE, locked-down side-table
-- (public.job_locations) that is NOT readable by anon or authenticated. A
-- later phase will expose proximity only through a SECURITY DEFINER RPC that
-- returns distance + a coarse area (never raw lat/lng). This migration adds the
-- storage + spatial index + transitional backfill only — no RPC, no app/service
-- changes, and no changes to existing jobs RLS or grants.

-- ── PostGIS ───────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS postgis;

-- ── updated_at helper (idempotent; reused from 20260506_jobs.sql) ─────────────
-- Defined here too so this migration is self-contained regardless of order.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ── Table: public.job_locations ───────────────────────────────────────────────
-- One row per job. job_id is both PK and FK so the location is deleted with the
-- job (ON DELETE CASCADE).

CREATE TABLE IF NOT EXISTS public.job_locations (
  job_id        uuid                      PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  geo           geography(Point, 4326)    NOT NULL,
  geo_precision text                      NOT NULL DEFAULT 'exact',
  city          text,
  postal_code   text,
  created_at    timestamptz               NOT NULL DEFAULT now(),
  updated_at    timestamptz               NOT NULL DEFAULT now(),

  CONSTRAINT job_locations_precision_valid CHECK (geo_precision IN ('exact', 'approx', 'manual')),
  CONSTRAINT job_locations_city_len        CHECK (city IS NULL OR char_length(city) <= 120),
  CONSTRAINT job_locations_postal_len      CHECK (postal_code IS NULL OR char_length(postal_code) <= 20)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Spatial index for ST_DWithin / KNN proximity queries (used by the Phase 3 RPC).
CREATE INDEX IF NOT EXISTS job_locations_geo_gix
  ON public.job_locations USING gist (geo);

-- Coarse city lookups / fallback display.
CREATE INDEX IF NOT EXISTS job_locations_city_idx
  ON public.job_locations (city);

-- ── updated_at trigger ────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS job_locations_updated_at ON public.job_locations;
CREATE TRIGGER job_locations_updated_at
  BEFORE UPDATE ON public.job_locations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Security: RLS + grants ────────────────────────────────────────────────────
-- Exact coordinates are private. No client role gets ANY access; only
-- service_role (and the future SECURITY DEFINER RPC running as owner) may read.

ALTER TABLE public.job_locations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.job_locations FROM anon;
REVOKE ALL ON public.job_locations FROM authenticated;
GRANT  ALL ON public.job_locations TO service_role;

-- Explicit policy for service_role reads. (service_role bypasses RLS anyway;
-- this documents intent and is harmless.) Deliberately NO policy for
-- anon/authenticated, so even if a grant were ever added by mistake, RLS still
-- denies them every row.
DROP POLICY IF EXISTS "job_locations_service_role_all" ON public.job_locations;
CREATE POLICY "job_locations_service_role_all"
  ON public.job_locations FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── Transitional backfill from jobs.payload.location ──────────────────────────
-- Current values are hardcoded client-side, but backfilling gives Phase 3 some
-- data to test against. Only rows whose payload carries numeric-looking,
-- in-range lat/lng are inserted. Note PostGIS point order is (lng, lat).

INSERT INTO public.job_locations (job_id, geo, geo_precision)
SELECT
  j.id,
  ST_SetSRID(
    ST_MakePoint(
      (j.payload -> 'location' ->> 'lng')::double precision,
      (j.payload -> 'location' ->> 'lat')::double precision
    ),
    4326
  )::geography,
  'exact'
FROM public.jobs j
WHERE j.payload -> 'location' ->> 'lat' ~ '^-?[0-9]+(\.[0-9]+)?$'
  AND j.payload -> 'location' ->> 'lng' ~ '^-?[0-9]+(\.[0-9]+)?$'
  AND (j.payload -> 'location' ->> 'lat')::double precision BETWEEN -90  AND 90
  AND (j.payload -> 'location' ->> 'lng')::double precision BETWEEN -180 AND 180
ON CONFLICT (job_id) DO NOTHING;

-- ── Optional profile search origin ────────────────────────────────────────────
-- Buddy's private search point. Stays under the existing owner-only profiles
-- RLS (profiles_select_own / profiles_update_own) — no new grants, no RLS
-- changes. Adding a nullable column does not alter existing column grants.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS home_geo geography(Point, 4326);

CREATE INDEX IF NOT EXISTS profiles_home_geo_gix
  ON public.profiles USING gist (home_geo);

-- ── Reload PostgREST schema ───────────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';
