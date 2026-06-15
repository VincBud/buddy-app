import AsyncStorage from '@react-native-async-storage/async-storage';
import { Job, JOB_CATEGORIES, JobCategory, TimeMode } from './jobs';
import { STORAGE_KEYS } from './storage-keys';

export const AVAILABILITY_SLOTS = [
  'morning',
  'afternoon',
  'evening',
  'weekend',
  'flexible',
] as const;

export type AvailabilitySlot = (typeof AVAILABILITY_SLOTS)[number];

export type UserPreferences = {
  skills: JobCategory[];
  preferredCategories: JobCategory[];
  excludedCategories: JobCategory[];
  availability: AvailabilitySlot[];
  radius: number;
  onboardingCompleted: boolean;
};

export const PREFERENCES_STORAGE_KEY = STORAGE_KEYS.USER_PREFERENCES;

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  skills: [],
  preferredCategories: [],
  excludedCategories: [],
  availability: ['flexible'],
  radius: 20,
  onboardingCompleted: false,
};

export const sanitizePreferences = (value: unknown): UserPreferences => {
  const safe = (value ?? {}) as Partial<UserPreferences>;

  const skills = Array.isArray(safe.skills)
    ? safe.skills.filter((v): v is JobCategory => JOB_CATEGORIES.includes(v as JobCategory))
    : [];

  const preferredCategories = Array.isArray(safe.preferredCategories)
    ? safe.preferredCategories.filter(
        (v): v is JobCategory => JOB_CATEGORIES.includes(v as JobCategory)
      )
    : [];

  const excludedCategories = Array.isArray(safe.excludedCategories)
    ? safe.excludedCategories.filter(
        (v): v is JobCategory => JOB_CATEGORIES.includes(v as JobCategory)
      )
    : [];

  const availability = Array.isArray(safe.availability)
    ? safe.availability.filter(
        (v): v is AvailabilitySlot => AVAILABILITY_SLOTS.includes(v as AvailabilitySlot)
      )
    : [];

  const radius =
    typeof safe.radius === 'number' && Number.isFinite(safe.radius)
      ? Math.min(50, Math.max(1, Math.round(safe.radius)))
      : DEFAULT_USER_PREFERENCES.radius;

  const onboardingCompleted = Boolean(safe.onboardingCompleted);

  return {
    skills,
    preferredCategories,
    excludedCategories,
    availability: availability.length > 0 ? availability : ['flexible'],
    radius,
    onboardingCompleted,
  };
};

// Per-user scoped key; falls back to legacy global key for backward compatibility.
const preferencesKey = (userId?: string): string =>
  userId ? `${PREFERENCES_STORAGE_KEY}_${userId}` : PREFERENCES_STORAGE_KEY;

export const loadUserPreferences = async (userId?: string): Promise<UserPreferences> => {
  try {
    const key = preferencesKey(userId);
    const raw = await AsyncStorage.getItem(key);
    // Backward-compat: if scoped key is empty, check the legacy global key
    const effectiveRaw =
      !raw && userId ? await AsyncStorage.getItem(PREFERENCES_STORAGE_KEY) : raw;
    if (!effectiveRaw) return DEFAULT_USER_PREFERENCES;
    const parsed = JSON.parse(effectiveRaw);
    return { ...DEFAULT_USER_PREFERENCES, ...sanitizePreferences(parsed) };
  } catch (error) {
    console.error('Error loading preferences:', error);
    return DEFAULT_USER_PREFERENCES;
  }
};

export const saveUserPreferences = async (
  preferences: UserPreferences,
  userId?: string
): Promise<UserPreferences> => {
  const safe = sanitizePreferences(preferences);
  await AsyncStorage.setItem(preferencesKey(userId), JSON.stringify(safe));
  return safe;
};

const CATEGORY_KEYWORDS: Record<JobCategory, string[]> = {
  transport: ['transport', 'fahrt', 'fahrdienst', 'taxi', 'auto', 'fahrer', 'mitfahrt', 'chauffeur'],
  moving: ['möbel tragen', 'tragen', 'schleppen', 'sofa', 'schrank', 'schwer', 'last', 'heben'],
  relocation: ['umzug', 'umziehen', 'einzug', 'auszug', 'karton', 'kiste', 'umzugshilfe'],
  errands: ['einkauf', 'besorgung', 'supermarkt', 'apotheke', 'paket', 'post', 'bank', 'errand'],
  tech: ['tech', 'computer', 'pc', 'laptop', 'software', 'router', 'internet', 'wifi', 'handy', 'setup'],
  household: ['haushalt', 'putzen', 'reinigung', 'wäsche', 'küche', 'wohnung', 'sauber', 'clean'],
  garden: ['garten', 'rasen', 'hecke', 'mähen', 'pflanzen', 'schneiden', 'terrasse', 'balkon', 'außen'],
  furniture: ['möbel aufbauen', 'aufbauen', 'ikea', 'regal', 'bett aufbauen', 'schrank aufbauen', 'aufbau'],
  petcare: ['hund', 'katze', 'tier', 'haustier', 'gassi', 'füttern', 'tierpflege', 'pet'],
  events: ['event', 'gastronomie', 'gastro', 'feier', 'party', 'veranstaltung', 'kellner', 'catering', 'service'],
  photo: ['foto', 'photo', 'social media', 'instagram', 'content', 'video', 'shooting', 'kamera', 'reels'],
  handyman: ['handyman', 'reparatur', 'repair', 'bohren', 'montieren', 'bauen', 'werkzeug', 'install', 'schrauben'],
  storage: ['lager', 'lagern', 'stapeln', 'keller', 'dachboden', 'einlagern', 'sortieren'],
  delivery: ['lieferung', 'liefern', 'abholen', 'abholung', 'kurierfahrt', 'auslieferung', 'bringen'],
  other: ['sonstige', 'andere', 'sonstiges', 'anderes', 'verschiedenes'],
};

export const inferJobCategory = (job: Job): JobCategory => {
  if (job.category && JOB_CATEGORIES.includes(job.category)) {
    return job.category;
  }

  const text = `${job.problem} ${job.time}`.toLowerCase();

  let bestCategory: JobCategory = 'errands';
  let bestScore = 0;

  for (const category of JOB_CATEGORIES) {
    const keywords = CATEGORY_KEYWORDS[category];
    let score = 0;

    for (const keyword of keywords) {
      if (text.includes(keyword)) score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestCategory;
};

export const getTimeModeAvailability = (
  timeMode: TimeMode | undefined,
  appointmentTime?: string
): AvailabilitySlot => {
  if (timeMode === 'sofort' || timeMode === 'flexibel') return 'flexible';

  if (timeMode === 'termin' && appointmentTime) {
    const hour = Number(appointmentTime.split(':')[0]);

    if (!Number.isNaN(hour)) {
      if (hour < 12) return 'morning';
      if (hour < 18) return 'afternoon';
      return 'evening';
    }
  }

  return 'flexible';
};
export { JOB_CATEGORIES };
export type { JobCategory };

