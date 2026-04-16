/**
 * Buddies service — single access point for preferred buddy operations.
 *
 * All functions accept an optional `userId` parameter unused today but maps
 * directly to the authenticated user in Supabase.
 * Swap implementations here when backend is ready.
 */

import { Job } from '../lib/jobs';
import {
  addPreferredBuddyFromJob,
  addPreferredBuddyFromMatchedJob,
  getPreferredBuddyById,
  getPreferredBuddyByName,
  loadPreferredBuddies,
  PreferredBuddy,
  savePreferredBuddies,
} from '../lib/preferred-buddies';

export const getBuddies = async (
  _userId?: string
): Promise<PreferredBuddy[]> => {
  return loadPreferredBuddies();
};

export const setBuddies = async (
  buddies: PreferredBuddy[],
  _userId?: string
): Promise<PreferredBuddy[]> => {
  return savePreferredBuddies(buddies);
};

export const addBuddyFromMatchedJob = async (
  job: Job,
  _userId?: string
): Promise<PreferredBuddy[]> => {
  return addPreferredBuddyFromMatchedJob(job);
};

export const addBuddyFromJob = async (
  job: Job,
  _userId?: string
): Promise<PreferredBuddy[]> => {
  return addPreferredBuddyFromJob(job);
};

export const findBuddyById = (
  buddies: PreferredBuddy[],
  id: string
): PreferredBuddy | null => {
  return getPreferredBuddyById(buddies, id);
};

export const findBuddyByName = (
  buddies: PreferredBuddy[],
  name: string
): PreferredBuddy | null => {
  return getPreferredBuddyByName(buddies, name);
};
