/**
 * Foreground-only location wrapper around expo-location.
 *
 * Scope for Geo Phase 2C-2: permission handling + one-shot current-position
 * capture + reverse geocoding + a last-known cache. No background location, no
 * watchPositionAsync, no map UI. Every public function is safe — it never throws
 * and returns a typed outcome / null.
 *
 * Exact coordinates captured here are only ever passed to the secure RPCs
 * (set_job_location / nearby_open_jobs) by callers in later phases; the cache
 * below is local-only (AsyncStorage) and never written to a world-readable row.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { Linking } from 'react-native';

export type GeoPermissionStatus = 'granted' | 'denied' | 'not_determined';

export interface GeoLocationFix {
  lat: number;
  lng: number;
  accuracy?: number | null;
  city?: string | null;
  postalCode?: string | null;
  source: 'device' | 'cache';
  capturedAt: string;
}

export type GeoErrorCode =
  | 'permission_denied'
  | 'unavailable'
  | 'timeout'
  | 'reverse_geocode_failed'
  | 'unknown';

export type GeoFixOutcome =
  | { ok: true; fix: GeoLocationFix }
  | { ok: false; code: GeoErrorCode };

export const LAST_KNOWN_LOCATION_STORAGE_KEY = 'geo_last_known_location';

const CURRENT_POSITION_TIMEOUT_MS = 15000;

// ── Permission ────────────────────────────────────────────────────────────────

const mapExpoStatus = (status: Location.PermissionStatus): GeoPermissionStatus => {
  if (status === Location.PermissionStatus.GRANTED) return 'granted';
  if (status === Location.PermissionStatus.DENIED) return 'denied';
  return 'not_determined';
};

/** Read the current foreground permission WITHOUT prompting. Never throws. */
export const getForegroundPermissionStatus = async (): Promise<GeoPermissionStatus> => {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    return mapExpoStatus(status);
  } catch (e) {
    console.warn('[geo-location] getForegroundPermissionStatus failed:', e instanceof Error ? e.message : String(e));
    return 'not_determined';
  }
};

/** Prompt for foreground permission (only call in response to a user action). */
export const requestForegroundLocationPermission = async (): Promise<GeoPermissionStatus> => {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    return mapExpoStatus(status);
  } catch (e) {
    console.warn('[geo-location] requestForegroundLocationPermission failed:', e instanceof Error ? e.message : String(e));
    return 'not_determined';
  }
};

/** Open the OS settings screen so a denied user can enable location. Never throws. */
export const openLocationSettings = async (): Promise<void> => {
  try {
    await Linking.openSettings();
  } catch (e) {
    console.warn('[geo-location] openLocationSettings failed:', e instanceof Error ? e.message : String(e));
  }
};

// ── Reverse geocoding ─────────────────────────────────────────────────────────

/** Best-effort city/postal lookup. Returns null on any failure (never throws). */
export const reverseGeocodeLocation = async (
  lat: number,
  lng: number,
): Promise<{ city: string | null; postalCode: string | null } | null> => {
  try {
    const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    const first = results?.[0];
    if (!first) return null;
    return {
      city: first.city ?? first.subregion ?? null,
      postalCode: first.postalCode ?? null,
    };
  } catch (e) {
    console.warn('[geo-location] reverseGeocodeLocation failed:', e instanceof Error ? e.message : String(e));
    return null;
  }
};

// ── Current position ──────────────────────────────────────────────────────────

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });

/**
 * One-shot current-position fix (Balanced accuracy). Requires an already-granted
 * foreground permission (does not prompt). Reverse-geocodes best-effort and
 * caches the result. Never throws — returns a typed outcome.
 */
export const getCurrentLocationFix = async (): Promise<GeoFixOutcome> => {
  try {
    const status = await getForegroundPermissionStatus();
    if (status !== 'granted') {
      return { ok: false, code: 'permission_denied' };
    }

    const servicesOn = await Location.hasServicesEnabledAsync().catch(() => true);
    if (!servicesOn) {
      return { ok: false, code: 'unavailable' };
    }

    let position: Location.LocationObject;
    try {
      position = await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        CURRENT_POSITION_TIMEOUT_MS,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'timeout') return { ok: false, code: 'timeout' };
      console.warn('[geo-location] getCurrentPositionAsync failed:', msg);
      return { ok: false, code: 'unavailable' };
    }

    const { latitude, longitude, accuracy } = position.coords;
    const geo = await reverseGeocodeLocation(latitude, longitude); // best-effort

    const fix: GeoLocationFix = {
      lat: latitude,
      lng: longitude,
      accuracy: accuracy ?? null,
      city: geo?.city ?? null,
      postalCode: geo?.postalCode ?? null,
      source: 'device',
      capturedAt: new Date().toISOString(),
    };

    await saveLastKnownLocation(fix);
    return { ok: true, fix };
  } catch (e) {
    console.warn('[geo-location] getCurrentLocationFix failed:', e instanceof Error ? e.message : String(e));
    return { ok: false, code: 'unknown' };
  }
};

// ── Last-known cache (local only) ─────────────────────────────────────────────

/** Load the cached last-known fix (source coerced to 'cache'). Null if none. */
export const loadLastKnownLocation = async (): Promise<GeoLocationFix | null> => {
  try {
    const raw = await AsyncStorage.getItem(LAST_KNOWN_LOCATION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GeoLocationFix>;
    if (typeof parsed.lat !== 'number' || typeof parsed.lng !== 'number') return null;
    return {
      lat: parsed.lat,
      lng: parsed.lng,
      accuracy: parsed.accuracy ?? null,
      city: parsed.city ?? null,
      postalCode: parsed.postalCode ?? null,
      source: 'cache',
      capturedAt: parsed.capturedAt ?? new Date().toISOString(),
    };
  } catch (e) {
    console.warn('[geo-location] loadLastKnownLocation failed:', e instanceof Error ? e.message : String(e));
    return null;
  }
};

/** Persist the latest fix locally. Never throws. */
export const saveLastKnownLocation = async (fix: GeoLocationFix): Promise<void> => {
  try {
    await AsyncStorage.setItem(LAST_KNOWN_LOCATION_STORAGE_KEY, JSON.stringify(fix));
  } catch (e) {
    console.warn('[geo-location] saveLastKnownLocation failed:', e instanceof Error ? e.message : String(e));
  }
};
