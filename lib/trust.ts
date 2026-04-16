export type ReliabilitySignal = 'new' | 'steady' | 'trusted';

type ReliabilityInput = {
  completedJobs?: number;
  responseRate?: number;
};

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
};

export const getTrustStarFillRatio = (
  averageRating: number | null | undefined,
  ratingCount?: number
): number => {
  if (typeof averageRating !== 'number' || !Number.isFinite(averageRating)) {
    return 0;
  }

  const safeRating = Math.max(0, Math.min(5, averageRating));
  const weightedStart = 3.0;
  const weightedEnd = 4.9;
  const normalized = clamp01((safeRating - weightedStart) / (weightedEnd - weightedStart));
  const eased = Math.pow(normalized, 0.82);

  if ((ratingCount ?? 0) <= 0) {
    return 0;
  }

  return Math.max(0.28, clamp01(eased));
};

export const getReliabilitySignal = ({
  completedJobs,
  responseRate,
}: ReliabilityInput): ReliabilitySignal => {
  const safeCompleted = typeof completedJobs === 'number' && Number.isFinite(completedJobs)
    ? Math.max(0, Math.floor(completedJobs))
    : 0;

  const safeResponseRate = typeof responseRate === 'number' && Number.isFinite(responseRate)
    ? Math.max(0, Math.min(1, responseRate))
    : null;

  if (safeCompleted >= 12 || (safeResponseRate !== null && safeResponseRate >= 0.9)) {
    return 'trusted';
  }

  if (safeCompleted >= 4 || (safeResponseRate !== null && safeResponseRate >= 0.75)) {
    return 'steady';
  }

  return 'new';
};
