import { ensureJobPaymentState, JobPaymentState } from './payments';
import { calculatePriceBreakdown, parsePriceInput, PriceBreakdown } from './pricing';

/**
 * Stable local user ID for the currently logged-in user.
 * Used to identify self-posted jobs before a real auth system is in place.
 */
export const LOCAL_USER_ID = 'local_user';

export type TimeMode = 'sofort' | 'flexibel' | 'termin';

/**
 * Canonical job lifecycle statuses.
 *
 * open       — posted, publicly visible, accepting applicants (pending applications
 *              do not move the job out of open — the applications array tracks them)
 * matched    — owner accepted exactly one applicant; job removed from public feed;
 *              chat unlocked for owner + accepted buddy; payment authorization started
 * active     — job execution in progress; payment confirmed
 * completed  — done; payment release pending; reviews available
 * cancelled  — stopped by either party; no further actions
 * expired    — timed out without a match; no further applications accepted
 */
export type JobStatus =
  | 'open'
  | 'matched'
  | 'active'
  | 'completed'
  | 'cancelled'
  | 'expired';

export type JobParticipantRole = 'auftraggeber' | 'buddy';

export type JobIssueSummary = {
  reportedAt: string;
  reporterRole: JobParticipantRole;
  reason: string;
  note?: string;
  escalationState?: 'reported' | 'in_review' | 'resolved';
};

export type JobCancellationSummary = {
  cancelledAt: string;
  cancelledByRole: JobParticipantRole;
  reason: string;
  note?: string;
  outcome?: 'cancelled';
};

export type JobApplicationState = {
  buddyId: string;
  buddyName: string;
  buddyScore?: number;
  buddyRatingAverage?: number;
  buddyRatingCount?: number;
  buddyCompletedJobs?: number;
  buddyResponseRate?: number;
  buddyReliability?: 'new' | 'steady' | 'trusted';
  requestedAt: string;
  requesterDecision: 'pending' | 'accepted' | 'declined';
  requesterReviewedAt?: string;
  requesterDecisionBy?: string;
  requesterDecisionNote?: string;
  matchConfirmedAt?: string;
  matchActivatedAt?: string;
  matchActivatedByRole?: JobParticipantRole;
};

export type JobMatchState = {
  applications: JobApplicationState[];
  selectedApplicationId?: string;
};

export const getSelectedApplication = (
  job: Partial<Pick<Job, 'match'>>
): JobApplicationState | null => {
  const { match } = job;
  if (!match || !match.selectedApplicationId) return null;
  return (match.applications ?? []).find((a) => a.buddyId === match.selectedApplicationId) ?? null;
};

export type JobMarketSignals = {
  viewsCount?: number;
  applicationsCount?: number;
  requesterCompletedJobs?: number;
  requesterRatingCount?: number;
  requesterReliability?: 'new' | 'steady' | 'trusted';
  lastViewedAt?: string;
};

export const ACTIVE_JOB_STATUSES: JobStatus[] = [
  'matched',
  'active',
];

export const isActiveJobStatus = (status: JobStatus): boolean => {
  return ACTIVE_JOB_STATUSES.includes(status);
};

export const JOB_CATEGORIES = [
  'transport',
  'handyman',
  'household',
  'tech',
  'errands',
] as const;

export type JobCategory = (typeof JOB_CATEGORIES)[number];

export type JobReview = {
  rating: 1 | 2 | 3 | 4 | 5;
  reviewText?: string;
  reviewerName?: string;
  reviewedAt: string;
};

export type JobRoleReview = JobReview & {
  id: string;
  jobId: string;
  reviewerRole: JobParticipantRole;
  revieweeRole: JobParticipantRole;
};

