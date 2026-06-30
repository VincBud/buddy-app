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
