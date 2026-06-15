import { JobApplicationState } from './jobs';

export type JobRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export type JobRequest = {
  id: string;
  jobId: string;
  buddyId: string;
  buddyName: string;
  buddyScore?: number;
  buddyRatingAverage?: number;
  buddyRatingCount?: number;
  buddyCompletedJobs?: number;
  buddyReliability?: 'new' | 'steady' | 'trusted';
  status: JobRequestStatus;
  note?: string;
  createdAt: string;
  updatedAt: string;
};

const mapDecision = (
  decision: JobApplicationState['requesterDecision']
): JobRequestStatus => {
  if (decision === 'accepted') return 'accepted';
  if (decision === 'declined') return 'declined';
  return 'pending';
};

export const jobRequestFromApplicationState = (
  application: JobApplicationState,
  jobId: string
): JobRequest => {
  return {
    id: `${jobId}_${application.buddyId}`,
    jobId,
    buddyId: application.buddyId,
    buddyName: application.buddyName,
    buddyScore: application.buddyScore,
    buddyRatingAverage: application.buddyRatingAverage,
    buddyRatingCount: application.buddyRatingCount,
    buddyCompletedJobs: application.buddyCompletedJobs,
    buddyReliability: application.buddyReliability,
    status: mapDecision(application.requesterDecision),
    note: application.requesterDecisionNote,
    createdAt: application.requestedAt,
    updatedAt: application.requesterReviewedAt ?? application.requestedAt,
  };
};
