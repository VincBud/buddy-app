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
  getReliabilityStatus,
  ReliabilitySignal,
  UserReliabilityStats,
} from '../lib/trust';
import {
  loadUserPreferences,
  saveUserPreferences,
  UserPreferences,
} from '../lib/preferences';
import {
  loadCurrentUser,
  saveCurrentUser,
  patchCurrentUser,
} from '../lib/current-user';
import { BuddyUser } from '../lib/user-model';
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

// ─── Reliability stats ────────────────────────────────────────────────────────

const STATS_DEFAULTS: UserReliabilityStats = {
  completedJobs: 0,
  cancelledJobs: 0,
  issueCount: 0,
};

const statsKey = (userId: string) => `${STORAGE_KEYS.USER_RELIABILITY_STATS}_${userId}`;

export const getReliabilityStats = async (userId: string): Promise<UserReliabilityStats> => {
  try {
    const raw = await AsyncStorage.getItem(statsKey(userId));
    if (!raw) return { ...STATS_DEFAULTS };
    const p = JSON.parse(raw);
    return {
      completedJobs: typeof p.completedJobs === 'number' ? p.completedJobs : 0,
      cancelledJobs: typeof p.cancelledJobs === 'number' ? p.cancelledJobs : 0,
      issueCount: typeof p.issueCount === 'number' ? p.issueCount : 0,
      acceptedJobsCount: typeof p.acceptedJobsCount === 'number' ? p.acceptedJobsCount : undefined,
      totalPostedJobs: typeof p.totalPostedJobs === 'number' ? p.totalPostedJobs : undefined,
    };
  } catch {
    return { ...STATS_DEFAULTS };
  }
};

export const incrementReliabilityStats = async (
  userId: string,
  field: keyof UserReliabilityStats,
): Promise<void> => {
  const current = await getReliabilityStats(userId);
  const prev = typeof current[field] === 'number' ? (current[field] as number) : 0;
  await AsyncStorage.setItem(statsKey(userId), JSON.stringify({ ...current, [field]: prev + 1 }));
};

export const getComputedReliability = async (userId: string): Promise<ReliabilitySignal> => {
  const stats = await getReliabilityStats(userId);
  return getReliabilityStatus(stats);
};

// ─── Current user (BuddyUser) ─────────────────────────────────────────────────

export const getCurrentUser = async (_userId?: string): Promise<BuddyUser> => {
  return loadCurrentUser();
};

export const setCurrentUser = async (
  user: BuddyUser,
  _userId?: string
): Promise<void> => {
  return saveCurrentUser(user);
};

export const updateCurrentUser = async (
  updates: Partial<BuddyUser>,
  _userId?: string
): Promise<BuddyUser> => {
  return patchCurrentUser(updates);
};
