/**
 * Job applications service — Supabase-backed with AsyncStorage fallback.
 *
 * Phase 1 dual-write strategy:
 *   - Applications are written to the `job_applications` Supabase table AND embedded
 *     in the job's JSONB payload (via job-actions.ts → AsyncStorage → jobs.service upsert).
 *   - The `job_applications` table is the authoritative source for relational queries.
 *   - The JSONB payload remains the source for in-memory renders (job.match.applications).
 *
 * createJobRequest / updateJobRequest return { request, updatedJob } so callers can
 * update their local job state without a separate fetch.
 */

import { isSupabaseConfigured } from '../lib/config/env';
import { debugLog } from '../lib/config/debug';
import { supabase } from '../lib/supabase/client';
import { Job } from '../lib/jobs';
import { JobRequest, JobRequestStatus, jobRequestFromApplicationState } from '../lib/job-request';
import {
  requestJobApplication,
  reviewJobApplication,
  JobApplicantProfile,
} from '../lib/job-actions';
import { upsertJob, getJobById } from './jobs.service';

// Jobs created offline/dev start with a timestamp id; only UUID ids exist remotely.
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Supabase row type & converters ───────────────────────────────────────────

type JobApplicationRow = {
  id: string;
  job_id: string;
  buddy_id: string;
  buddy_name: string;
  buddy_score: number | null;
  buddy_rating_average: number | null;
  buddy_rating_count: number | null;
  buddy_completed_jobs: number | null;
  buddy_reliability: string | null;
  status: string;
  note?: string | null;
  created_at: string;
  updated_at: string;
};

