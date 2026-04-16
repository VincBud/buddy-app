import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    Job,
    JobApplicationState,
    JobParticipantRole,
    JobStatus,
    isActiveJobStatus,
    isChatAccessibleForJob,
} from './jobs';
import {
  applyPaymentStateForJobStatus,
  confirmPaymentReservation,
  ensureJobPaymentState,
  isPaymentReadyForActivation,
} from './payments';
import { STORAGE_KEYS } from './storage-keys';

const JOBS_STORAGE_KEY = STORAGE_KEYS.JOBS;
const JOB_ISSUE_REPORTS_STORAGE_KEY = STORAGE_KEYS.JOB_ISSUE_REPORTS;
const JOB_CANCELLATIONS_STORAGE_KEY = STORAGE_KEYS.JOB_CANCELLATIONS;

export type ReportIssueReasonKey =
  | 'counterparty_unreachable'
  | 'unclear_expectation'
  | 'safety_concern'
  | 'payment_process_unclear'
  | 'inappropriate_behavior'
  | 'other';

export type CancelJobReasonKey =
  | 'no_time'
  | 'wrong_job'
  | 'no_agreement'
  | 'no_longer_needed'
  | 'other';

export type JobIssueReportRecord = {
  id: string;
  jobId: string;
  reporterRole: JobParticipantRole;
  reason: ReportIssueReasonKey;
  note?: string;
  createdAt: string;
  previousStatus: JobStatus;
  resultingStatus: JobStatus;
  paymentStatus: string;
  payoutStatus: string;
  refundStatus: string;
};

export type JobCancellationRecord = {
  id: string;
  jobId: string;
  cancelledByRole: JobParticipantRole;
  reason: CancelJobReasonKey;
  note?: string;
  createdAt: string;
  previousStatus: JobStatus;
  resultingStatus: JobStatus;
  paymentStatus: string;
  payoutStatus: string;
  refundStatus: string;
};

export type JobApplicantProfile = {
  buddyId: string;
  buddyName: string;
  buddyScore?: number;
  buddyRatingAverage?: number;
  buddyRatingCount?: number;
  buddyCompletedJobs?: number;
  buddyResponseRate?: number;
  buddyReliability?: 'new' | 'steady' | 'trusted';
};

export type JobApplicationDecision = 'accept' | 'decline' | 'wait';

const getNowIso = (): string => new Date().toISOString();

const safeParseJobs = (value: string | null): Job[] => {
  const parsed = value ? JSON.parse(value) : [];
  return Array.isArray(parsed) ? parsed : [];
};

const appendRecord = async <T>(storageKey: string, record: T): Promise<void> => {
  const raw = await AsyncStorage.getItem(storageKey);
  const parsed = raw ? JSON.parse(raw) : [];
  const safe = Array.isArray(parsed) ? parsed : [];
  await AsyncStorage.setItem(storageKey, JSON.stringify([record, ...safe]));
};

export const reportJobIssue = async (params: {
  jobId: string;
  reporterRole: JobParticipantRole;
  reason: ReportIssueReasonKey;
  note?: string;
}): Promise<{ updatedJob: Job | null; resultingStatus: JobStatus }> => {
  const jobsRaw = await AsyncStorage.getItem(JOBS_STORAGE_KEY);
  const jobs = safeParseJobs(jobsRaw);
  const targetIndex = jobs.findIndex((job) => String(job.id) === String(params.jobId));

  if (targetIndex < 0) {
    return { updatedJob: null, resultingStatus: 'open' };
  }

  const targetJob = jobs[targetIndex];
  const previousStatus = targetJob.status;

  const resultingStatus: JobStatus =
    previousStatus === 'cancelled' || previousStatus === 'completed'
      ? previousStatus
      : 'issue_reported';

  const updatedJob: Job = {
    ...targetJob,
    status: resultingStatus,
    payment: applyPaymentStateForJobStatus(
      ensureJobPaymentState(targetJob),
      resultingStatus
    ),
    issueSummary: {
      reportedAt: getNowIso(),
      reporterRole: params.reporterRole,
      reason: params.reason,
      note: params.note?.trim() || undefined,
      escalationState: 'reported',
    },
  };

  const nextJobs = [...jobs];
  nextJobs[targetIndex] = updatedJob;
  await AsyncStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(nextJobs));

  const reportRecord: JobIssueReportRecord = {
    id: `issue_${Date.now()}_${params.jobId}`,
    jobId: params.jobId,
    reporterRole: params.reporterRole,
    reason: params.reason,
    note: params.note?.trim() || undefined,
    createdAt: getNowIso(),
    previousStatus,
    resultingStatus,
    paymentStatus: updatedJob.payment?.paymentStatus ?? 'unpaid',
    payoutStatus: updatedJob.payment?.payoutStatus ?? 'not_ready',
    refundStatus: updatedJob.payment?.refundStatus ?? 'none',
  };

  await appendRecord(JOB_ISSUE_REPORTS_STORAGE_KEY, reportRecord);

  return { updatedJob, resultingStatus };
};

