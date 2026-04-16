/**
 * DEV ONLY — local user switcher for testing both sides of the marketplace.
 * Supports switching between owner and two buddy identities without code changes.
 * Remove or gate behind __DEV__ before shipping.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { STORAGE_KEYS } from './storage-keys';

export type DevUserId = 'local_user' | 'buddy_local' | 'buddy_local_2';

export type DevUser = {
  id: DevUserId;
  name: string;
  role: 'auftraggeber' | 'buddy';
  label: string;
};

export const DEV_USERS: readonly DevUser[] = [
  { id: 'local_user',    name: 'Vincent', role: 'auftraggeber', label: 'Owner'   },
  { id: 'buddy_local',   name: 'Alex',    role: 'buddy',        label: 'Buddy A' },
  { id: 'buddy_local_2', name: 'Sam',     role: 'buddy',        label: 'Buddy B' },
] as const;

// Module-level cache — sync access across screens without repeated AsyncStorage reads
let _activeUserId: DevUserId = 'local_user';

/**
 * Call once at app startup (e.g. in _layout.tsx useEffect).
 * Populates the module cache from persisted storage.
 */
export const loadDevSession = async (): Promise<void> => {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEYS.DEV_ACTIVE_USER);
    if (stored && DEV_USERS.some((u) => u.id === stored)) {
      _activeUserId = stored as DevUserId;
    }
  } catch {
    // non-fatal — default to 'local_user'
  }
};

/** Sync — returns cached value. Always call loadDevSession() first on app init. */
export const getActiveDevUserId = (): DevUserId => _activeUserId;

export const getActiveDevUser = (): DevUser =>
  DEV_USERS.find((u) => u.id === _activeUserId) ?? DEV_USERS[0];

export const setActiveDevUser = async (userId: DevUserId): Promise<void> => {
  _activeUserId = userId;
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.DEV_ACTIVE_USER, userId);
  } catch {
    // non-fatal
  }
};

/**
 * React hook — provides reactive access to the active dev user.
 * Re-renders the consuming component when switchUser() is called.
 */
export const useDevSession = () => {
  const [activeUser, setActiveUserState] = useState<DevUser>(getActiveDevUser());

  useEffect(() => {
    // Sync state on mount in case another screen already updated the cache
    setActiveUserState(getActiveDevUser());
  }, []);

  const switchUser = useCallback(async (userId: DevUserId) => {
    await setActiveDevUser(userId);
    setActiveUserState(getActiveDevUser());
  }, []);

  return { activeUser, switchUser, allUsers: DEV_USERS };
};
