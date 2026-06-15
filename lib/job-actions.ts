import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    IssueResolutionOutcome,
    Job,
    JobApplicationState,
    JobCompletionConfirmation,
    JobParticipantRole,
    JobRoleReview,
    JobStatus,
    TimeMode,
    computeExpiresAt,
    createRepostedJob,
    isActiveJobStatus,
    isChatAccessibleForJob,
    isJobEditable,
    isJobOpenForApplications,
    isJobPauseable,
    isJobRepostable,
    isJobResumable,
} from './jobs';
import {
  applyPaymentStateForJobStatus,
  confirmPaymentReservation,
  ensureJobPaymentState,
  isPaymentReadyForActivation,
} from './payments';
import { STORAGE_KEYS } from './storage-keys';
import { incrementReliabilityStats } from '../services/user.service';
import { upsertJob } from '../services/jobs.service';
import { supabase } from './supabase/client';
import { isSupabaseConfigured } from './config/env';
import { debugLog } from './config/debug';
import { insertReview } from '../services/reviews.service';

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
};

export type JobApplicationDecision = 'accept' | 'decline' | 'wait';

const getNowIso = (): string => new Date().toISOString();

const safeParseJobs = (value: string | null): Job[] => {
  const parsed = value ? JSON.parse(value) : [];
  return Array.isArray(parsed) ? parsed : [];
};

/**
 * Builds the next records array JSON without writing to storage.
 * Used together with AsyncStorage.multiSet to atomically persist job state
 * and the corresponding audit record in a single write.
 */
const buildUpdatedRecords = <T>(existingRaw: string | null, newRecord: T): string => {
  const parsed = existingRaw ? JSON.parse(existingRaw) : [];
  const safe = Array.isArray(parsed) ? parsed : [];
  return JSON.stringify([newRecord, ...safe]);
};

