/**
 * Geo service — thin wrapper around the public.set_job_location RPC
 * (supabase/migrations/20260630_geo_phase2a_set_job_location.sql).
 *
 * Exact coordinates are private: they live only in public.job_locations, which
 * has no client grant. set_job_location is the ONLY supported write path — it
 * validates input, enforces job-creator ownership server-side, stores the
 * geography point, and strips exact lat/lng out of the world-readable
 * jobs.payload (leaving only a coarse location_summary).
 *
 * The public function never throws — every path returns a typed outcome. The
 * client does not consume the returned geography.
 */
import { supabase } from '../lib/supabase/client';
import type { Job } from '../lib/jobs';
import { rowToJob, type JobRow } from './jobs.service';

export type GeoPrecision = 'exact' | 'approx' | 'manual';

export interface SetJobLocationParams {
  jobId: string;
  lat: number;
  lng: number;
  geoPrecision?: GeoPrecision;
  city?: string | null;
  postalCode?: string | null;
}

/** Known P0001 error codes raised by set_job_location, plus a catch-all. */
export type SetJobLocationErrorCode =
  | 'not_authenticated'
  | 'job_id_required'
  | 'invalid_latitude'
  | 'invalid_longitude'
  | 'invalid_geo_precision'
  | 'city_too_long'
  | 'postal_code_too_long'
  | 'job_not_found'
  | 'not_job_creator'
  | 'unknown';

export type SetJobLocationOutcome =
  | { ok: true }
  | { ok: false; code: SetJobLocationErrorCode };

const KNOWN_ERROR_CODES: readonly SetJobLocationErrorCode[] = [
  'not_authenticated', 'job_id_required', 'invalid_latitude', 'invalid_longitude',
  'invalid_geo_precision', 'city_too_long', 'postal_code_too_long',
  'job_not_found', 'not_job_creator',
];

/**
 * Record (or update) a job's location via the secure RPC. Returns a typed
 * outcome; never throws.
 */
export const setJobLocation = async (
  params: SetJobLocationParams,
): Promise<SetJobLocationOutcome> => {
  try {
    const { error } = await supabase.rpc('set_job_location', {
      p_job_id: params.jobId,
      p_lat: params.lat,
      p_lng: params.lng,
      p_geo_precision: params.geoPrecision ?? 'exact',
      p_city: params.city ?? null,
      p_postal_code: params.postalCode ?? null,
    });

    if (error) {
      // RAISE EXCEPTION '<code>' surfaces as error.message (see apply_to_job).
      const code: SetJobLocationErrorCode =
        (KNOWN_ERROR_CODES as readonly string[]).includes(error.message)
          ? (error.message as SetJobLocationErrorCode)
          : 'unknown';
      console.warn(`[geo.service] set_job_location failed: code=${error.code} message="${error.message}"`);
      return { ok: false, code };
    }

    return { ok: true };
  } catch (e) {
    console.warn('[geo.service] set_job_location threw:', e instanceof Error ? e.message : String(e));
    return { ok: false, code: 'unknown' };
  }
};

// ── Nearby open jobs (feed) ───────────────────────────────────────────────────

export interface FetchNearbyOpenJobsParams {
  lat: number;
  lng: number;
  radiusKm: number;
  limit?: number;
  offset?: number;
}

/** Known P0001 error codes raised by nearby_open_jobs, plus a catch-all. */
export type FetchNearbyErrorCode =
  | 'not_authenticated'
  | 'invalid_latitude'
  | 'invalid_longitude'
  | 'invalid_radius'
  | 'invalid_limit'
  | 'invalid_offset'
  | 'unknown';

export type FetchNearbyOpenJobsOutcome =
  | { ok: true; jobs: Job[] }
  | { ok: false; code: FetchNearbyErrorCode };

const KNOWN_NEARBY_ERROR_CODES: readonly FetchNearbyErrorCode[] = [
  'not_authenticated', 'invalid_latitude', 'invalid_longitude',
  'invalid_radius', 'invalid_limit', 'invalid_offset',
];

// The RPC returns the jobs columns rowToJob expects (minus the assigned/
// completion columns, which are always null for open jobs) plus coarse geo
// display fields. Never any raw lat/lng/geo.
type NearbyJobRow = Omit<JobRow, 'assigned_buddy_id' | 'owner_completed_at' | 'buddy_completed_at'> & {
  distance_km: number | null;
  city: string | null;
  postal_code: string | null;
  geo_precision: GeoPrecision;
};

/**
 * Fetch open jobs near a point via the secure RPC. Server-side it already
 * filters to open jobs, excludes the caller's own + already-applied jobs, and
 * bounds the radius. Returns hydrated Job[] carrying distanceKm/city/postalCode/
 * geoPrecision. Never throws.
 */
export const fetchNearbyOpenJobs = async (
  params: FetchNearbyOpenJobsParams,
): Promise<FetchNearbyOpenJobsOutcome> => {
  try {
    const { data, error } = await supabase.rpc('nearby_open_jobs', {
      p_lat: params.lat,
      p_lng: params.lng,
      p_radius_km: params.radiusKm,
      p_limit: params.limit ?? 50,
      p_offset: params.offset ?? 0,
    });

    if (error) {
      const code: FetchNearbyErrorCode =
        (KNOWN_NEARBY_ERROR_CODES as readonly string[]).includes(error.message)
          ? (error.message as FetchNearbyErrorCode)
          : 'unknown';
      console.warn(`[geo.service] nearby_open_jobs failed: code=${error.code} message="${error.message}"`);
      return { ok: false, code };
    }

    const rows = (data ?? []) as NearbyJobRow[];
    const jobs: Job[] = rows.map((row) => {
      const job = rowToJob({
        ...row,
        assigned_buddy_id: null,
        owner_completed_at: null,
        buddy_completed_at: null,
      });
      job.distanceKm = row.distance_km ?? undefined;
      job.city = row.city ?? undefined;
      job.postalCode = row.postal_code ?? undefined;
      job.geoPrecision = row.geo_precision ?? undefined;
      return job;
    });

    return { ok: true, jobs };
  } catch (e) {
    console.warn('[geo.service] nearby_open_jobs threw:', e instanceof Error ? e.message : String(e));
    return { ok: false, code: 'unknown' };
  }
};