const rowToJobRequest = (row: JobApplicationRow): JobRequest => ({
  id: row.id,
  jobId: row.job_id,
  buddyId: row.buddy_id,
  buddyName: row.buddy_name,
  buddyScore: row.buddy_score ?? undefined,
  buddyRatingAverage: row.buddy_rating_average ?? undefined,
  buddyRatingCount: row.buddy_rating_count ?? undefined,
  buddyCompletedJobs: row.buddy_completed_jobs ?? undefined,
  buddyReliability: (row.buddy_reliability as JobRequest['buddyReliability']) ?? undefined,
  status: row.status as JobRequestStatus,
  note: row.note ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// ─── Supabase write helpers ────────────────────────────────────────────────────

type InsertResult = { request: JobRequest | null; alreadyFinalized: boolean };

// TODO(rate-limit): enforce per-user application rate limit (e.g. 10/hour) to prevent spam applications.
const insertApplicationRow = async (
  jobId: string,
  applicant: JobApplicantProfile
): Promise<InsertResult> => {
  if (!isSupabaseConfigured) return { request: null, alreadyFinalized: false };
  try {
    // Use RPC instead of direct insert to avoid PostgREST binding job_id as
    // text (42804). The RPC signature declares p_job_id as uuid so PostgreSQL
    // handles the cast at the call boundary. buddy_id is derived server-side
    // from auth.uid(). buddy_name is derived server-side from profiles.username
    // by trg_sanitize_job_application_reputation — client-supplied values not sent.
    debugLog(`[job-requests.service] apply_to_job rpc start: job=${jobId}`);

    const { data, error } = await supabase.rpc('apply_to_job', {
      p_job_id: jobId,
    });

    if (error) {
      if (error.message === 'application_already_finalized') {
        console.warn(`[job-requests.service] rpc blocked: application_already_finalized job=${jobId}`);
        return { request: null, alreadyFinalized: true };
      }
      // 23505 = unique_violation: pending row already exists — idempotent
      if (error.code === '23505') {
        debugLog(`[job-requests.service] rpc skipped: duplicate application job=${jobId}`);
        return { request: null, alreadyFinalized: false };
      }
      console.warn(`[job-requests.service] rpc error: job=${jobId} code=${error.code} message="${error.message}"`);
      return { request: null, alreadyFinalized: false };
    }

    const rows = data as JobApplicationRow[] | null;
    const inserted = rows?.[0] ?? null;
    if (!inserted) {
      console.warn(`[job-requests.service] rpc returned no row: job=${jobId}`);
      return { request: null, alreadyFinalized: false };
    }
    console.log(`[job-requests.service] applied: applicationId=${inserted.id} job=${jobId}`);
    return { request: rowToJobRequest(inserted), alreadyFinalized: false };
  } catch (e) {
    console.warn('[job-requests.service] insert error:', e);
    return { request: null, alreadyFinalized: false };
  }
};

// Uses SECURITY DEFINER RPC (runs as postgres, BYPASSRLS) to avoid:
//   • RLS infinite recursion from the old self-referential WITH CHECK policy
//   • PostgREST text-binding issues with uuid job_id in direct UPDATE filters
// The RPC also atomically rejects other pending applications on accept.
const reviewApplicationRemote = async (
  jobId: string,
  buddyId: string,
  decision: 'accepted' | 'rejected'
): Promise<boolean> => {
  if (!isSupabaseConfigured) return false;
  try {
    debugLog(`[job-requests.service] review_job_application rpc start: job=${jobId} buddy=${buddyId} decision=${decision}`);
    const { error } = await supabase.rpc('review_job_application', {
      p_job_id:   jobId,
      p_buddy_id: buddyId,
      p_decision: decision,
    });
    if (error) {
      console.warn(`[job-requests.service] review_job_application rpc failed: ${error.message} code=${error.code}`);
      return false;
    }
    console.log(`[job-requests.service] reviewed: job=${jobId} decision=${decision}`);
    return true;
  } catch (e) {
    console.warn('[job-requests.service] reviewApplicationRemote error:', e);
    return false;
  }
};

// ─── Owner-side applicant preview ─────────────────────────────────────────────

export type ApplicantPreview = {
  buddyId: string;
  buddyName: string;
  avatarUrl: string | null;
  buddyScore: number | null;
  buddyRatingAverage: number | null;
  buddyRatingCount: number | null;
  buddyCompletedJobs: number | null;
  buddyReliability: string | null;
};

export const fetchApplicantPreview = async (
  jobId: string,
  buddyId: string
): Promise<ApplicantPreview | null> => {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase
      .from('job_applications')
      .select(
        'buddy_id, buddy_name, buddy_score, buddy_rating_average, buddy_rating_count, buddy_completed_jobs, buddy_reliability'
      )
      .eq('job_id', jobId)
      .eq('buddy_id', buddyId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as {
      buddy_id: string;
      buddy_name: string;
      buddy_score: number | null;
      buddy_rating_average: number | null;
      buddy_rating_count: number | null;
      buddy_completed_jobs: number | null;
      buddy_reliability: string | null;
    };
    // Fetch avatar separately from profiles (no direct FK from job_applications to profiles)
    let avatarUrl: string | null = null;
    try {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('avatar_url')
        .eq('id', buddyId)
        .maybeSingle();
      avatarUrl = (profileData as { avatar_url: string | null } | null)?.avatar_url ?? null;
    } catch { /* avatar is optional — swallow */ }

    return {
      buddyId: row.buddy_id,
      buddyName: row.buddy_name ?? '',
      avatarUrl,
      buddyScore: row.buddy_score,
      buddyRatingAverage: row.buddy_rating_average,
      buddyRatingCount: row.buddy_rating_count,
      buddyCompletedJobs: row.buddy_completed_jobs,
      buddyReliability: row.buddy_reliability,
    };
  } catch (e) {
    console.warn('[job-requests.service] fetchApplicantPreview error:', e);
    return null;
  }
};

// ─── Public API ────────────────────────────────────────────────────────────────

export const getJobRequestsForJob = async (
  jobId: string,
  _userId?: string
): Promise<JobRequest[]> => {
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase
        .from('job_applications')
        .select('*')
        .eq('job_id', jobId)
        .order('created_at', { ascending: true });
      if (!error && data) return (data as JobApplicationRow[]).map(rowToJobRequest);
    } catch { /* fall through */ }
  }
  const job = await getJobById(jobId, _userId);
  if (!job) return [];
  return (job.match?.applications ?? []).map((app) =>
    jobRequestFromApplicationState(app, jobId)
  );
};

export const getJobRequestsByBuddy = async (
  buddyId: string,
  _userId?: string
): Promise<JobRequest[]> => {
  // TODO(backend): also filter by date range for performance at scale
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase
        .from('job_applications')
        .select('*')
        .eq('buddy_id', buddyId)
        .order('created_at', { ascending: false });
      if (!error && data) return (data as JobApplicationRow[]).map(rowToJobRequest);
    } catch { /* fall through */ }
  }
  return [];
};

