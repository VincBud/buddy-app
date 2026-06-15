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
  // TODO(backend): SELECT * FROM wallet_transactions WHERE user_id = auth.uid() ORDER BY created_at DESC
  return loadWalletSnapshot(completedJobs);
};

export const getWalletSnapshotFromStorage = async (
  _userId?: string
): Promise<WalletSnapshot> => {
  // TODO(backend): same as getWalletSnapshot — remove this variant; storage is the canonical source until then
  return loadWalletSnapshotFromStorage();
};

export const recordEarning = async (
  job: Parameters<typeof recordJobCompletionEarning>[0],
  _userId?: string
): Promise<void> => {
  // TODO(backend): INSERT INTO wallet_transactions (user_id, job_id, amount, type) VALUES (auth.uid(), ...)
  // In production, earnings are recorded server-side via a webhook after payment release — not from the client.
  return recordJobCompletionEarning(job);
};

export const requestPayout = async (
  completedJobs: Job[],
  _userId?: string
): Promise<Awaited<ReturnType<typeof requestWalletPayout>>> => {
  // TODO(backend): call supabase.rpc('request_payout', { user_id: auth.uid() })
  // Stripe Connect payout is triggered server-side; this call enqueues the request.
  return requestWalletPayout(completedJobs);
};

export const requestPayoutFromStorage = async (
  _userId?: string
): Promise<Awaited<ReturnType<typeof requestWalletPayoutFromStorage>>> => {
  // TODO(backend): same as requestPayout — consolidate once wallet_transactions table exists
  return requestWalletPayoutFromStorage();
};