export const reportJobIssue = async (params: {
  jobId: string;
  reporterRole: JobParticipantRole;
  reporterUserId?: string;
  reason: ReportIssueReasonKey;
  note?: string;
}): Promise<{ updatedJob: Job | null; resultingStatus: JobStatus }> => {
  const [[, jobsRaw], [, reportsRaw]] = await AsyncStorage.multiGet([
    JOBS_STORAGE_KEY,
    JOB_ISSUE_REPORTS_STORAGE_KEY,
  ]);
  const jobs = safeParseJobs(jobsRaw);
  const targetIndex = jobs.findIndex((job) => String(job.id) === String(params.jobId));

  if (targetIndex < 0) {
    return { updatedJob: null, resultingStatus: 'open' };
  }

  const targetJob = jobs[targetIndex];
  const previousStatus = targetJob.status;

  const resultingStatus: JobStatus =
    previousStatus === 'completed'
      ? 'completed'
      : isActiveJobStatus(previousStatus)
      ? 'issue_reported'
      : 'cancelled';

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

  const reportRecord: JobIssueReportRecord = {
    id: `issue_${Date.now()}_${params.jobId}`,
    jobId: params.jobId,
    reporterRole: params.reporterRole,
    reason: params.reason,
    note: params.note?.trim() || undefined,
    createdAt: getNowIso(),
    previousStatus,
    resultingStatus,
    paymentStatus: updatedJob.payment?.paymentStatus ?? 'none',
    payoutStatus: updatedJob.payment?.payoutStatus ?? 'not_ready',
    refundStatus: updatedJob.payment?.refundStatus ?? 'none',
  };

  await AsyncStorage.multiSet([
    [JOBS_STORAGE_KEY, JSON.stringify(nextJobs)],
    [JOB_ISSUE_REPORTS_STORAGE_KEY, buildUpdatedRecords(reportsRaw, reportRecord)],
  ]);

  upsertJob(updatedJob).catch((e) =>
    console.warn('[job-actions] reportJobIssue: Supabase sync failed:', e)
  );

  if (params.reporterUserId) {
    await incrementReliabilityStats(params.reporterUserId, 'issueCount');
  }

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

  if (!isJobOpenForApplications(previousStatus)) {
    return { updatedJob: targetJob, resultingStatus: previousStatus };
  }

  const existingApplications = targetJob.match?.applications ?? [];

  // Prevent duplicate application from the same buddy
  if (existingApplications.some((a) => a.buddyId === params.applicant.buddyId)) {
    return { updatedJob: targetJob, resultingStatus: previousStatus };
  }

  // Job stays 'open' while applications are pending — the applications array tracks them
  const resultingStatus: JobStatus = 'open';
  const now = getNowIso();
  const newApplication: JobApplicationState = {
    buddyId: params.applicant.buddyId,
    buddyName: '',
    buddyScore: undefined,
    buddyRatingAverage: undefined,
    buddyRatingCount: undefined,
    buddyCompletedJobs: undefined,
    buddyResponseRate: undefined,
    buddyReliability: undefined,
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
      status: 'open',
      payment: applyPaymentStateForJobStatus(ensureJobPaymentState(targetJob), 'open'),
      match: {
        applications: updatedApplications,
        selectedApplicationId: targetJob.match?.selectedApplicationId,
      },
    };
    const nextJobs = [...jobs];
    nextJobs[targetIndex] = waitingJob;
    await AsyncStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(nextJobs));
    return { updatedJob: waitingJob, resultingStatus: 'open' };
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
    // Job always returns to 'open' on decline — it remains publicly visible while pending applicants exist
    const resultingStatus: JobStatus = 'open';
    const declinedJob: Job = {
      ...targetJob,
      status: resultingStatus,
      payment: applyPaymentStateForJobStatus(ensureJobPaymentState(targetJob), resultingStatus),
      match: {
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
  //
  // BACKEND INTEGRATION POINT — payment intent creation
  // When real payments are enabled, create a Stripe PaymentIntent here:
  //   const intent = await stripe.paymentIntents.create({
  //     amount: job.totalPrice * 100,  // cents
  //     currency: 'eur',
  //     capture_method: 'manual',      // hold funds, capture on completion
  //     metadata: { jobId: job.id, buddyId: params.buddyId },
  //   });
  // Store intent.id on the job record and set paymentStatus = 'pending_authorization'.
  // Actual capture happens in completeJob via a server-side webhook.
  await incrementReliabilityStats(params.buddyId, 'acceptedJobsCount');
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
    assignedBuddyId: params.buddyId,
    payment: applyPaymentStateForJobStatus(ensureJobPaymentState(targetJob), acceptedStatus),
    match: {
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

  if (targetJob.status === 'active') {
    return { updatedJob: targetJob, resultingStatus: targetJob.status };
  }

  const currentPayment = ensureJobPaymentState(targetJob);

  // Guard: do not activate without payment authorization initiated
  if (!isPaymentReadyForActivation(currentPayment)) {
    return { updatedJob: targetJob, resultingStatus: targetJob.status };
  }

  // BACKEND INTEGRATION POINT — escrow/reservation confirmation
  // In production, skip this local mock. Instead, listen for the Stripe webhook
  //   payment_intent.amount_capturable_updated
  // and transition paymentStatus to 'reserved' server-side before setting job to 'active'.
  // The client only proceeds here after receiving a push notification or polling confirmation.
  const confirmedPayment = confirmPaymentReservation(currentPayment);

  const now = getNowIso();
  const updatedJob: Job = {
    ...targetJob,
    status: 'active',
    payment: applyPaymentStateForJobStatus(confirmedPayment, 'active'),
    match: {
      applications: (targetJob.match?.applications ?? []).map((a) =>
        a.buddyId === targetJob.match?.selectedApplicationId
          ? {
              ...a,
              matchActivatedAt: a.matchActivatedAt ?? now,
              matchActivatedByRole: params.activatedByRole,
            }
          : a
      ),
      selectedApplicationId: targetJob.match?.selectedApplicationId,
    },
  };

  const nextJobs = [...jobs];
  nextJobs[targetIndex] = updatedJob;
  await AsyncStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(nextJobs));

  upsertJob(updatedJob).catch((e) =>
    console.warn('[job-actions] activateMatchedJob: Supabase sync failed:', e)
  );

  return { updatedJob, resultingStatus: 'active' };
};

export const cancelJob = async (params: {
  jobId: string;
  cancelledByRole: JobParticipantRole;
  cancelledByUserId?: string;
  reason: CancelJobReasonKey;
  note?: string;
}): Promise<{ updatedJob: Job | null; resultingStatus: JobStatus }> => {
  const [[, jobsRaw], [, cancellationsRaw]] = await AsyncStorage.multiGet([
    JOBS_STORAGE_KEY,
    JOB_CANCELLATIONS_STORAGE_KEY,
  ]);
  const jobs = safeParseJobs(jobsRaw);
  const targetIndex = jobs.findIndex((job) => String(job.id) === String(params.jobId));

  if (targetIndex < 0) {
    return { updatedJob: null, resultingStatus: 'open' };
  }

  const targetJob = jobs[targetIndex];
  const previousStatus = targetJob.status;

  // BACKEND INTEGRATION POINT — refund handling
  // If the job had funds reserved (paymentStatus 'pending_authorization' or 'reserved'),
  // initiate a Stripe refund or PaymentIntent cancellation before saving the updated job:
  //   const pi = targetJob.paymentIntentId;
  //   if (pi && isPaymentReserved) {
  //     await stripe.refunds.create({ payment_intent: pi });
  //   }
  // Set refundStatus = 'pending' locally; a Stripe webhook (charge.refunded) marks it 'processed'.
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

  const cancellationRecord: JobCancellationRecord = {
    id: `cancel_${Date.now()}_${params.jobId}`,
    jobId: params.jobId,
    cancelledByRole: params.cancelledByRole,
    reason: params.reason,
    note: params.note?.trim() || undefined,
    createdAt: getNowIso(),
    previousStatus,
    resultingStatus,
    paymentStatus: updatedJob.payment?.paymentStatus ?? 'none',
    payoutStatus: updatedJob.payment?.payoutStatus ?? 'not_ready',
    refundStatus: updatedJob.payment?.refundStatus ?? 'none',
  };

  await AsyncStorage.multiSet([
    [JOBS_STORAGE_KEY, JSON.stringify(nextJobs)],
    [JOB_CANCELLATIONS_STORAGE_KEY, buildUpdatedRecords(cancellationsRaw, cancellationRecord)],
  ]);

  upsertJob(updatedJob).catch((e) =>
    console.warn('[job-actions] cancelJob: Supabase sync failed:', e)
  );

  if (params.cancelledByUserId) {
    await incrementReliabilityStats(params.cancelledByUserId, 'cancelledJobs');
  }

  return { updatedJob, resultingStatus };
};

export const isJobChatWritable = (status: JobStatus): boolean => {
  return isActiveJobStatus(status);
};

export const isJobChatAccessible = (job: Partial<Job> | null | undefined): boolean => {
  if (!job) return false;
  return isChatAccessibleForJob(job);
};

export type IssueResolution = 'continue' | 'cancel' | 'complete';

const RESOLUTION_OUTCOME_MAP: Record<IssueResolution, IssueResolutionOutcome> = {
  continue: 'continued',
  cancel: 'cancelled',
  complete: 'completed',
};

const RESOLUTION_STATUS_MAP: Record<IssueResolution, JobStatus> = {
  continue: 'active',
  cancel: 'cancelled',
  complete: 'completed',
};

export const resolveJobIssue = async (params: {
  jobId: string;
  resolution: IssueResolution;
  resolvedByRole: JobParticipantRole;
  note?: string;
}): Promise<{ updatedJob: Job | null; resultingStatus: JobStatus }> => {
  const jobsRaw = await AsyncStorage.getItem(JOBS_STORAGE_KEY);
  const jobs = safeParseJobs(jobsRaw);
  const targetIndex = jobs.findIndex((job) => String(job.id) === String(params.jobId));

  if (targetIndex < 0) {
    return { updatedJob: null, resultingStatus: 'open' };
  }

  const targetJob = jobs[targetIndex];

  if (targetJob.status !== 'issue_reported') {
    return { updatedJob: targetJob, resultingStatus: targetJob.status };
  }

  const resultingStatus = RESOLUTION_STATUS_MAP[params.resolution];

  const updatedJob: Job = {
    ...targetJob,
    status: resultingStatus,
    payment: applyPaymentStateForJobStatus(
      ensureJobPaymentState(targetJob),
      resultingStatus
    ),
    issueSummary: {
      ...targetJob.issueSummary!,
      escalationState: 'resolved',
      resolvedAt: getNowIso(),
      resolvedByRole: params.resolvedByRole,
      resolution: RESOLUTION_OUTCOME_MAP[params.resolution],
    },
  };

  const nextJobs = [...jobs];
  nextJobs[targetIndex] = updatedJob;
  await AsyncStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(nextJobs));

  // Server status='completed' is RPC-only under jobs_update_own — skip the
  // remote sync for the 'complete' branch (local archive only; cross-device
  // completion still requires both parties via confirmJobCompletion).
  // 'continue' (active) and 'cancel' (cancelled) transitions are allowed by
  // policy and continue to sync normally.
  if (resultingStatus !== 'completed') {
    upsertJob(updatedJob).catch((e) =>
      console.warn('[job-actions] resolveJobIssue: Supabase sync failed:', e)
    );
  }

  return { updatedJob, resultingStatus };
};