export const requestJobApplication = async (params: {
  jobId: string;
  applicant: JobApplicantProfile;
}): Promise<{ updatedJob: Job | null; resultingStatus: JobStatus }> => {
  const jobsRaw = await AsyncStorage.getItem(JOBS_STORAGE_KEY);
  const jobs = safeParseJobs(jobsRaw);
  const targetIndex = jobs.findIndex((job) => String(job.id) === String(params.jobId));

  if (targetIndex < 0) {
    return { updatedJob: null, resultingStatus: 'open' };
  }

  const targetJob = jobs[targetIndex];
  const previousStatus = targetJob.status;

  if (previousStatus !== 'open' && previousStatus !== 'applied' && previousStatus !== 'reviewing') {
    return { updatedJob: targetJob, resultingStatus: previousStatus };
  }

  const existingApplications = targetJob.match?.applications ?? [];

  // Prevent duplicate application from the same buddy
  if (existingApplications.some((a) => a.buddyId === params.applicant.buddyId)) {
    return { updatedJob: targetJob, resultingStatus: previousStatus };
  }

  const resultingStatus: JobStatus = 'applied';
  const now = getNowIso();
  const newApplication: JobApplicationState = {
    buddyId: params.applicant.buddyId,
    buddyName: params.applicant.buddyName,
    buddyScore: params.applicant.buddyScore,
    buddyRatingAverage: params.applicant.buddyRatingAverage,
    buddyRatingCount: params.applicant.buddyRatingCount,
    buddyCompletedJobs: params.applicant.buddyCompletedJobs,
    buddyResponseRate: params.applicant.buddyResponseRate,
    buddyReliability: params.applicant.buddyReliability,
    requestedAt: now,
    requesterDecision: 'pending',
  };
  const updatedJob: Job = {
    ...targetJob,
    status: resultingStatus,
    payment: applyPaymentStateForJobStatus(
      ensureJobPaymentState(targetJob),
      resultingStatus
    ),
    match: {
      state: 'buddy_requested',
      applications: [...existingApplications, newApplication],
      selectedApplicationId: targetJob.match?.selectedApplicationId,
    },
  };

  const nextJobs = [...jobs];
  nextJobs[targetIndex] = updatedJob;
  await AsyncStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(nextJobs));

  return { updatedJob, resultingStatus };
};

