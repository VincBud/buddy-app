/**
 * DEV ONLY – seeds AsyncStorage with two sample open jobs on first launch:
 *   - one posted by the current user  → owner detail path
 *   - one posted by another user      → marketplace/buddy detail path
 *
 * Runs once; skipped if the seed flag is already set.
 * Remove or gate behind __DEV__ before shipping.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Job, LOCAL_USER_ID } from './jobs';

const SEED_FLAG_KEY = 'dev_seed_v1';

const now = new Date();
const expiresAt = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();

const SEED_JOBS: Job[] = [
  {
    id: 'seed_own_001',
    requesterId: LOCAL_USER_ID,
    creatorName: 'Vincent',
    category: 'handyman',
    problem: 'Regal aufbauen (eigener Auftrag)',
    price: '35',
    time: 'Flexibel',
    timeMode: 'flexibel',
    status: 'open',
    createdAt: now.toISOString(),
    expiresAt,
    location: { lat: 47.857, lng: 12.129 },
  },
  {
    id: 'seed_other_001',
    requesterId: 'other_user_42',
    creatorName: 'Maria',
    category: 'transport',
    problem: 'Umzugskartons zur Recycling-Station fahren',
    price: '50',
    time: 'So bald wie möglich',
    timeMode: 'sofort',
    status: 'open',
    createdAt: now.toISOString(),
    expiresAt,
    location: { lat: 47.855, lng: 12.126 },
    marketSignals: {
      viewsCount: 4,
      requesterCompletedJobs: 3,
      requesterRatingCount: 2,
      requesterReliability: 'steady',
    },
  },
  {
    id: 'seed_other_002',
    requesterId: 'other_user_77',
    creatorName: 'Thomas',
    category: 'tech',
    problem: 'Drucker einrichten – komme nicht weiter',
    price: '25',
    time: 'Heute Nachmittag',
    timeMode: 'termin',
    status: 'open',
    createdAt: now.toISOString(),
    expiresAt,
    location: { lat: 47.860, lng: 12.132 },
  },
];

export const runDevSeed = async (): Promise<void> => {
  try {
    const already = await AsyncStorage.getItem(SEED_FLAG_KEY);
    if (already) return;

    const raw = await AsyncStorage.getItem('jobs');
    const existing: Job[] = raw ? JSON.parse(raw) : [];

    // Skip seeds that are already present (e.g. from a partial run)
    const existingIds = new Set(existing.map((j) => j.id));
    const toAdd = SEED_JOBS.filter((j) => !existingIds.has(j.id));

    if (toAdd.length > 0) {
      await AsyncStorage.setItem('jobs', JSON.stringify([...toAdd, ...existing]));
    }

    await AsyncStorage.setItem(SEED_FLAG_KEY, '1');
  } catch {
    // seed failure is non-fatal
  }
};