export const pauseJob = async (params: {
  jobId: string;
  ownerId: string;
}): Promise<{ updatedJob: Job | null; resultingStatus: JobStatus }> => {
  const jobsRaw = await AsyncStorage.getItem(JOBS_STORAGE_KEY);
  const jobs = safeParseJobs(jobsRaw);
  const targetIndex = jobs.findIndex((job) => String(job.id) === String(params.jobId));

  if (targetIndex < 0) {
    return { updatedJob: null, resultingStatus: 'open' };
  }

  const targetJob = jobs[targetIndex];

  if (targetJob.requesterId !== params.ownerId || !isJobPauseable(targetJob)) {
    return { updatedJob: targetJob, resultingStatus: targetJob.status };
  }

  const updatedJob: Job = {
    ...targetJob,
    status: 'paused',
    payment: applyPaymentStateForJobStatus(ensureJobPaymentState(targetJob), 'paused'),
    updatedAt: getNowIso(),
  };

  const nextJobs = [...jobs];
  nextJobs[targetIndex] = updatedJob;
  await AsyncStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(nextJobs));

  upsertJob(updatedJob).catch((e) =>
    console.warn('[job-actions] pauseJob: Supabase sync failed:', e)
  );

  return { updatedJob, resultingStatus: 'paused' };
};

