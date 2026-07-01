/**
 * Auth service — thin wrappers used by UI screens.
 * Delegates to lib/auth.ts which owns the Supabase session.
 */

import {
  getActiveUserId,
  getActiveUserEmail,
  sendOtp,
  verifyOtp,
  signInWithApple,
  signOut as authSignOut,
  onAuthStateChange as authOnAuthStateChange,
} from '../lib/auth';

export type AuthUser = {
  id: string;
  email?: string;
};

export const getCurrentSession = async (): Promise<{ userId: string } | null> => {
  const userId = getActiveUserId();
  return userId ? { userId } : null;
};

export const getAuthUser = async (): Promise<AuthUser | null> => {
  const id = getActiveUserId();
  return id ? { id, email: getActiveUserEmail() } : null;
};

export { sendOtp, verifyOtp, signInWithApple };

export const signOut = authSignOut;

export const onAuthStateChange = authOnAuthStateChange;
