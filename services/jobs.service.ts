/**
 * Job service — Supabase-backed with AsyncStorage fallback.
 *
 * Phase 1 dual-write strategy:
 *   - New jobs are written to Supabase AND AsyncStorage.
 *   - Reads merge Supabase (authoritative for feed/discovery) with AsyncStorage
 *     (holds locally-mutated lifecycle state from job-actions.ts until Phase 2).
 *   - job-actions.ts still writes to AsyncStorage directly for applications,
 *     matches, disputes, cancellations — those local mutations win the merge.
 *
 * Phase 2: migrate job-actions.ts mutations to Supabase; remove dual-write.
 *
 * RLS (see supabase/migrations/20260506_jobs.sql):
 *   SELECT: open jobs (public feed) + owner's own jobs
 *   INSERT/UPDATE/DELETE: creator_id = auth.uid() only
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { isSupabaseConfigured } from '../lib/config/env';
import { debugLog } from '../lib/config/debug';
import { supabase } from '../lib/supabase/client';
import { Job, JobStatus, ACTIVE_JOB_STATUSES } from '../lib/jobs';
import { STORAGE_KEYS } from '../lib/storage-keys';

// ─── Local (AsyncStorage) helpers ─────────────────────────────────────────────

const safeParseJobs = (raw: string | null): Job[] => {
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const loadLocalJobs = async (): Promise<Job[]> => {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.JOBS);
  return safeParseJobs(raw);
};

const saveLocalJobs = async (jobs: Job[]): Promise<void> => {
  await AsyncStorage.setItem(STORAGE_KEYS.JOBS, JSON.stringify(jobs));
};

// ─── Supabase row type & converters ───────────────────────────────────────────
//
// jobs table columns: id, creator_id, status, category, expires_at,
//   created_at, updated_at, payload jsonb, title text.
//
// `payload` carries all job content (problem, price, location, etc.) so the
// full Job model can be hydrated from Supabase without AsyncStorage.
// `title` is a convenience column for dashboard queries (mirrors payload.problem).
// Phase 2: promote match/payment/media to dedicated tables; remove payload blob.

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUUID = (s: string): boolean => UUID_REGEX.test(s);

// Columns that exist in the deployed jobs table.
// description, price, time_mode, radius_km are promoted convenience columns
// (NOT NULL in the deployed schema) AND are mirrored in payload jsonb.
// Payload remains the authoritative source for frontend hydration.
export type JobRow = {
  id: string;
  creator_id: string;
  title: string;
  description: string;
  price: string;
  time_mode: string;
  radius_km: number;
  status: string;
  category: string;
  expires_at: string | null;
  assigned_buddy_id: string | null;
  owner_completed_at: string | null;
  buddy_completed_at: string | null;
  created_at: string;
  updated_at: string;
  payload: Record<string, unknown>;
};

// Completion columns are owned exclusively by the confirm_job_completion RPC.
// Never include them in insert/upsert payloads — PostgREST rejects unknown columns (PGRST204).
type JobInsertBody = Omit<JobRow, 'id' | 'owner_completed_at' | 'buddy_completed_at'>;

// Serialise content fields into the payload JSONB column.
// Excludes match/payment/media — those are lifecycle state managed locally
// until Phase 2 moves them to dedicated tables.
const buildPayload = (job: Job): Record<string, unknown> => ({
  problem: job.problem,
  price: job.price,
  basePrice: job.basePrice,
  platformFee: job.platformFee,
  totalPrice: job.totalPrice,
  time: job.time,
  timeMode: job.timeMode,
  flexibleRange: job.flexibleRange,
  appointmentDate: job.appointmentDate,
  appointmentTime: job.appointmentTime,
  location: job.location,
  creatorName: job.creatorName,
  priceType: job.priceType,
  priceAmount: job.priceAmount,
  rebooking: job.rebooking,
  assignedBuddyId: job.assignedBuddyId,
  // media: remote URLs only — local file:// URIs are filtered so the other
  // device can actually load them.
  media: (job.media ?? []).filter((u) => u.startsWith('http')),
});

// Hydrate a Job from a Supabase row. All content fields come from payload jsonb.
// title is the only promoted text column (used as search/display convenience).
export const rowToJob = (row: JobRow): Job => {
  const p: Record<string, unknown> = row.payload ?? {};
  return {
    id: row.id,
    requesterId: row.creator_id,
    status: row.status as Job['status'],
    category: row.category as Job['category'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at ?? undefined,
    problem: (p.problem as string) || row.description || row.title || '',
    price: (p.price as string) || row.price || '0',
    basePrice: (p.basePrice as number) || undefined,
    platformFee: (p.platformFee as number) || undefined,
    totalPrice: (p.totalPrice as number) || undefined,
    time: (p.time as string) || '',
    timeMode: (p.timeMode as Job['timeMode']) || (row.time_mode as Job['timeMode']) || 'sofort',
    flexibleRange: (p.flexibleRange as string) || undefined,
    appointmentDate: (p.appointmentDate as string) || undefined,
    appointmentTime: (p.appointmentTime as string) || undefined,
    location: (p.location as Job['location']) || undefined,
    creatorName: (p.creatorName as string) || undefined,
    priceType: (p.priceType as Job['priceType']) || undefined,
    priceAmount: (p.priceAmount as number) || undefined,
    rebooking: (p.rebooking as Job['rebooking']) || undefined,
    assignedBuddyId: row.assigned_buddy_id || (p.assignedBuddyId as string) || undefined,
    completionConfirmation: (() => {
      const o = row.owner_completed_at;
      const b = row.buddy_completed_at;
      if (!o && !b) return undefined;
      return { ...(o ? { ownerConfirmedAt: o } : {}), ...(b ? { buddyConfirmedAt: b } : {}) };
    })(),
    media: (() => {
      const urls = Array.isArray(p.media)
        ? (p.media as string[]).filter((u) => typeof u === 'string' && u.startsWith('http'))
        : [];
      return urls.length ? urls : undefined;
    })(),
  };
};

const jobToInsertBody = (job: Job): JobInsertBody => ({
  // creator_id is always overridden with session uid in syncJobToSupabase —
  // this placeholder is only for the type; it is never sent to Supabase as-is.
  creator_id: job.requesterId ?? '',
  title: job.problem?.trim() || 'Neuer Auftrag',
  // Promoted convenience columns — NOT NULL in deployed schema.
  // Values are mirrored in payload; payload remains the frontend source of truth.
  description: job.problem?.trim() || '',
  price: String(job.price ?? '0'),
  time_mode: job.timeMode ?? 'sofort',
  radius_km: 10,
  status: job.status,
  category: job.category,
  expires_at: job.expiresAt ?? null,
  assigned_buddy_id: job.assignedBuddyId ?? null,
  created_at: job.createdAt ?? new Date().toISOString(),
  updated_at: new Date().toISOString(),
  payload: buildPayload(job),
});

// ─── Supabase operations ───────────────────────────────────────────────────────

const fetchAllAccessibleJobs = async (): Promise<Job[] | null> => {
  try {
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('[jobs.service] Supabase fetch failed:', error.message);
      return null;
    }
    const rows = data as JobRow[];
    return rows.map(rowToJob);
  } catch (e) {
    console.warn('[jobs.service] Supabase unreachable:', e);
    return null;
  }
};

// Returns the canonical Supabase UUID for the job (may differ from job.id when
// the local job was created with a timestamp id and is being inserted for the first time).
const syncJobToSupabase = async (job: Job): Promise<string | null> => {
  // Always derive creator_id from the live Supabase session.
  // job.requesterId may hold a local/dev id that doesn't exist in auth.users —
  // trusting it directly causes FK violations and RLS rejections.
  const { data: { session } } = await supabase.auth.getSession();
  const authUserId = session?.user?.id;

  if (!authUserId) {
    debugLog('[jobs.service] syncJobToSupabase: no authenticated session — skipping (local-only job)');
    return null;
  }

  if (isUUID(job.id) && job.requesterId && job.requesterId !== authUserId) {
    // Defense in depth: upsertJob should already have short-circuited this path.
    // If we get here it means a caller invoked syncJobToSupabase directly with
    // a non-owned job — silently skip to avoid RLS violation, no warning since
    // the situation is benign and recoverable.
    debugLog(
      `[jobs.service] syncJobToSupabase: non-owner skip job=${job.id} owner=${job.requesterId} session=${authUserId}`
    );
    return null;
  }

  if (job.requesterId && job.requesterId !== authUserId) {
    debugLog(
      `[jobs.service] syncJobToSupabase: new job requesterId="${job.requesterId}" overridden with session uid="${authUserId}"`
    );
  }

  const body: JobInsertBody = { ...jobToInsertBody(job), creator_id: authUserId };

  const t0 = Date.now();
  try {
    if (isUUID(job.id)) {
      const { error } = await supabase
        .from('jobs')
        .upsert({ id: job.id, ...body }, { onConflict: 'id' });
      if (error) {
        console.warn('[jobs.service] upsert failed:', job.id, error.message, error.code);
      } else {
        debugLog(`[jobs.service] UPSERT job=${job.id} status=${job.status} ${Date.now() - t0}ms`);
      }
      return job.id;
    } else {
      const { data, error } = await supabase
        .from('jobs')
        .insert(body)
        .select('id')
        .single();
      if (error) {
        console.warn('[jobs.service] insert failed:', job.id, error.message, error.code);
        return null;
      }
      const supabaseId = (data as { id: string }).id;
      debugLog(`[jobs.service] INSERT localId=${job.id} → ${supabaseId} ${Date.now() - t0}ms`);
      return supabaseId;
    }
  } catch (e) {
    console.warn('[jobs.service] syncJobToSupabase: unexpected error:', e);
    return null;
  }
};

// ─── Merge: Supabase is authoritative for content; local owns lifecycle state ──
//
// Remote (Supabase) carries the canonical job content written at creation time.
// Local (AsyncStorage) carries lifecycle mutations (match, payment, dispute, etc.)
// that haven't yet been promoted to dedicated backend tables (Phase 2).
//
// Merge rules per job:
//   - If only remote exists: use remote.
//   - If only local exists: use local (unsynced new job or orphaned local entry).
//   - If both exist: use remote content fields + local lifecycle fields, unless
//     the local version is newer AND has richer lifecycle state.
//
// Status precedence: always use the more advanced lifecycle status so that
// cross-device state changes (e.g. owner accepts → remote becomes 'matched')
// propagate correctly to other devices even when they have local lifecycle state.

const STATUS_PRECEDENCE: Record<string, number> = {
  open: 0,
  paused: 1,
  matched: 2,
  active: 3,
  issue_reported: 3,
  completed: 4,
  cancelled: 4,
};

const advancedStatus = (a: string, b: string): string =>
  (STATUS_PRECEDENCE[b] ?? 0) > (STATUS_PRECEDENCE[a] ?? 0) ? b : a;

const mergeJobs = (remote: Job[], local: Job[]): Job[] => {
  const localById = new Map<string, Job>();
  for (const j of local) localById.set(j.id, j);

  const merged = new Map<string, Job>();

  for (const remoteJob of remote) {
    const localJob = localById.get(remoteJob.id);
    if (!localJob) {
      merged.set(remoteJob.id, remoteJob);
    } else {
      const localMs = localJob.updatedAt ? new Date(localJob.updatedAt).getTime() : 0;
      const remoteMs = remoteJob.updatedAt ? new Date(remoteJob.updatedAt).getTime() : 0;
      const localHasLifecycle = !!(localJob.match || (localJob.payment && localJob.payment.paymentStatus !== 'none'));

      if (localMs >= remoteMs || localHasLifecycle) {
        // Local is more recent or carries lifecycle state — preserve it but
        // backfill any content fields the remote now has that local is missing.
        merged.set(remoteJob.id, {
          ...remoteJob,
          ...localJob,
          // Use the more advanced lifecycle status so cross-device state changes
          // (e.g. owner accepts on their device → remote becomes 'matched') propagate
          // to other devices that have local lifecycle state but stale local status.
          status: (localHasLifecycle
            ? advancedStatus(localJob.status, remoteJob.status)
            : localJob.status === 'expired' && localJob.expiresAt && Date.now() > new Date(localJob.expiresAt).getTime()
            ? 'expired'
            : remoteJob.status) as Job['status'],
          category: remoteJob.category,
          expiresAt: remoteJob.expiresAt,
          // Remote is authoritative for server-set fields the local device never writes.
          assignedBuddyId: localJob.assignedBuddyId ?? remoteJob.assignedBuddyId,
          // Prefer whichever side has more completion data (remote is authoritative for cross-device)
          completionConfirmation: localJob.completionConfirmation ?? remoteJob.completionConfirmation,
        });
      } else {
        // Remote is more recent: use remote content, preserve local lifecycle.
        merged.set(remoteJob.id, {
          ...remoteJob,
          match: localJob.match,
          payment: localJob.payment,
          reviews: localJob.reviews,
          issueSummary: localJob.issueSummary,
          cancellationSummary: localJob.cancellationSummary,
          completionConfirmation: localJob.completionConfirmation,
        });
      }
    }
    localById.delete(remoteJob.id);
  }

  // Local-only jobs not yet synced to Supabase (e.g. just created, pending UUID)
  for (const localJob of localById.values()) {
    merged.set(localJob.id, localJob);
  }

  return [...merged.values()].sort((a, b) => {
    const aMs = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bMs = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bMs - aMs;
  });
};

// ─── Public API ────────────────────────────────────────────────────────────────

// Concurrency guard. Multiple callers (feed focus, chat mount, notifications
// refresh, job-detail mount + focus) often fire loadJobs() within a few ms of
// each other. Without dedup each one issues its own Supabase round-trip,
// hammering the network and producing identical merged results. We share a
// single in-flight promise so simultaneous callers get the same result, and
// keep that result hot for `LOAD_JOBS_DEDUP_WINDOW_MS` so back-to-back calls
// from the same render pass return instantly without a second fetch.
let inFlightLoad: Promise<Job[]> | null = null;
let lastResult: { jobs: Job[]; at: number } | null = null;
const LOAD_JOBS_DEDUP_WINDOW_MS = 600;

const doLoadJobs = async (): Promise<Job[]> => {
  const t0 = Date.now();
  const [localJobs, supabaseJobs] = await Promise.all([
    loadLocalJobs(),
    isSupabaseConfigured ? fetchAllAccessibleJobs() : Promise.resolve(null),
  ]);
  if (!supabaseJobs) {
    debugLog(`[jobs.service] loadJobs (local only) ${Date.now() - t0}ms`);
    return localJobs;
  }
  const merged = mergeJobs(supabaseJobs, localJobs);
  debugLog(`[jobs.service] loadJobs ${merged.length} jobs (${Date.now() - t0}ms)`);
  return merged;
};

export const loadJobs = async (_userId?: string): Promise<Job[]> => {
  // 1. Hot cache: identical mount-burst callers return instantly.
  if (lastResult && Date.now() - lastResult.at < LOAD_JOBS_DEDUP_WINDOW_MS) {
    return lastResult.jobs;
  }
  // 2. In-flight dedup: simultaneous callers share the same network call.
  if (inFlightLoad) return inFlightLoad;

  inFlightLoad = doLoadJobs()
    .then((jobs) => {
      lastResult = { jobs, at: Date.now() };
      return jobs;
    })
    .finally(() => {
      inFlightLoad = null;
    });
  return inFlightLoad;
};

// Invalidate the hot cache when a mutation should make the next loadJobs()
// actually re-fetch. Called from upsertJob / deleteJob / saveJobs.
const invalidateLoadJobsCache = () => {
  lastResult = null;
};

export const saveJobs = async (jobs: Job[], _userId?: string): Promise<void> => {
  const t0 = Date.now();

  // Diff against the previous local snapshot so we only sync rows that
  // actually changed. Without this, every bulk save (expiry sweep, my-posted
  // filters, etc.) triggers one UPSERT per UUID job in local cache — turning
  // a single post into N round-trips.
  const prev = await loadLocalJobs();
  const prevById = new Map<string, Job>();
  for (const j of prev) prevById.set(String(j.id), j);

  // AsyncStorage write is synchronous with the caller (job-actions.ts depends on this)
  await saveLocalJobs(jobs);

  if (!isSupabaseConfigured) {
    invalidateLoadJobsCache();
    return;
  }

  // Auth session uid: we only sync jobs the current user actually owns.
  // Non-owned rows come from the public feed merge and would be rejected by RLS
  // anyway — syncing them is pure noise.
  const { data: { session } } = await supabase.auth.getSession();
  const authUserId = session?.user?.id ?? null;

  // Reason-tracked diff. Notes on what is intentionally NOT a trigger:
  //   - "not present in prev local snapshot" alone is NOT a change. The feed
  //     merge brings remote-only jobs into the saved list every focus; treating
  //     those as new-to-local would re-UPSERT the user's whole history every
  //     time the feed loads.
  //   - updatedAt is NOT compared. It is bumped by every local write (including
  //     the merge re-save) without any user-visible field changing, so it would
  //     trigger infinite ping-pong syncs.
  const changed: { job: Job; reason: string }[] = [];
  for (const j of jobs) {
    if (!j.requesterId || !isUUID(j.id)) continue;
    if (authUserId && j.requesterId !== authUserId) continue;

    const before = prevById.get(String(j.id));
    if (!before) continue; // first time seen locally — already exists remotely

    const reasons: string[] = [];
    if (before.status !== j.status) reasons.push(`status(${before.status}→${j.status})`);
    if (before.expiresAt !== j.expiresAt) reasons.push('expiresAt');
    if (before.assignedBuddyId !== j.assignedBuddyId) reasons.push('assignedBuddyId');
    if (before.category !== j.category) reasons.push('category');
    if (before.problem !== j.problem) reasons.push('problem');
    if (before.price !== j.price) reasons.push('price');
    if (JSON.stringify(before.media ?? []) !== JSON.stringify(j.media ?? [])) reasons.push('media');

    if (reasons.length) {
      debugLog(`[jobs.service] saveJobs changed job=${j.id} reason=${reasons.join(',')}`);
      changed.push({ job: j, reason: reasons.join(',') });
    }
  }

  if (changed.length === 0) {
    debugLog(`[jobs.service] saveJobs: no changed syncable jobs (total=${jobs.length}) ${Date.now() - t0}ms`);
    return;
  }

  invalidateLoadJobsCache();
  debugLog(`[jobs.service] saveJobs: syncing ${changed.length}/${jobs.length} changed jobs`);
  Promise.allSettled(changed.map((c) => syncJobToSupabase(c.job)))
    .then(() => debugLog(`[jobs.service] saveJobs: background sync complete (${changed.length} jobs)`))
    .catch((e) => console.warn('[jobs.service] background sync error:', e));
};

export const getJobById = async (id: string, _userId?: string): Promise<Job | null> => {
  // Only query Supabase for UUID ids — timestamp ids are local-only
  if (isSupabaseConfigured && isUUID(id)) {
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', id)
        .single();
      if (!error && data) {
        // Check if local version is newer (has lifecycle mutations)
        const local = (await loadLocalJobs()).find((j) => String(j.id) === String(id));
        const remote = rowToJob(data as JobRow);
        if (local) {
          const localMs = local.updatedAt ? new Date(local.updatedAt).getTime() : 0;
          const remoteMs = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;
          return localMs >= remoteMs ? local : remote;
        }
        return remote;
      }
    } catch { /* fall through */ }
  }
  const jobs = await loadLocalJobs();
  return jobs.find((j) => String(j.id) === String(id)) ?? null;
};