export const resumeJob = async (params: {
  jobId: string;
  ownerId: string;
}): Promise<{ updatedJob: Job | null; resultingStatus: JobStatus }> => {
  const jobsRaw = await AsyncStorage.getItem(JOBS_STORAGE_KEY);
  const jobs = safeParseJobs(jobsRaw);
  const targetIndex = jobs.findIndex((job) => String(job.id) === String(params.jobId));

  if (targetIndex < 0) {
    return { updatedJob: null, resultingStatus: 'open' };
  }

  const targetJob = jobs[targetIndex];

  if (targetJob.requesterId !== params.ownerId || !isJobResumable(targetJob)) {
    return { updatedJob: targetJob, resultingStatus: targetJob.status };
  }

  const updatedJob: Job = {
    ...targetJob,
    status: 'open',
    payment: applyPaymentStateForJobStatus(ensureJobPaymentState(targetJob), 'open'),
    updatedAt: getNowIso(),
  };

  const nextJobs = [...jobs];
  nextJobs[targetIndex] = updatedJob;
  await AsyncStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(nextJobs));

  upsertJob(updatedJob).catch((e) =>
    console.warn('[job-actions] resumeJob: Supabase sync failed:', e)
  );

  return { updatedJob, resultingStatus: 'open' };
};

export type EditableJobFields = {
  problem?: string;
  price?: string;
  basePrice?: number;
  platformFee?: number;
  totalPrice?: number;
  timeMode?: TimeMode;
  appointmentDate?: string;
  appointmentTime?: string;
};

export const editJobFields = async (params: {
  jobId: string;
  ownerId: string;
  fields: EditableJobFields;
}): Promise<{ updatedJob: Job | null; resultingStatus: JobStatus }> => {
  const jobsRaw = await AsyncStorage.getItem(JOBS_STORAGE_KEY);
  const jobs = safeParseJobs(jobsRaw);
  const targetIndex = jobs.findIndex((job) => String(job.id) === String(params.jobId));

  if (targetIndex < 0) {
    return { updatedJob: null, resultingStatus: 'open' };
  }

  const targetJob = jobs[targetIndex];

  if (targetJob.requesterId !== params.ownerId || !isJobEditable(targetJob)) {
    return { updatedJob: targetJob, resultingStatus: targetJob.status };
  }

  const { fields } = params;
  const nextTimeMode = fields.timeMode ?? targetJob.timeMode;
  const nextAppointmentDate = fields.appointmentDate ?? targetJob.appointmentDate;
  const nextAppointmentTime = fields.appointmentTime ?? targetJob.appointmentTime;

  const updatedJob: Job = {
    ...targetJob,
    ...(fields.problem !== undefined && { problem: fields.problem }),
    ...(fields.price !== undefined && { price: fields.price }),
    ...(fields.basePrice !== undefined && { basePrice: fields.basePrice }),
    ...(fields.platformFee !== undefined && { platformFee: fields.platformFee }),
    ...(fields.totalPrice !== undefined && { totalPrice: fields.totalPrice }),
    timeMode: nextTimeMode,
    appointmentDate: nextAppointmentDate,
    appointmentTime: nextAppointmentTime,
    expiresAt: computeExpiresAt(nextTimeMode, nextAppointmentDate, nextAppointmentTime),
    updatedAt: getNowIso(),
  };

  const nextJobs = [...jobs];
  nextJobs[targetIndex] = updatedJob;
  await AsyncStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(nextJobs));

  return { updatedJob, resultingStatus: targetJob.status };
};