export const reviewJobApplication = async (params: {
  jobId: string;
  buddyId: string;
  decision: JobApplicationDecision;
  requesterId?: string;
  note?: string;
}): Promise<{ updatedJob: Job | null; resultingStatus: JobStatus }> => {
  const jobsRaw = await AsyncStorage.getItem(JOBS_STORAGE_KEY);
  const jobs = safeParseJobs(jobsRaw);
  const targetIndex = jobs.findIndex((job) => String(job.id) === String(params.jobId));

  if (targetIndex < 0) {
    return { updatedJob: null, resultingStatus: 'open' };
  }

  const targetJob = jobs[targetIndex];
  const now = getNowIso();
  const existingApplications = targetJob.match?.applications ?? [];
  const targetApplication = existingApplications.find((a) => a.buddyId === params.buddyId);

  if (!targetApplication) {
    return { updatedJob: targetJob, resultingStatus: targetJob.status };
  }

  if (params.decision === 'wait') {
    const updatedApplications = existingApplications.map((a) =>
      a.buddyId === params.buddyId ? { ...a, requesterDecision: 'pending' as const } : a
    );
    const waitingJob: Job = {
      ...targetJob,
      status: 'reviewing',
      payment: applyPaymentStateForJobStatus(ensureJobPaymentState(targetJob), 'reviewing'),
      match: {
        ...targetJob.match,
        state: 'requester_reviewing',
        applications: updatedApplications,
      },
    };
    const nextJobs = [...jobs];
    nextJobs[targetIndex] = waitingJob;
    await AsyncStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(nextJobs));
    return { updatedJob: waitingJob, resultingStatus: 'reviewing' };
  }

  if (params.decision === 'decline') {
    const updatedApplications = existingApplications.map((a) =>
      a.buddyId === params.buddyId
        ? {
            ...a,
            requesterDecision: 'declined' as const,
            requesterReviewedAt: now,
            requesterDecisionBy: params.requesterId,
            requesterDecisionNote: params.note?.trim() || undefined,
          }
        : a
    );
    const remainingPending = updatedApplications.some((a) => a.requesterDecision === 'pending');
    const resultingStatus: JobStatus = remainingPending ? 'applied' : 'open';
    const declinedJob: Job = {
      ...targetJob,
      status: resultingStatus,
      payment: applyPaymentStateForJobStatus(ensureJobPaymentState(targetJob), resultingStatus),
      match: {
        ...targetJob.match,
        state: remainingPending ? 'buddy_requested' : 'available',
        applications: updatedApplications,
        selectedApplicationId: targetJob.match?.selectedApplicationId,
      },
    };
    const nextJobs = [...jobs];
    nextJobs[targetIndex] = declinedJob;
    await AsyncStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(nextJobs));
    return { updatedJob: declinedJob, resultingStatus };
  }

  // accept: mark this applicant accepted, auto-decline all others
  const acceptedStatus: JobStatus = 'matched';
  const updatedApplications = existingApplications.map((a) => {
    if (a.buddyId === params.buddyId) {
      return {
        ...a,
        requesterDecision: 'accepted' as const,
        requesterReviewedAt: now,
        requesterDecisionBy: params.requesterId,
        requesterDecisionNote: params.note?.trim() || undefined,
        matchConfirmedAt: now,
      };
    }
    if (a.requesterDecision === 'pending') {
      return {
        ...a,
        requesterDecision: 'declined' as const,
        requesterReviewedAt: now,
        requesterDecisionNote: 'auto-declined: another applicant was accepted',
      };
    }
    return a;
  });
  const acceptedJob: Job = {
    ...targetJob,
    status: acceptedStatus,
    payment: applyPaymentStateForJobStatus(ensureJobPaymentState(targetJob), acceptedStatus),
    match: {
      ...targetJob.match,
      state: 'matched',
      applications: updatedApplications,
      selectedApplicationId: params.buddyId,
    },
  };
  const nextJobs = [...jobs];
  nextJobs[targetIndex] = acceptedJob;
  await AsyncStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(nextJobs));
  return { updatedJob: acceptedJob, resultingStatus: acceptedStatus };
};

