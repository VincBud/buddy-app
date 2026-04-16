/**
 * User service — single access point for user profile, preferences, and score.
 *
 * All functions accept an optional `userId` parameter unused today but maps
 * directly to the authenticated user in Supabase.
 * Swap implementations here when backend is ready.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  loadUserProfile,
  saveUserProfile,
  updateUserProfile,
  UserProfile,
} from '../lib/user-profile';
import {
  loadUserPreferences,
  saveUserPreferences,
  UserPreferences,
} from '../lib/preferences';
import { STORAGE_KEYS } from '../lib/storage-keys';

export const getUserProfile = async (_userId?: string): Promise<UserProfile> => {
  return loadUserProfile();
};

export const setUserProfile = async (
  profile: UserProfile,
  _userId?: string
): Promise<void> => {
  return saveUserProfile(profile);
};

export const patchUserProfile = async (
  updates: Partial<UserProfile>,
  _userId?: string
): Promise<UserProfile> => {
  return updateUserProfile(updates);
};

export const getUserPreferences = async (
  _userId?: string
): Promise<UserPreferences> => {
  return loadUserPreferences();
};

export const setUserPreferences = async (
  preferences: UserPreferences,
  _userId?: string
): Promise<UserPreferences> => {
  return saveUserPreferences(preferences);
};

export const getBuddyScore = async (_userId?: string): Promise<number> => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.BUDDY_SCORE);
    if (!raw) return 0;
    const parsed = Number(JSON.parse(raw));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
};

export const setBuddyScore = async (
  score: number,
  _userId?: string
): Promise<void> => {
  const safe = Number.isFinite(score) && score >= 0 ? score : 0;
  await AsyncStorage.setItem(STORAGE_KEYS.BUDDY_SCORE, JSON.stringify(safe));
};