export const createJobRequest = async (
  params: {
    jobId: string;
    applicant: JobApplicantProfile;
  },
  _userId?: string
): Promise<{ request: JobRequest | null; updatedJob: Job | null; alreadyFinalized?: boolean }> => {
  // 1. Write to AsyncStorage via job-actions (keeps job.match.applications in sync)
  const result = await requestJobApplication(params);
  if (!result.updatedJob) return { request: null, updatedJob: null };

  // 2. Sync updated job (including new application in payload) to Supabase
  if (isSupabaseConfigured) {
    await upsertJob(result.updatedJob);
  }

  // 3. Write dedicated row to job_applications table
  const { request: insertedRequest, alreadyFinalized } = await insertApplicationRow(
    params.jobId,
    params.applicant
  );
  if (alreadyFinalized) return { request: null, updatedJob: null, alreadyFinalized: true };

  const request =
    insertedRequest ??
    (result.updatedJob.match?.applications
      ?.filter((a) => a.buddyId === params.applicant.buddyId)
      ?.map((a) => jobRequestFromApplicationState(a, params.jobId))[0] ?? null);

  return { request, updatedJob: result.updatedJob };
};

export const updateJobRequest = async (
  params: {
    jobId: string;
    buddyId: string;
    decision: 'accept' | 'decline' | 'wait';
    requesterId?: string;
    note?: string;
  },
  _userId?: string
): Promise<{ request: JobRequest | null; updatedJob: Job | null; rpcSuccess: boolean }> => {
  // 0. Server FIRST for real (synced) jobs. review_job_application is the
  //    authoritative write: job_applications.status, jobs.status='matched' and
  //    jobs.assigned_buddy_id all flip server-side. If that RPC fails we must
  //    NOT mutate local state — otherwise the owner's device shows 'matched'
  //    while the server (and therefore the buddy's device) stays 'open'/
  //    'pending' forever. Callers gate navigation on rpcSuccess.
  //    Local-only jobs (no Supabase / non-UUID id) have no remote op — treated
  //    as success so the dev/offline flow keeps working.
  let rpcSuccess = true;
  const isRemoteJob = isSupabaseConfigured && UUID_REGEX.test(params.jobId);
  if (isRemoteJob && params.decision !== 'wait') {
    const dbDecision = params.decision === 'accept' ? 'accepted' : 'rejected';
    rpcSuccess = await reviewApplicationRemote(params.jobId, params.buddyId, dbDecision);
    if (!rpcSuccess) {
      return { request: null, updatedJob: null, rpcSuccess: false };
    }
  }

  // 1. Apply decision in AsyncStorage via job-actions
  let result = await reviewJobApplication({
    jobId: params.jobId,
    buddyId: params.buddyId,
    decision: params.decision,
    requesterId: params.requesterId,
    note: params.note,
  });

  // Cross-device recovery: the application may only exist in job_applications table
  // (buddy applied on their device; the owner's local job.match.applications is empty).
  // Fetch the DB row, inject a synthetic application into local state, then retry accept.
  if (
    params.decision === 'accept' &&
    result.updatedJob &&
    result.updatedJob.status !== 'matched' &&
    isSupabaseConfigured
  ) {
    try {
      const { data: appRow, error: fetchErr } = await supabase
        .from('job_applications')
        .select('*')
        .eq('job_id', params.jobId)
        .eq('buddy_id', params.buddyId)
        .maybeSingle();

      if (!fetchErr && appRow) {
        const app = appRow as JobApplicationRow;
        await requestJobApplication({
          jobId: params.jobId,
          applicant: {
            buddyId: app.buddy_id,
          },
        });
        result = await reviewJobApplication({
          jobId: params.jobId,
          buddyId: params.buddyId,
          decision: params.decision,
          requesterId: params.requesterId,
          note: params.note,
        });
        debugLog(`[job-requests.service] updateJobRequest: cross-device recovery result status=${result.updatedJob?.status}`);
      } else if (fetchErr) {
        console.warn('[job-requests.service] updateJobRequest: cross-device recovery fetch failed:', fetchErr.message);
      }
    } catch (e) {
      console.warn('[job-requests.service] updateJobRequest: cross-device recovery error:', e);
    }
  }

  if (!result.updatedJob) return { request: null, updatedJob: null, rpcSuccess };

  // 2. (Server write already happened in step 0 — before any local mutation.)
  //    The jobs_update_own RLS blocks direct client writes to the protected
  //    columns (status, assigned_buddy_id), so the upsert below only echoes
  //    the values the RPC just set (IS NOT DISTINCT FROM).

  // 3. Sync the updated job to Supabase to persist payload fields
  //    (match.applications etc). Protected columns (status, assigned_buddy_id)
  //    were already set by the RPC; the upsert echoes them.
  if (isSupabaseConfigured) {
    await upsertJob(result.updatedJob);
  }

  const app = result.updatedJob.match?.applications?.find(
    (a) => a.buddyId === params.buddyId
  );
  const request = app ? jobRequestFromApplicationState(app, params.jobId) : null;

  return { request, updatedJob: result.updatedJob, rpcSuccess };
};