export const activateMatchedJob = async (params: {
  jobId: string;
  activatedByRole: JobParticipantRole;
}): Promise<{ updatedJob: Job | null; resultingStatus: JobStatus }> => {
  const jobsRaw = await AsyncStorage.getItem(JOBS_STORAGE_KEY);
  const jobs = safeParseJobs(jobsRaw);
  const targetIndex = jobs.findIndex((job) => String(job.id) === String(params.jobId));

  if (targetIndex < 0) {
    return { updatedJob: null, resultingStatus: 'open' };
  }

  const targetJob = jobs[targetIndex];

  if (!isChatAccessibleForJob(targetJob)) {
    return { updatedJob: targetJob, resultingStatus: targetJob.status };
  }

  if (targetJob.status === 'active' || targetJob.status === 'accepted') {
    return { updatedJob: targetJob, resultingStatus: targetJob.status };
  }

  const currentPayment = ensureJobPaymentState(targetJob);

  // Guard: do not activate without payment authorization initiated
  if (!isPaymentReadyForActivation(currentPayment)) {
    return { updatedJob: targetJob, resultingStatus: targetJob.status };
  }

  // Local mock: confirm pending_authorization → reserved before activating
  const confirmedPayment = confirmPaymentReservation(currentPayment);

  const now = getNowIso();
  const updatedJob: Job = {
    ...targetJob,
    status: 'active',
    payment: applyPaymentStateForJobStatus(confirmedPayment, 'active'),
    match: {
      ...targetJob.match,
      state: 'active',
      applications: (targetJob.match?.applications ?? []).map((a) =>
        a.buddyId === targetJob.match?.selectedApplicationId
          ? {
              ...a,
              matchActivatedAt: a.matchActivatedAt ?? now,
              matchActivatedByRole: params.activatedByRole,
            }
          : a
      ),
    },
  };

  const nextJobs = [...jobs];
  nextJobs[targetIndex] = updatedJob;
  await AsyncStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(nextJobs));

  return { updatedJob, resultingStatus: 'active' };
};

export const cancelJob = async (params: {
  jobId: string;
  cancelledByRole: JobParticipantRole;
  reason: CancelJobReasonKey;
  note?: string;
}): Promise<{ updatedJob: Job | null; resultingStatus: JobStatus }> => {
  const jobsRaw = await AsyncStorage.getItem(JOBS_STORAGE_KEY);
  const jobs = safeParseJobs(jobsRaw);
  const targetIndex = jobs.findIndex((job) => String(job.id) === String(params.jobId));

  if (targetIndex < 0) {
    return { updatedJob: null, resultingStatus: 'open' };
  }

  const targetJob = jobs[targetIndex];
  const previousStatus = targetJob.status;

  const resultingStatus: JobStatus =
    previousStatus === 'completed' ? 'completed' : 'cancelled';

  const updatedJob: Job = {
    ...targetJob,
    status: resultingStatus,
    payment: applyPaymentStateForJobStatus(
      ensureJobPaymentState(targetJob),
      resultingStatus
    ),
    cancellationSummary: {
      cancelledAt: getNowIso(),
      cancelledByRole: params.cancelledByRole,
      reason: params.reason,
      note: params.note?.trim() || undefined,
      outcome: 'cancelled',
    },
  };

  const nextJobs = [...jobs];
  nextJobs[targetIndex] = updatedJob;
  await AsyncStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(nextJobs));

  const cancellationRecord: JobCancellationRecord = {
    id: `cancel_${Date.now()}_${params.jobId}`,
    jobId: params.jobId,
    cancelledByRole: params.cancelledByRole,
    reason: params.reason,
    note: params.note?.trim() || undefined,
    createdAt: getNowIso(),
    previousStatus,
    resultingStatus,
    paymentStatus: updatedJob.payment?.paymentStatus ?? 'unpaid',
    payoutStatus: updatedJob.payment?.payoutStatus ?? 'not_ready',
    refundStatus: updatedJob.payment?.refundStatus ?? 'none',
  };

  await appendRecord(JOB_CANCELLATIONS_STORAGE_KEY, cancellationRecord);

  return { updatedJob, resultingStatus };
};

export const isJobChatWritable = (status: JobStatus): boolean => {
  return isActiveJobStatus(status);
};

export const isJobChatAccessible = (job: Partial<Job> | null | undefined): boolean => {
  if (!job) return false;
  return isChatAccessibleForJob(job);
};