export const repostJob = async (params: {
  sourceJobId: string;
  ownerId: string;
}): Promise<{ newJob: Job | null }> => {
  const jobsRaw = await AsyncStorage.getItem(JOBS_STORAGE_KEY);
  const jobs = safeParseJobs(jobsRaw);
  const sourceJob = jobs.find((job) => String(job.id) === String(params.sourceJobId));

  if (!sourceJob) {
    return { newJob: null };
  }

  if (sourceJob.requesterId !== params.ownerId || !isJobRepostable(sourceJob)) {
    return { newJob: null };
  }

  const newJob = createRepostedJob(sourceJob);
  await AsyncStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify([...jobs, newJob]));

  return { newJob };
};

/**
 * Opens a dispute on an active job without changing job status.
 * The job remains 'active' so the chat stays open, but payment release
 * is blocked until the dispute is resolved.
 *
 * BACKEND INTEGRATION POINT — support ticket creation
 * await supportService.createTicket({ jobId, reason, message, reporterRole });
 *
 * BACKEND INTEGRATION POINT — admin dashboard notification
 * await adminNotify('dispute_opened', { jobId, reason, reporterRole });
 *
 * BACKEND INTEGRATION POINT — payment release paused
 * await stripe.paymentIntents.update(job.paymentIntentId, { metadata: { dispute: 'opened' } });
 * Ensure capture webhook checks dispute state before releasing funds.
 *
 * BACKEND INTEGRATION POINT — dispute resolution updates job/payment state
 * When support resolves: set disputeStatus = 'resolved' and re-enable payment flow.
 */
/**
 * Records a two-sided cancellation request from one party.
 * Job status stays unchanged until the other side confirms.
 *
 * BACKEND INTEGRATION POINT — store cancellation request in Supabase
 * await supabase.from('cancellation_requests').insert({ job_id, requested_by, reason, message });
 *
 * BACKEND INTEGRATION POINT — notify other user
 * await pushNotify(otherUserId, { type: 'cancellation_requested', jobId });
 */
export const requestJobCancellation = async (params: {
  jobId: string;
  requestedByRole: JobParticipantRole;
  reason: string;
  message?: string;
}): Promise<{ updatedJob: Job }> => {
  const jobsRaw = await AsyncStorage.getItem(JOBS_STORAGE_KEY);
  const jobs = safeParseJobs(jobsRaw);
  const targetIndex = jobs.findIndex((j) => String(j.id) === String(params.jobId));

  if (targetIndex < 0) {
    throw new Error(`requestJobCancellation: job ${params.jobId} not found`);
  }

  const targetJob = jobs[targetIndex];

  if (targetJob.cancellationStatus === 'requested' || targetJob.cancellationStatus === 'cancelled') {
    return { updatedJob: targetJob };
  }

  const updatedJob: Job = {
    ...targetJob,
    cancellationStatus: 'requested',
    cancelledBy: params.requestedByRole,
    cancellationReason: params.reason,
    cancellationMessage: params.message?.trim() || undefined,
    updatedAt: getNowIso(),
  };

  const nextJobs = [...jobs];
  nextJobs[targetIndex] = updatedJob;
  await AsyncStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(nextJobs));

  return { updatedJob };
};

/**
 * Confirms the cancellation request — transitions job to 'cancelled' and refunds payment.
 *
 * BACKEND INTEGRATION POINT — Stripe PaymentIntent cancellation/refund
 * const pi = targetJob.paymentIntentId;
 * if (pi) await stripe.paymentIntents.cancel(pi); // or stripe.refunds.create(...)
 * Set refundStatus = 'pending'; webhook (charge.refunded) marks it 'processed'.
 *
 * BACKEND INTEGRATION POINT — notify both users of confirmed cancellation
 * await pushNotify([ownerId, buddyId], { type: 'job_cancelled', jobId });
 *
 * BACKEND INTEGRATION POINT — admin/support edge case review
 * If disputed payments exist, flag for manual review before refund.
 */
