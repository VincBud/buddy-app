/**
 * Current-user source of truth for Buddy.
 *
 * All screens read/write the active user through this module.
 * Never access user AsyncStorage keys directly from screens.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { getActiveUserId } from './auth';
import { STORAGE_KEYS } from './storage-keys';
import { BuddyUser, sanitizeBuddyUser } from './user-model';

// Per-user storage key
const userKey = (userId: string) => `${STORAGE_KEYS.CURRENT_USER}_${userId}`;

/**
 * Loads the current user's BuddyUser from storage.
 */
export const loadCurrentUser = async (): Promise<BuddyUser> => {
  const userId = getActiveUserId();
  try {
    const raw = await AsyncStorage.getItem(userKey(userId));
    const parsed = raw ? JSON.parse(raw) : {};
    return sanitizeBuddyUser(parsed, userId);
  } catch {
    return sanitizeBuddyUser({}, userId);
  }
};

export const saveCurrentUser = async (user: BuddyUser): Promise<void> => {
  const userId = getActiveUserId();
  const toSave: BuddyUser = { ...user, userId, updatedAt: new Date().toISOString() };
  await AsyncStorage.setItem(userKey(userId), JSON.stringify(toSave));
};

export const patchCurrentUser = async (updates: Partial<BuddyUser>): Promise<BuddyUser> => {
  const current = await loadCurrentUser();
  const next: BuddyUser = {
    ...current,
    ...updates,
    userId: current.userId,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  };
  await saveCurrentUser(next);
  return next;
};

/**
 * React hook — reactive access to the current user.
 * Call refresh() after any write (e.g. after onboarding save) to propagate changes.
 */
export const useCurrentUser = () => {
  const [user, setUser] = useState<BuddyUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const loaded = await loadCurrentUser();
      setUser(loaded);
    } catch {
      // non-fatal
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { user, isLoading, refresh };
};