export const upsertJob = async (job: Job, _userId?: string): Promise<{ jobs: Job[]; jobId: string }> => {
  const t0 = Date.now();
  // Sync to Supabase; for new jobs (timestamp id) we get back the real UUID.
  // Skip remote sync when the active session is not the job owner — those
  // upserts would always be rejected by RLS and the buddy-side lifecycle is
  // already authoritative via dedicated RPCs (apply_to_job, review_job_application,
  // confirm_job_completion). Local AsyncStorage write still proceeds so the
  // non-owner's UI reflects the new state immediately.
  let canonicalId = job.id;
  if (isSupabaseConfigured) {
    const { data: { session } } = await supabase.auth.getSession();
    const authUserId = session?.user?.id ?? null;
    const isOwner =
      !job.requesterId ||
      !authUserId ||
      job.requesterId === authUserId;
    if (isOwner) {
      const supabaseId = await syncJobToSupabase(job);
      if (supabaseId) canonicalId = supabaseId;
    }
  }

  const savedJob = canonicalId !== job.id ? { ...job, id: canonicalId } : job;

  // Dual-write to AsyncStorage — job-actions.ts reads from here.
  // Remove the old timestamp-id entry if the id was promoted to a UUID.
  const localJobs = await loadLocalJobs();
  const base = canonicalId !== job.id
    ? localJobs.filter((j) => String(j.id) !== String(job.id))
    : localJobs;
  const index = base.findIndex((j) => String(j.id) === String(canonicalId));
  const now = new Date().toISOString();
  const next = [...base];

  if (index >= 0) {
    next[index] = { ...savedJob, updatedAt: now };
  } else {
    next.unshift({ ...savedJob, createdAt: savedJob.createdAt ?? now, updatedAt: now });
  }

  await saveLocalJobs(next);
  invalidateLoadJobsCache();
  debugLog(`[jobs.service] upsertJob job=${canonicalId} total ${Date.now() - t0}ms`);
  // jobId is the canonical Supabase UUID for new jobs (promoted from the local
  // timestamp id during sync). Callers that must reference the server row —
  // e.g. set_job_location — need this, not the temporary client id.
  return { jobs: next, jobId: canonicalId };
};

export const deleteJob = async (id: string, _userId?: string): Promise<Job[]> => {
  if (isSupabaseConfigured && isUUID(id)) {
    try {
      const { error } = await supabase.from('jobs').delete().eq('id', id);
      if (error) console.warn('[jobs.service] Supabase delete failed:', error.message);
    } catch (e) {
      console.warn('[jobs.service] Supabase delete error:', e);
    }
  }
  const jobs = await loadLocalJobs();
  const next = jobs.filter((j) => String(j.id) !== String(id));
  await saveLocalJobs(next);
  invalidateLoadJobsCache();
  return next;
};

export const getJobsByStatus = async (
  statuses: JobStatus[],
  _userId?: string
): Promise<Job[]> => {
  const jobs = await loadJobs(_userId);
  return jobs.filter((job) => statuses.includes(job.status));
};

export const getActiveJobs = async (_userId?: string): Promise<Job[]> => {
  return getJobsByStatus([...ACTIVE_JOB_STATUSES], _userId);
};

export const getCompletedJobs = async (_userId?: string): Promise<Job[]> => {
  return getJobsByStatus(['completed'], _userId);
};

export const getOpenJobs = async (_userId?: string): Promise<Job[]> => {
  return getJobsByStatus(['open'], _userId);
};