export const confirmJobCancellation = async (params: {
  jobId: string;
}): Promise<{ updatedJob: Job }> => {
  const jobsRaw = await AsyncStorage.getItem(JOBS_STORAGE_KEY);
  const jobs = safeParseJobs(jobsRaw);
  const targetIndex = jobs.findIndex((j) => String(j.id) === String(params.jobId));

  if (targetIndex < 0) {
    throw new Error(`confirmJobCancellation: job ${params.jobId} not found`);
  }

  const targetJob = jobs[targetIndex];

  const updatedJob: Job = {
    ...targetJob,
    status: 'cancelled',
    cancellationStatus: 'cancelled',
    payment: applyPaymentStateForJobStatus(ensureJobPaymentState(targetJob), 'cancelled'),
    cancellationSummary: {
      cancelledAt: getNowIso(),
      cancelledByRole: targetJob.cancelledBy ?? 'buddy',
      reason: targetJob.cancellationReason ?? 'other',
      note: targetJob.cancellationMessage,
      outcome: 'cancelled',
    },
    updatedAt: getNowIso(),
  };

  const nextJobs = [...jobs];
  nextJobs[targetIndex] = updatedJob;
  await AsyncStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(nextJobs));

  upsertJob(updatedJob).catch((e) =>
    console.warn('[job-actions] confirmJobCancellation: Supabase sync failed:', e)
  );

  return { updatedJob };
};

/**
 * Declines the cancellation request — resets cancellation state, job continues.
 *
 * BACKEND INTEGRATION POINT — notify requester that cancellation was declined
 * await pushNotify(requesterId, { type: 'cancellation_declined', jobId });
 */
export const declineJobCancellation = async (params: {
  jobId: string;
}): Promise<{ updatedJob: Job }> => {
  const jobsRaw = await AsyncStorage.getItem(JOBS_STORAGE_KEY);
  const jobs = safeParseJobs(jobsRaw);
  const targetIndex = jobs.findIndex((j) => String(j.id) === String(params.jobId));

  if (targetIndex < 0) {
    throw new Error(`declineJobCancellation: job ${params.jobId} not found`);
  }

  const targetJob = jobs[targetIndex];
  const updatedJob: Job = {
    ...targetJob,
    cancellationStatus: 'none',
    cancelledBy: undefined,
    cancellationReason: undefined,
    cancellationMessage: undefined,
    updatedAt: getNowIso(),
  };

  const nextJobs = [...jobs];
  nextJobs[targetIndex] = updatedJob;
  await AsyncStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(nextJobs));

  return { updatedJob };
};

export const openJobDispute = async (params: {
  jobId: string;
  reporterRole: JobParticipantRole;
  reason: string;
  message?: string;
}): Promise<{ updatedJob: Job }> => {
  const jobsRaw = await AsyncStorage.getItem(JOBS_STORAGE_KEY);
  const jobs = safeParseJobs(jobsRaw);
  const targetIndex = jobs.findIndex((j) => String(j.id) === String(params.jobId));

  if (targetIndex < 0) {
    throw new Error(`openJobDispute: job ${params.jobId} not found`);
  }

  const targetJob = jobs[targetIndex];

  // Guard: do not re-open an already open dispute
  if (targetJob.disputeStatus === 'opened') {
    return { updatedJob: targetJob };
  }

  const updatedJob: Job = {
    ...targetJob,
    disputeStatus: 'opened',
    disputeReason: params.reason,
    disputeMessage: params.message?.trim() || undefined,
    updatedAt: getNowIso(),
  };

  const nextJobs = [...jobs];
  nextJobs[targetIndex] = updatedJob;
  await AsyncStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(nextJobs));

  return { updatedJob };
};

/**
 * Records one side's completion confirmation.
 * On first confirmation: sets the caller's flag and returns bothConfirmed = false.
 * On second confirmation: both flags are set, job transitions to 'completed',
 * and payment release is triggered — returns bothConfirmed = true.
 *
 * BACKEND INTEGRATION POINT — payout release (same as completeJob)
 * When bothConfirmed = true, trigger a Stripe Connect transfer:
 *   await stripe.paymentIntents.capture(job.paymentIntentId);
 *   await stripe.transfers.create({
 *     amount: job.buddyEarnings * 100,
 *     currency: 'eur',
 *     destination: buddy.stripeAccountId,
 *     transfer_group: job.id,
 *   });
 * Set paymentStatus = 'release_pending'; a webhook (transfer.paid) sets it to 'paid'.
 */
