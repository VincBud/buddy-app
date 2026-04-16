import { Job } from './jobs';
import { getReliabilitySignal, ReliabilitySignal } from './trust';

const toSafeCount = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const normalized = Math.floor(value);
  return normalized >= 0 ? normalized : null;
};

export const getJobViewsCount = (job: Job): number | null => {
  return toSafeCount(job.marketSignals?.viewsCount);
};

export const getInterestedBuddyCount = (job: Job): number | null => {
  const explicit = toSafeCount(job.marketSignals?.applicationsCount);
  if (explicit !== null) return explicit;

  const activeCount = (job.match?.applications ?? []).filter(
    (a) => a.requesterDecision === 'pending' || a.requesterDecision === 'accepted'
  ).length;

  return activeCount > 0 ? activeCount : null;
};

export const getRequesterRatingCount = (job: Job): number | null => {
  const explicit = toSafeCount(job.marketSignals?.requesterRatingCount);
  if (explicit !== null) return explicit;

  if (!Array.isArray(job.creatorReviews)) return null;
  return job.creatorReviews.length;
};

export const getRequesterCompletedJobs = (job: Job): number | null => {
  const explicit = toSafeCount(job.marketSignals?.requesterCompletedJobs);
  if (explicit !== null) return explicit;

  return toSafeCount(job.creatorCompletedJobs);
};

export const getRequesterReliability = (job: Job): ReliabilitySignal | null => {
  if (job.marketSignals?.requesterReliability) {
    return job.marketSignals.requesterReliability;
  }

  const completed = getRequesterCompletedJobs(job);
  const responseRate =
    typeof job.creatorResponseRate === 'number' && Number.isFinite(job.creatorResponseRate)
      ? job.creatorResponseRate
      : null;

  if (completed === null && responseRate === null) {
    return null;
  }

  return getReliabilitySignal({
    completedJobs: completed ?? undefined,
    responseRate: responseRate ?? undefined,
  });
};

export const incrementJobViews = (job: Job): Job => {
  const views = getJobViewsCount(job) ?? 0;
  return {
    ...job,
    marketSignals: {
      ...job.marketSignals,
      viewsCount: views + 1,
      lastViewedAt: new Date().toISOString(),
    },
  };
};