export type Job = {
  id: string;
  requesterId?: string;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
  creatorName?: string;
  creatorScore?: number;
  creatorCompletedJobs?: number;
  creatorResponseRate?: number;
  creatorReviews?: JobReview[];
  category: JobCategory;
  subcategory?: string;
  problem: string;
  price: string;
  basePrice?: number;
  platformFee?: number;
  totalPrice?: number;
  payment?: JobPaymentState;
  time: string;
  timeMode?: TimeMode;
  flexibleRange?: string;
  appointmentDate?: string;
  appointmentTime?: string;
  media?: string[];
  location?: {
    lat: number;
    lng: number;
  };
  status: JobStatus;
  match?: JobMatchState;
  marketSignals?: JobMarketSignals;
  reviews?: JobRoleReview[];
  review?: JobReview;
  issueSummary?: JobIssueSummary;
  cancellationSummary?: JobCancellationSummary;
  rebooking?: JobRebooking;
  extensionsUsed?: number;
  maxExtensions?: number;
};

const MATCH_CONFIRMED_STATUSES: JobStatus[] = [
  'matched',
  'active',
  'cancelled',
  'completed',
];

export const hasRequesterAcceptedMatch = (
  job: Partial<Pick<Job, 'status' | 'match'>>
): boolean => {
  if (typeof job.status === 'string' && MATCH_CONFIRMED_STATUSES.includes(job.status as JobStatus)) {
    return true;
  }

  return Boolean(job.match?.selectedApplicationId);
};

export const isChatAccessibleForJob = (
  job: Partial<Pick<Job, 'status' | 'match'>>
): boolean => {
  return job.status === 'matched' || job.status === 'active';
};

/**
 * Returns true only if the specific buddy is the one accepted applicant for this job.
 * Use this on the non-owner (buddy) path to gate chat access.
 */
export const isChatAccessibleForBuddy = (
  job: Partial<Pick<Job, 'status' | 'match'>>,
  buddyId: string
): boolean => {
  if (!hasRequesterAcceptedMatch(job)) return false;
  return job.match?.selectedApplicationId === buddyId;
};

/**
 * Returns true if a job is still open to new applications.
 * Only 'open' jobs accept new applicants — pending applications do not change this status.
 */
export const isJobOpenForApplications = (status: JobStatus): boolean => {
  return status === 'open';
};

export const getSafeJobPriceNumber = (job: Pick<Job, 'price'>): number => {
  const parsedPrice = parsePriceInput(job.price);

  if (parsedPrice === null) {
    return 0;
  }

  return parsedPrice;
};

export const getJobPriceBreakdown = (
  job: Pick<Job, 'price'> & Partial<Pick<Job, 'basePrice' | 'platformFee' | 'totalPrice'>>
): PriceBreakdown => {
  const fallbackBasePrice = getSafeJobPriceNumber(job);
  const fallbackBreakdown = calculatePriceBreakdown(fallbackBasePrice);

  const basePrice =
    typeof job.basePrice === 'number' && Number.isFinite(job.basePrice) && job.basePrice >= 0
      ? job.basePrice
      : fallbackBreakdown.basePrice;

  const platformFee =
    typeof job.platformFee === 'number' && Number.isFinite(job.platformFee) && job.platformFee >= 0
      ? job.platformFee
      : fallbackBreakdown.platformFee;

  const totalPrice =
    typeof job.totalPrice === 'number' && Number.isFinite(job.totalPrice) && job.totalPrice >= 0
      ? job.totalPrice
      : basePrice + platformFee;

  return {
    basePrice,
    platformFee,
    totalPrice,
  };
};

export const getJobMoneySplit = (
  job: Pick<Job, 'price'> &
    Partial<Pick<Job, 'basePrice' | 'platformFee' | 'totalPrice' | 'payment'>>
): Pick<JobPaymentState, 'requesterPays' | 'buddyEarnings' | 'platformKeeps' | 'currency'> => {
  const payment = ensureJobPaymentState(job);

  return {
    requesterPays: payment.requesterPays,
    buddyEarnings: payment.buddyEarnings,
    platformKeeps: payment.platformKeeps,
    currency: payment.currency,
  };
};

export type JobRebookingStatus = 'pending' | 'accepted' | 'declined' | 'expired';

export type JobRebooking = {
  preferredBuddyId: string;
  preferredBuddyName: string;
  sourceJobId?: string;
  status: JobRebookingStatus;
  createdAt: string;
};