export const confirmJobCompletion = async (params: {
  jobId: string;
  confirmedByRole: JobParticipantRole;
}): Promise<{ updatedJob: Job; bothConfirmed: boolean }> => {
  const jobsRaw = await AsyncStorage.getItem(JOBS_STORAGE_KEY);
  const jobs = safeParseJobs(jobsRaw);
  const targetIndex = jobs.findIndex((j) => String(j.id) === String(params.jobId));

  if (targetIndex < 0) {
    throw new Error(`confirmJobCompletion: job ${params.jobId} not found`);
  }

  const targetJob = jobs[targetIndex];
  const now = getNowIso();

  const current: JobCompletionConfirmation = targetJob.completionConfirmation ?? {};
  const next: JobCompletionConfirmation = {
    ...current,
    ...(params.confirmedByRole === 'auftraggeber'
      ? { ownerConfirmedAt: current.ownerConfirmedAt ?? now }
      : { buddyConfirmedAt: current.buddyConfirmedAt ?? now }),
  };

  let bothConfirmed = Boolean(next.ownerConfirmedAt && next.buddyConfirmedAt);

  // Server-backed: RPC sets the caller's timestamp and returns the full updated row.
  // v2 returns public.jobs row (not text), so check row.status instead of string equality.
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase.rpc('confirm_job_completion', {
        p_job_id: params.jobId,
      });
      const row = data as {
        status: string;
        owner_completed_at: string | null;
        buddy_completed_at: string | null;
      } | null;
      debugLog(
        `[job-actions] confirm_job_completion rpc: role=${params.confirmedByRole}` +
        ` status=${row?.status ?? 'null'} owner_at=${row?.owner_completed_at ?? 'null'}` +
        ` buddy_at=${row?.buddy_completed_at ?? 'null'} error=${error?.message ?? 'none'}`
      );
      if (error) {
        console.warn('[job-actions] confirm_job_completion rpc error:', error.message);
      } else if (row) {
        // Sync timestamps from the authoritative server row.
        if (row.owner_completed_at) next.ownerConfirmedAt = row.owner_completed_at;
        if (row.buddy_completed_at) next.buddyConfirmedAt = row.buddy_completed_at;
        if (row.status === 'completed' || (row.owner_completed_at && row.buddy_completed_at)) {
          bothConfirmed = true;
        }
      }
    } catch (e) {
      console.warn('[job-actions] confirm_job_completion rpc error:', e);
    }
  }

  const updatedJob: Job = {
    ...targetJob,
    completionConfirmation: next,
    updatedAt: now,
    ...(bothConfirmed
      ? {
          status: 'completed',
          payment: applyPaymentStateForJobStatus(ensureJobPaymentState(targetJob), 'completed'),
        }
      : {}),
  };

  const nextJobs = [...jobs];
  nextJobs[targetIndex] = updatedJob;
  await AsyncStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(nextJobs));

  upsertJob(updatedJob).catch((e) =>
    console.warn('[job-actions] confirmJobCompletion: Supabase sync failed:', e)
  );

  console.log(
    `[job-actions] confirmed: job=${params.jobId} role=${params.confirmedByRole}` +
    ` bothConfirmed=${bothConfirmed} status=${updatedJob.status}`
  );

  return { updatedJob, bothConfirmed };
};

/**
 * Transitions a job to 'completed' and applies the corresponding payment state.
 * Single source of truth for job completion — replaces scattered manual mutations
 * in UI screens. Swap AsyncStorage for an API call here when the backend is ready.
 */
export const completeJob = async (params: {
  jobId: string;
  completedByRole: JobParticipantRole;
}): Promise<{ updatedJob: Job }> => {
  const jobsRaw = await AsyncStorage.getItem(JOBS_STORAGE_KEY);
  const jobs = safeParseJobs(jobsRaw);
  const targetIndex = jobs.findIndex((j) => String(j.id) === String(params.jobId));

  if (targetIndex < 0) {
    throw new Error(`completeJob: job ${params.jobId} not found`);
  }

  const targetJob = jobs[targetIndex];

  // BACKEND INTEGRATION POINT — payout release
  // In production, trigger a Stripe Connect transfer here after capturing the PaymentIntent:
  //   await stripe.paymentIntents.capture(job.paymentIntentId);
  //   await stripe.transfers.create({
  //     amount: job.buddyEarnings * 100,
  //     currency: 'eur',
  //     destination: buddy.stripeAccountId,
  //     transfer_group: job.id,
  //   });
  // Set paymentStatus = 'release_pending'; a webhook (transfer.paid) sets it to 'paid'.
  const updatedJob: Job = {
    ...targetJob,
    status: 'completed',
    updatedAt: getNowIso(),
    payment: applyPaymentStateForJobStatus(
      ensureJobPaymentState(targetJob),
      'completed'
    ),
  };

  const nextJobs = [...jobs];
  nextJobs[targetIndex] = updatedJob;
  await AsyncStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(nextJobs));

  // Local-only completion: status='completed' is RPC-only under jobs_update_own.
  // The authoritative cross-device path is confirmJobCompletion (two-way RPC).
  // Feed / active-jobs use this for local archive UX; server reflects the real
  // status once both sides confirm via chat.

  return { updatedJob };
};

