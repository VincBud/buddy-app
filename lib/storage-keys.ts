export const STORAGE_KEYS = {
  // Core job data
  JOBS: 'jobs',

  // User identity & profile
  BUDDY_SCORE: 'buddyScore',
  USER_PROFILE: 'userProfile',
  PROFILE_IMAGE_URI: 'profileImageUri', // legacy — kept for migration only

  // User preferences
  USER_PREFERENCES: 'userPreferences',

  // Social / matching
  PREFERRED_BUDDIES: 'preferredBuddies',

  // Notifications
  NOTIFICATIONS: 'notifications',
  NOTIFICATION_PREFERENCES: 'notification_preferences',

  // Wallet / payments
  WALLET_TRANSACTIONS: 'walletTransactions',
  WALLET_PAYOUT_RECORDS: 'walletPayoutRecords', // legacy — kept for migration only
  WALLET_SETTINGS: 'walletSettings',

  // Audit / event logs
  JOB_ISSUE_REPORTS: 'jobIssueReports',
  JOB_CANCELLATIONS: 'jobCancellations',

  // Reliability / trust stats (keyed per userId: `${key}_${userId}`)
  USER_RELIABILITY_STATS: 'userReliabilityStats',

  // DEV ONLY — local user switcher
  DEV_ACTIVE_USER: 'dev_active_user',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
