import AsyncStorage from '@react-native-async-storage/async-storage';

export type LocationPermissionStatus = 'granted' | 'denied' | 'not_determined';

export type LocationSettings = {
  permissionStatus: LocationPermissionStatus;
  discoveryEnabled: boolean;
  radius: number;
};

export const LOCATION_SETTINGS_STORAGE_KEY = 'location_settings';

export const DEFAULT_LOCATION_SETTINGS: LocationSettings = {
  permissionStatus: 'not_determined',
  discoveryEnabled: true,
  radius: 20,
};

export const sanitizeLocationSettings = (value: unknown): LocationSettings => {
  const safe = (value ?? {}) as Partial<LocationSettings>;

  const permissionStatus: LocationPermissionStatus =
    safe.permissionStatus === 'granted' ||
    safe.permissionStatus === 'denied' ||
    safe.permissionStatus === 'not_determined'
      ? safe.permissionStatus
      : DEFAULT_LOCATION_SETTINGS.permissionStatus;

  const discoveryEnabled =
    typeof safe.discoveryEnabled === 'boolean'
      ? safe.discoveryEnabled
      : DEFAULT_LOCATION_SETTINGS.discoveryEnabled;

  const radius =
    typeof safe.radius === 'number' && Number.isFinite(safe.radius)
      ? Math.min(50, Math.max(1, Math.round(safe.radius)))
      : DEFAULT_LOCATION_SETTINGS.radius;

  return { permissionStatus, discoveryEnabled, radius };
};

export const loadLocationSettings = async (): Promise<LocationSettings> => {
  try {
    const raw = await AsyncStorage.getItem(LOCATION_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_LOCATION_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_LOCATION_SETTINGS, ...sanitizeLocationSettings(parsed) };
  } catch {
    return DEFAULT_LOCATION_SETTINGS;
  }
};

export const saveLocationSettings = async (
  settings: LocationSettings
): Promise<void> => {
  const safe = sanitizeLocationSettings(settings);
  await AsyncStorage.setItem(LOCATION_SETTINGS_STORAGE_KEY, JSON.stringify(safe));
};
