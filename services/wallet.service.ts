/**
 * Wallet service — single access point for all wallet and payout operations.
 *
 * All functions accept an optional `userId` parameter unused today but maps
 * directly to the authenticated user in Supabase.
 * Swap implementations here when backend is ready.
 */

import { Job } from '../lib/jobs';
import {
  loadWalletSnapshot,
  loadWalletSnapshotFromStorage,
  recordJobCompletionEarning,
  requestWalletPayout,
  requestWalletPayoutFromStorage,
  WalletSnapshot,
} from '../lib/wallet';

export const getWalletSnapshot = async (
  completedJobs: Job[],
  _userId?: string
): Promise<WalletSnapshot> => {
  return loadWalletSnapshot(completedJobs);
};

export const getWalletSnapshotFromStorage = async (
  _userId?: string
): Promise<WalletSnapshot> => {
  return loadWalletSnapshotFromStorage();
};

export const recordEarning = async (
  job: Parameters<typeof recordJobCompletionEarning>[0],
  _userId?: string
): Promise<void> => {
  return recordJobCompletionEarning(job);
};

export const requestPayout = async (
  completedJobs: Job[],
  _userId?: string
): Promise<Awaited<ReturnType<typeof requestWalletPayout>>> => {
  return requestWalletPayout(completedJobs);
};

export const requestPayoutFromStorage = async (
  _userId?: string
): Promise<Awaited<ReturnType<typeof requestWalletPayoutFromStorage>>> => {
  return requestWalletPayoutFromStorage();
};