export const getMatchedBuddyName = (
  job: Partial<Pick<Job, 'match'>>
): string | null => {
  const name = getSelectedApplication(job)?.buddyName?.trim();
  return name || null;
};

export const isEligibleForRebooking = (job: Job): boolean => {
  return job.status === 'completed' && Boolean(getMatchedBuddyName(job));
};

export const getMatchedBuddyId = (
  job: Partial<Pick<Job, 'match'>>
): string | null => {
  return getSelectedApplication(job)?.buddyId?.trim() || null;
};

export const getBuddyPointsForJob = (job: Pick<Job, 'price'>): number => {
  const price = getSafeJobPriceNumber(job);

  if (price <= 30) {
    return 10;
  }

  return Math.min(30, Math.round(price / 10) + 10);
};

// Expiry durations — centralized, not hardcoded in UI
const JOB_EXPIRY_MS_SOFORT = 4 * 60 * 60 * 1000;      // 4 hours
const JOB_EXPIRY_MS_FLEXIBEL = 48 * 60 * 60 * 1000;   // 48 hours
const JOB_EXPIRY_BUFFER_TERMIN_MS = 30 * 60 * 1000;   // expire 30 min before termin

/**
 * Computes the ISO expiry timestamp for a new job.
 * appointmentDate: DD.MM.YYYY (German locale)
 * appointmentTime: HH:MM
 */
export const computeExpiresAt = (
  timeMode: TimeMode | undefined,
  appointmentDate?: string,
  appointmentTime?: string
): string => {
  const now = Date.now();

  if (timeMode === 'termin' && appointmentDate && appointmentTime) {
    const dateParts = appointmentDate.split('.');
    const timeParts = appointmentTime.split(':');

    if (dateParts.length === 3 && timeParts.length >= 2) {
      const apptMs = new Date(
        Number(dateParts[2]),
        Number(dateParts[1]) - 1,
        Number(dateParts[0]),
        Number(timeParts[0]),
        Number(timeParts[1])
      ).getTime();

      if (Number.isFinite(apptMs) && apptMs > now) {
        return new Date(apptMs - JOB_EXPIRY_BUFFER_TERMIN_MS).toISOString();
      }
    }

    // Fallback: 48h if appointment is unparseable or already passed
    return new Date(now + JOB_EXPIRY_MS_FLEXIBEL).toISOString();
  }

  if (timeMode === 'sofort') {
    return new Date(now + JOB_EXPIRY_MS_SOFORT).toISOString();
  }

  return new Date(now + JOB_EXPIRY_MS_FLEXIBEL).toISOString();
};

/**
 * Returns true if an open job's expiry time has passed.
 * Only considers jobs with status 'open' — active/matched/completed jobs never expire.
 */
export const isJobExpired = (
  job: Pick<Job, 'expiresAt' | 'status'>
): boolean => {
  if (job.status !== 'open') return false;
  if (!job.expiresAt) return false;
  return Date.now() > new Date(job.expiresAt).getTime();
};

/**
 * Transitions any open expired jobs to 'expired' status.
 * Returns the updated array and whether any changes were made.
 * Call this on load — do NOT call on active/matched jobs.
 */
/**
 * Returns only jobs created by the given user that are still actively open.
 * Excludes: completed, expired (status), cancelled, and runtime-expired jobs.
 * Pure function — no side effects, no React dependencies.
 */
export const getActiveOwnJobs = (jobs: Job[], currentUserId: string): Job[] => {
  return jobs.filter(
    (j) =>
      j.requesterId === currentUserId &&
      j.status === 'open' &&
      !isJobExpired(j)
  );
};

export const applyJobExpiry = (
  jobs: Job[]
): { jobs: Job[]; changed: boolean } => {
  let changed = false;

  const updated = jobs.map((job) => {
    if (isJobExpired(job)) {
      changed = true;
      return { ...job, status: 'expired' as const };
    }
    return job;
  });

  return { jobs: updated, changed };
};

export type JobExpiryUrgency = 'normal' | 'soon' | 'critical';

/**
 * Returns urgency tier based on remaining time.
 * critical  < 2h
 * soon      2h – 24h
 * normal    > 24h (or no expiresAt)
 */
