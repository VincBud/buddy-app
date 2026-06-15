/**
 * Job selectors — pure functions that derive filtered job lists from raw data.
 *
 * These replace scattered inline filter logic in UI screens and provide
 * a consistent, testable boundary between data and view layers.
 * No side effects, no AsyncStorage — just Job[] → Job[].
 */

import {
  ACTIVE_JOB_STATUSES,
  getActiveOwnJobs,
  getHistoricalOwnJobs,
  getPausedOwnJobs,
  isJobExpired,
  Job,
  JobStatus,
} from './jobs';

/**
 * Returns open jobs visible to a buddy — excludes jobs owned by the buddy
 * and jobs that have runtime-expired.
 * Optionally filters by radius (placeholder — distance filtering requires
 * real coordinates; wire up when location data is available).
 */
export const getOpenJobsForBuddy = (
  jobs: Job[],
  buddyId: string,
  _radius?: number
): Job[] => {
  return jobs.filter(
    (job) =>
      job.status === 'open' &&
      job.requesterId !== buddyId &&
      !isJobExpired(job)
  );
};

/**
 * Returns jobs where the given user is an active participant —
 * either as the requester or as the accepted buddy.
 * Covers statuses: matched, active, issue_reported.
 */
export const getActiveJobsForUser = (jobs: Job[], userId: string): Job[] => {
  return jobs.filter(
    (job) =>
      ACTIVE_JOB_STATUSES.includes(job.status as JobStatus) &&
      (job.requesterId === userId || job.match?.selectedApplicationId === userId)
  );
};

/**
 * Returns completed jobs where the given user was the accepted buddy.
 */
export const getCompletedJobsAsBuddy = (jobs: Job[], userId: string): Job[] => {
  return jobs.filter(
    (job) =>
      job.status === 'completed' &&
      (job.match?.selectedApplicationId === userId || job.assignedBuddyId === userId)
  );
};

/**
 * Returns jobs owned by the given user that are still actively open.
 * Delegates to the canonical implementation in lib/jobs.
 */
export { getActiveOwnJobs };

/**
 * Returns jobs owned by the given user that are paused.
 * Delegates to the canonical implementation in lib/jobs.
 */
export { getPausedOwnJobs };

/**
 * Returns old inactive own jobs eligible for reposting.
 * Delegates to the canonical implementation in lib/jobs.
 */
export { getHistoricalOwnJobs };
