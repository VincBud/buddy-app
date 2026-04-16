import {
    Job,
    JobParticipantRole,
    JobReview,
    JobRoleReview,
} from './jobs';

export type ReviewAvailabilityState =
  | 'not_reviewable'
  | 'available'
  | 'already_reviewed';

export type ReviewEligibility = {
  state: ReviewAvailabilityState;
  reviewerRole: JobParticipantRole;
  revieweeRole: JobParticipantRole;
};

export const getCounterpartRole = (
  role: JobParticipantRole
): JobParticipantRole => {
  return role === 'buddy' ? 'auftraggeber' : 'buddy';
};

const toValidRating = (value: unknown): 1 | 2 | 3 | 4 | 5 | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < 1 || rounded > 5) return null;
  return rounded as 1 | 2 | 3 | 4 | 5;
};

const normalizeRole = (value: unknown): JobParticipantRole | null => {
  if (value === 'buddy' || value === 'auftraggeber') return value;
  return null;
};

const normalizeRoleReview = (value: unknown): JobRoleReview | null => {
  if (!value || typeof value !== 'object') return null;

  const safe = value as Partial<JobRoleReview>;
  const rating = toValidRating(safe.rating);
  const reviewerRole = normalizeRole(safe.reviewerRole);
  const revieweeRole = normalizeRole(safe.revieweeRole);
  const reviewedAt = typeof safe.reviewedAt === 'string' ? safe.reviewedAt : '';
  const jobId = typeof safe.jobId === 'string' ? safe.jobId : '';

  if (!rating || !reviewerRole || !revieweeRole || !reviewedAt || !jobId) {
    return null;
  }

  const id =
    typeof safe.id === 'string' && safe.id.trim().length > 0
      ? safe.id
      : `${jobId}_${reviewerRole}_${reviewedAt}`;

  return {
    id,
    jobId,
    reviewerRole,
    revieweeRole,
    rating,
    reviewText:
      typeof safe.reviewText === 'string' && safe.reviewText.trim().length > 0
        ? safe.reviewText.trim()
        : undefined,
    reviewerName:
      typeof safe.reviewerName === 'string' && safe.reviewerName.trim().length > 0
        ? safe.reviewerName.trim()
        : undefined,
    reviewedAt,
  };
};

const normalizeLegacyReview = (job: Job): JobRoleReview | null => {
  if (!job.review || typeof job.review !== 'object') return null;

  const rating = toValidRating(job.review.rating);
  const reviewedAt =
    typeof job.review.reviewedAt === 'string' && job.review.reviewedAt.trim().length > 0
      ? job.review.reviewedAt
      : null;

  if (!rating || !reviewedAt) return null;

  return {
    id: `${job.id}_legacy_auftraggeber_${reviewedAt}`,
    jobId: job.id,
    reviewerRole: 'auftraggeber',
    revieweeRole: 'buddy',
    rating,
    reviewText:
      typeof job.review.reviewText === 'string' && job.review.reviewText.trim().length > 0
        ? job.review.reviewText.trim()
        : undefined,
    reviewerName:
      typeof job.review.reviewerName === 'string' && job.review.reviewerName.trim().length > 0
        ? job.review.reviewerName.trim()
        : undefined,
    reviewedAt,
  };
};

export const getNormalizedJobReviews = (job: Job): JobRoleReview[] => {
  const roleReviews = Array.isArray(job.reviews)
    ? job.reviews
        .map((entry) => normalizeRoleReview(entry))
        .filter((entry): entry is JobRoleReview => Boolean(entry))
    : [];

  const legacy = normalizeLegacyReview(job);
  const hasLegacyInRoles = roleReviews.some(
    (entry) =>
      entry.reviewerRole === 'auftraggeber' &&
      entry.revieweeRole === 'buddy' &&
      entry.reviewedAt === legacy?.reviewedAt
  );

  const merged = legacy && !hasLegacyInRoles ? [legacy, ...roleReviews] : roleReviews;

  return merged.sort(
    (a, b) => new Date(b.reviewedAt).getTime() - new Date(a.reviewedAt).getTime()
  );
};

export const getReviewEligibility = (
  job: Job,
  reviewerRole: JobParticipantRole
): ReviewEligibility => {
  const revieweeRole = getCounterpartRole(reviewerRole);

  if (job.status !== 'completed') {
    return {
      state: 'not_reviewable',
      reviewerRole,
      revieweeRole,
    };
  }

  const existingByRole = getNormalizedJobReviews(job).find(
    (entry) => entry.reviewerRole === reviewerRole
  );

  if (existingByRole) {
    return {
      state: 'already_reviewed',
      reviewerRole,
      revieweeRole,
    };
  }

  return {
    state: 'available',
    reviewerRole,
    revieweeRole,
  };
};

export const createRoleReview = (params: {
  jobId: string;
  reviewerRole: JobParticipantRole;
  revieweeRole: JobParticipantRole;
  rating: 1 | 2 | 3 | 4 | 5;
  reviewText?: string;
  reviewerName?: string;
}): JobRoleReview => {
  const now = new Date().toISOString();

  return {
    id: `${params.jobId}_${params.reviewerRole}_${Date.now()}`,
    jobId: params.jobId,
    reviewerRole: params.reviewerRole,
    revieweeRole: params.revieweeRole,
    rating: params.rating,
    reviewText: params.reviewText?.trim() || undefined,
    reviewerName: params.reviewerName?.trim() || undefined,
    reviewedAt: now,
  };
};

export const toLegacyJobReview = (
  review: JobRoleReview | null | undefined
): JobReview | undefined => {
  if (!review) return undefined;

  return {
    rating: review.rating,
    reviewText: review.reviewText,
    reviewerName: review.reviewerName,
    reviewedAt: review.reviewedAt,
  };
};