export const getJobExpiryUrgency = (
  job: Pick<Job, 'expiresAt'>
): JobExpiryUrgency => {
  if (!job.expiresAt) return 'normal';
  const diffMs = new Date(job.expiresAt).getTime() - Date.now();
  if (diffMs < 2 * 3600 * 1000) return 'critical';
  if (diffMs < 24 * 3600 * 1000) return 'soon';
  return 'normal';
};

/** Fixed extension amount — swap in backend-driven value when ready. */
export const EXTEND_JOB_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

/** Default max extensions per job. Replace with server-provided value when backend is ready. */
export const DEFAULT_MAX_EXTENSIONS = 3;

/**
 * Returns the number of extensions remaining for a job.
 * Safe to call on jobs without extension fields (treats as unused).
 */
export const getRemainingExtensions = (job: Pick<Job, 'extensionsUsed' | 'maxExtensions'>): number => {
  const used = job.extensionsUsed ?? 0;
  const max = job.maxExtensions ?? DEFAULT_MAX_EXTENSIONS;
  return Math.max(0, max - used);
};

/**
 * Returns true if the job can still be extended.
 * Gate all extension UI and actions through this.
 */
export const canExtendJob = (job: Pick<Job, 'extensionsUsed' | 'maxExtensions'>): boolean => {
  return getRemainingExtensions(job) > 0;
};

/**
 * Returns a new job object with expiresAt extended by extensionMs.
 * Increments extensionsUsed. Caller must verify canExtendJob first.
 * Extends from now if already expired, otherwise from current expiresAt.
 * Pure — no side effects.
 */
export const extendJobExpiry = (
  job: Job,
  extensionMs = EXTEND_JOB_DURATION_MS
): Job => {
  const currentExpiry = job.expiresAt
    ? new Date(job.expiresAt).getTime()
    : Date.now();
  const base = Math.max(currentExpiry, Date.now());
  return {
    ...job,
    expiresAt: new Date(base + extensionMs).toISOString(),
    extensionsUsed: (job.extensionsUsed ?? 0) + 1,
    maxExtensions: job.maxExtensions ?? DEFAULT_MAX_EXTENSIONS,
  };
};

/**
 * Returns a human-readable expiry label for a self-posted job.
 * Returns null if expiresAt is not set.
 *
 * Examples (German):
 *   "läuft ab in 2h 14m"
 *   "läuft heute ab"
 *   "läuft morgen ab"
 *   "abgelaufen"
 */
export const getJobExpiryDisplay = (
  job: Pick<Job, 'expiresAt'>,
  locale: 'de' | 'en' = 'de'
): string | null => {
  if (!job.expiresAt) return null;

  const now = Date.now();
  const expiresMs = new Date(job.expiresAt).getTime();
  const diffMs = expiresMs - now;

  if (diffMs <= 0) {
    return locale === 'en' ? 'expired' : 'abgelaufen';
  }

  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMinutes < 60) {
    return locale === 'en'
      ? `expires in ${diffMinutes}m`
      : `läuft ab in ${diffMinutes}m`;
  }

  const remainingMinutes = diffMinutes % 60;

  if (diffHours < 24) {
    const timePart =
      remainingMinutes > 0
        ? `${diffHours}h ${remainingMinutes}m`
        : `${diffHours}h`;
    return locale === 'en'
      ? `expires in ${timePart}`
      : `läuft ab in ${timePart}`;
  }

  // Check if it's today or tomorrow based on calendar day
  const expiryDate = new Date(expiresMs);
  const nowDate = new Date(now);
  const todayDay = nowDate.toDateString();
  const tomorrowDate = new Date(now + 86400000);

  if (expiryDate.toDateString() === todayDay) {
    return locale === 'en' ? 'expires today' : 'läuft heute ab';
  }

  if (expiryDate.toDateString() === tomorrowDate.toDateString()) {
    return locale === 'en' ? 'expires tomorrow' : 'läuft morgen ab';
  }

  return locale === 'en'
    ? `expires in ${diffDays}d`
    : `läuft ab in ${diffDays}d`;
};