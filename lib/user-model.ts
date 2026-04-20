import { JobCategory } from './jobs';

/**
 * Canonical Buddy user model.
 *
 * Dev/local: userId comes from getActiveDevUserId() in dev-session.ts.
 * Production (Supabase): userId = auth.uid(); swap storage backend in current-user.ts.
 *
 * Deliberately no availability fields — notification reach uses radius + interests only.
 */
export type BuddyUser = {
  userId: string;
  displayName: string;
  bio?: string;
  profileImageUri?: string | null;
  skills: JobCategory[];     // what this user can help with
  interests: JobCategory[];  // what kind of jobs this user wants to find
  radius: number;            // km — match / notification radius
  referralSource?: string;   // optional "how did you hear about Buddy?"
  onboardingCompleted: boolean;
  createdAt: string;
  updatedAt: string;
};

export const DEFAULT_BUDDY_USER_FIELDS: Omit<BuddyUser, 'userId' | 'createdAt' | 'updatedAt'> = {
  displayName: '',
  bio: undefined,
  profileImageUri: null,
  skills: [],
  interests: [],
  radius: 20,
  referralSource: undefined,
  onboardingCompleted: false,
};

export const sanitizeBuddyUser = (raw: unknown, userId: string): BuddyUser => {
  const p = (raw ?? {}) as Partial<BuddyUser>;
  const now = new Date().toISOString();

  return {
    userId,
    displayName: typeof p.displayName === 'string' ? p.displayName.trim() : '',
    bio: typeof p.bio === 'string' && p.bio.trim() ? p.bio.trim() : undefined,
    profileImageUri:
      typeof p.profileImageUri === 'string' ? p.profileImageUri : null,
    skills: Array.isArray(p.skills) ? (p.skills as JobCategory[]) : [],
    interests: Array.isArray(p.interests) ? (p.interests as JobCategory[]) : [],
    radius:
      typeof p.radius === 'number' && Number.isFinite(p.radius) && p.radius >= 1
        ? Math.min(50, Math.round(p.radius))
        : 20,
    referralSource:
      typeof p.referralSource === 'string' && p.referralSource.trim()
        ? p.referralSource.trim()
        : undefined,
    onboardingCompleted: Boolean(p.onboardingCompleted),
    createdAt: typeof p.createdAt === 'string' ? p.createdAt : now,
    updatedAt: now,
  };
};
