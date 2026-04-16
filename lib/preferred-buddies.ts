import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSelectedApplication, Job } from './jobs';

export type PreferredBuddy = {
  id: string;
  name: string;
  addedAt: string;
  lastWorkedAt: string;
  jobsWorked: number;
  lastJobId?: string;
};

export const PREFERRED_BUDDIES_STORAGE_KEY = 'preferredBuddies';

const sanitizePreferredBuddy = (value: unknown): PreferredBuddy | null => {
  const safe = (value ?? {}) as Partial<PreferredBuddy>;

  if (typeof safe.id !== 'string' || !safe.id.trim()) return null;
  if (typeof safe.name !== 'string' || !safe.name.trim()) return null;

  return {
    id: safe.id.trim(),
    name: safe.name.trim(),
    addedAt:
      typeof safe.addedAt === 'string' && safe.addedAt
        ? safe.addedAt
        : new Date().toISOString(),
    lastWorkedAt:
      typeof safe.lastWorkedAt === 'string' && safe.lastWorkedAt
        ? safe.lastWorkedAt
        : new Date().toISOString(),
    jobsWorked:
      typeof safe.jobsWorked === 'number' && Number.isFinite(safe.jobsWorked)
        ? Math.max(1, Math.round(safe.jobsWorked))
        : 1,
    lastJobId: typeof safe.lastJobId === 'string' ? safe.lastJobId : undefined,
  };
};

export const getBuddyIdFromName = (name?: string) => {
  const normalized = (name ?? '').trim().toLowerCase();
  if (!normalized) return '';
  return normalized.replace(/\s+/g, '-');
};

export const loadPreferredBuddies = async (): Promise<PreferredBuddy[]> => {
  try {
    const raw = await AsyncStorage.getItem(PREFERRED_BUDDIES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];

    if (!Array.isArray(parsed)) return [];

    const safe = parsed
      .map((entry) => sanitizePreferredBuddy(entry))
      .filter((entry): entry is PreferredBuddy => Boolean(entry));

    return safe.sort(
      (a, b) =>
        new Date(b.lastWorkedAt).getTime() - new Date(a.lastWorkedAt).getTime()
    );
  } catch (error) {
    console.error('Error loading preferred buddies:', error);
    return [];
  }
};

export const savePreferredBuddies = async (buddies: PreferredBuddy[]) => {
  const safe = buddies
    .map((entry) => sanitizePreferredBuddy(entry))
    .filter((entry): entry is PreferredBuddy => Boolean(entry));

  await AsyncStorage.setItem(PREFERRED_BUDDIES_STORAGE_KEY, JSON.stringify(safe));

  return safe;
};

export const getPreferredBuddyById = (
  buddies: PreferredBuddy[],
  id: string
): PreferredBuddy | null => {
  if (!id.trim()) return null;
  return buddies.find((b) => b.id === id.trim()) ?? null;
};

export const getPreferredBuddyByName = (
  buddies: PreferredBuddy[],
  name: string
): PreferredBuddy | null => {
  const id = getBuddyIdFromName(name);
  if (!id) return null;
  return getPreferredBuddyById(buddies, id);
};

export const addPreferredBuddyFromMatchedJob = async (job: Job): Promise<PreferredBuddy[]> => {
  const selected = getSelectedApplication(job);
  const name = (selected?.buddyName ?? '').trim();
  const id = selected?.buddyId?.trim() || getBuddyIdFromName(name);

  if (!name || !id) {
    return loadPreferredBuddies();
  }

  const existing = await loadPreferredBuddies();
  const existingIndex = existing.findIndex((buddy) => buddy.id === id);
  const now = new Date().toISOString();

  if (existingIndex >= 0) {
    const current = existing[existingIndex];
    const updated: PreferredBuddy = {
      ...current,
      name,
      lastWorkedAt: now,
      jobsWorked: current.jobsWorked + 1,
      lastJobId: job.id,
    };

    const next = [...existing];
    next[existingIndex] = updated;
    return savePreferredBuddies(next);
  }

  return savePreferredBuddies([
    {
      id,
      name,
      addedAt: now,
      lastWorkedAt: now,
      jobsWorked: 1,
      lastJobId: job.id,
    },
    ...existing,
  ]);
};

export const addPreferredBuddyFromJob = async (job: Job) => {
  const name = (job.creatorName ?? '').trim();
  const id = getBuddyIdFromName(name);

  if (!name || !id) {
    return loadPreferredBuddies();
  }

  const existing = await loadPreferredBuddies();
  const existingIndex = existing.findIndex((buddy) => buddy.id === id);
  const now = new Date().toISOString();

  if (existingIndex >= 0) {
    const current = existing[existingIndex];
    const updated: PreferredBuddy = {
      ...current,
      name,
      lastWorkedAt: now,
      jobsWorked: current.jobsWorked + 1,
      lastJobId: job.id,
    };

    const next = [...existing];
    next[existingIndex] = updated;
    return savePreferredBuddies(next);
  }

  return savePreferredBuddies([
    {
      id,
      name,
      addedAt: now,
      lastWorkedAt: now,
      jobsWorked: 1,
      lastJobId: job.id,
    },
    ...existing,
  ]);
};
