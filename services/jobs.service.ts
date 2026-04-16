/**
 * Job service — single access point for all job data operations.
 *
 * All functions accept an optional `userId` parameter that is unused today
 * but maps directly to the `auth.uid()` RLS context in Supabase.
 * Swap the AsyncStorage implementation here when backend is ready.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { Job, JobStatus, ACTIVE_JOB_STATUSES } from '../lib/jobs';
import { STORAGE_KEYS } from '../lib/storage-keys';

const safeParseJobs = (raw: string | null): Job[] => {
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const loadJobs = async (_userId?: string): Promise<Job[]> => {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.JOBS);
  return safeParseJobs(raw);
};

export const saveJobs = async (jobs: Job[], _userId?: string): Promise<void> => {
  await AsyncStorage.setItem(STORAGE_KEYS.JOBS, JSON.stringify(jobs));
};

export const getJobById = async (id: string, _userId?: string): Promise<Job | null> => {
  const jobs = await loadJobs(_userId);
  return jobs.find((job) => String(job.id) === String(id)) ?? null;
};

export const upsertJob = async (job: Job, _userId?: string): Promise<Job[]> => {
  const jobs = await loadJobs(_userId);
  const index = jobs.findIndex((j) => String(j.id) === String(job.id));
  const now = new Date().toISOString();
  const next = [...jobs];

  if (index >= 0) {
    next[index] = { ...job, updatedAt: now };
  } else {
    next.unshift({ ...job, createdAt: job.createdAt ?? now, updatedAt: now });
  }

  await saveJobs(next, _userId);
  return next;
};

export const deleteJob = async (id: string, _userId?: string): Promise<Job[]> => {
  const jobs = await loadJobs(_userId);
  const next = jobs.filter((j) => String(j.id) !== String(id));
  await saveJobs(next, _userId);
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
