/**
 * Current-user source of truth for Buddy.
 *
 * All screens read/write the active user through this module.
 * Never access user AsyncStorage keys directly from screens.
 *
 * Dev/local:   userId  = getActiveDevUserId()  (from dev-session.ts)
 *              storage = AsyncStorage keyed per userId
 *
 * Production:  replace getActiveDevUserId() with supabase.auth.getUser().id
 *              replace AsyncStorage reads with Supabase profile table queries
 *              — only this file changes, callers stay the same
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { getActiveDevUser, getActiveDevUserId } from './dev-session';
import { STORAGE_KEYS } from './storage-keys';
import { BuddyUser, sanitizeBuddyUser } from './user-model';

// Per-user storage key
const userKey = (userId: string) => `${STORAGE_KEYS.CURRENT_USER}_${userId}`;

/**
 * Loads the current user's BuddyUser from storage.
 * Falls back to dev-user name and sensible defaults when no data exists yet.
 */
export const loadCurrentUser = async (): Promise<BuddyUser> => {
  const userId = getActiveDevUserId();
  try {
    const raw = await AsyncStorage.getItem(userKey(userId));
    const parsed = raw ? JSON.parse(raw) : {};
    const user = sanitizeBuddyUser(parsed, userId);

    // Seed displayName from dev-session when not yet stored
    if (!user.displayName) {
      const devUser = getActiveDevUser();
      return { ...user, displayName: devUser.name };
    }

    return user;
  } catch {
    const devUser = getActiveDevUser();
    return sanitizeBuddyUser({ displayName: devUser.name }, userId);
  }
};

export const saveCurrentUser = async (user: BuddyUser): Promise<void> => {
  const userId = getActiveDevUserId();
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