/**
 * Stores a post-job rating from one side and sets the explicit rated flag.
 * Source of truth for "already rated" is job.reviews; the flag fields are
 * a denormalized convenience for quick UI checks.
 *
 * BACKEND INTEGRATION POINT — ratings table insert
 * Replace local write with:
 *   await supabase.from('ratings').insert({
 *     job_id: jobId, rater_role: raterRole, rating, review_text: reviewText,
 *     ratee_id: raterRole === 'auftraggeber' ? job.assignedBuddyId : job.requesterId,
 *   });
 *
 * BACKEND INTEGRATION POINT — aggregate rating update
 * After insert, call:
 *   await supabase.rpc('refresh_user_rating_aggregate', { user_id: rateeId });
 */
export const submitJobRating = async (params: {
  jobId: string;
  raterRole: JobParticipantRole;
  rating: 1 | 2 | 3 | 4 | 5;
  reviewText?: string;
}): Promise<{ updatedJob: Job }> => {
  const jobsRaw = await AsyncStorage.getItem(JOBS_STORAGE_KEY);
  const jobs = safeParseJobs(jobsRaw);
  const targetIndex = jobs.findIndex((j) => String(j.id) === String(params.jobId));

  if (targetIndex < 0) {
    throw new Error(`submitJobRating: job ${params.jobId} not found`);
  }

  const targetJob = jobs[targetIndex];
  const now = getNowIso();
  const revieweeRole: JobParticipantRole =
    params.raterRole === 'auftraggeber' ? 'buddy' : 'auftraggeber';

  const newReview: JobRoleReview = {
    id: `${params.jobId}_${params.raterRole}_${Date.now()}`,
    jobId: params.jobId,
    reviewerRole: params.raterRole,
    revieweeRole,
    rating: params.rating,
    reviewText: params.reviewText?.trim() || undefined,
    reviewerName: params.raterRole === 'auftraggeber' ? 'Auftraggeber' : 'Buddy',
    reviewedAt: now,
  };

  const existingReviews: JobRoleReview[] = Array.isArray(targetJob.reviews)
    ? (targetJob.reviews as JobRoleReview[])
    : [];

  // Guard against double-submit
  if (existingReviews.some((r) => r.reviewerRole === params.raterRole)) {
    return { updatedJob: targetJob };
  }

  const isOwnerRating = params.raterRole === 'auftraggeber';

  const updatedJob: Job = {
    ...targetJob,
    reviews: [newReview, ...existingReviews],
    ...(isOwnerRating
      ? { ownerRatedBuddy: true, ownerRatingForBuddy: params.rating }
      : { buddyRatedOwner: true, buddyRatingForOwner: params.rating }),
    // Mirror the latest buddy-facing rating onto the legacy review field
    ...(!isOwnerRating ? {} : { review: { rating: params.rating, reviewText: params.reviewText?.trim(), reviewedAt: now } }),
    updatedAt: now,
  };

  const nextJobs = [...jobs];
  nextJobs[targetIndex] = updatedJob;
  await AsyncStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(nextJobs));

  const reviewerId =
    params.raterRole === 'auftraggeber' ? targetJob.requesterId : targetJob.assignedBuddyId;
  const revieweeId =
    params.raterRole === 'auftraggeber' ? targetJob.assignedBuddyId : targetJob.requesterId;

  if (reviewerId && revieweeId) {
    insertReview({
      jobId: params.jobId,
      reviewerId,
      revieweeId,
      rating: params.rating,
      body: params.reviewText,
    }).catch((e) => console.warn('[job-actions] submitJobRating: review insert failed:', e));
  }

  return { updatedJob };
};
