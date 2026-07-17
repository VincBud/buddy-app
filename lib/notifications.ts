import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { getActiveUserId } from './auth';
import { STORAGE_KEYS } from './storage-keys';

// Scoped per authenticated user so two accounts on the same device
// never see each other's local notifications.
const getNotificationsStorageKey = (): string => {
  const uid = getActiveUserId();
  return uid ? `${STORAGE_KEYS.NOTIFICATIONS}_${uid}` : STORAGE_KEYS.NOTIFICATIONS;
};

export type NotificationType =
  | 'jobAccepted'
  | 'jobCompleted'
  | 'jobApplication'
  | 'jobApplicationAccepted'
  | 'jobApplicationDeclined'
  | 'jobCancelled'
  | 'chatUnlocked'
  | 'jobExtended'
  | 'issueResolved'
  | 'problemReported'
  | 'review'
  | 'message'
  | 'preferredBuddyJob';


export type NotificationPreferenceKey =
  | 'messages'
  | 'jobUpdates'
  | 'jobActivity'
  | 'recommendedJobs'
  | 'productUpdates';

export type NotificationPreferences = Record<NotificationPreferenceKey, boolean>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  messages: true,
  jobUpdates: true,
  jobActivity: true,
  recommendedJobs: true,
  productUpdates: true,
};

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  relatedJobId?: string;
  actorId?: string;
  payload?: Record<string, unknown>;
  userId?: string;
  relatedUserId?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

const sanitizeNotificationPreferences = (
  value: unknown
): NotificationPreferences => {
  if (!value || typeof value !== 'object') {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }

  const candidate = value as Partial<NotificationPreferences>;

  return {
    messages:
      typeof candidate.messages === 'boolean'
        ? candidate.messages
        : DEFAULT_NOTIFICATION_PREFERENCES.messages,
    jobUpdates:
      typeof candidate.jobUpdates === 'boolean'
        ? candidate.jobUpdates
        : DEFAULT_NOTIFICATION_PREFERENCES.jobUpdates,
    jobActivity:
      typeof candidate.jobActivity === 'boolean'
        ? candidate.jobActivity
        : DEFAULT_NOTIFICATION_PREFERENCES.jobActivity,
    recommendedJobs:
      typeof candidate.recommendedJobs === 'boolean'
        ? candidate.recommendedJobs
        : DEFAULT_NOTIFICATION_PREFERENCES.recommendedJobs,
    productUpdates:
      typeof candidate.productUpdates === 'boolean'
        ? candidate.productUpdates
        : DEFAULT_NOTIFICATION_PREFERENCES.productUpdates,
  };
};

export const createNotification = (
  type: NotificationType,
  title: string,
  message: string,
  relatedJobId?: string,
  userId?: string,
  relatedUserId?: string,
  relatedEntityType?: string,
  relatedEntityId?: string
): Notification => {
  return {
    // Real UUID — public.notifications.id is a uuid column, so the optimistic
    // dual-write only survives in Supabase (and thus survives the 30-second
    // optimistic window, reinstalls, and other devices) with a valid uuid.
    // The old `${Date.now()}_${type}` ids failed every remote insert silently.
    id: Crypto.randomUUID(),
    type,
    title,
    message,
    createdAt: new Date().toISOString(),
    read: false,
    relatedJobId,
    userId,
    relatedUserId,
    relatedEntityType,
    relatedEntityId,
  };
};

const isValidNotificationType = (value: unknown): value is NotificationType => {
  return (
    value === 'jobAccepted' ||
    value === 'jobCompleted' ||
    value === 'jobApplication' ||
    value === 'jobApplicationAccepted' ||
    value === 'jobApplicationDeclined' ||
    value === 'jobCancelled' ||
    value === 'chatUnlocked' ||
    value === 'jobExtended' ||
    value === 'issueResolved' ||
    value === 'problemReported' ||
    value === 'review' ||
    value === 'message' ||
    value === 'preferredBuddyJob'
  );
};

const sanitizeNotification = (value: unknown): Notification | null => {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Partial<Notification>;
  const type = isValidNotificationType(candidate.type) ? candidate.type : null;
  if (!type) return null;

  const id = String(candidate.id ?? '').trim();
  const title = String(candidate.title ?? '').trim();
  const message = String(candidate.message ?? '').trim();
  const createdAt = String(candidate.createdAt ?? '').trim();

  if (!id || !title || !message || !createdAt) return null;

  return {
    id,
    type,
    title,
    message,
    createdAt,
    read: Boolean(candidate.read),
    relatedJobId:
      candidate.relatedJobId === undefined
        ? undefined
        : String(candidate.relatedJobId),
    userId:
      candidate.userId === undefined ? undefined : String(candidate.userId),
    relatedUserId:
      candidate.relatedUserId === undefined
        ? undefined
        : String(candidate.relatedUserId),
    actorId:
      candidate.actorId === undefined ? undefined : String(candidate.actorId),
    payload:
      candidate.payload && typeof candidate.payload === 'object'
        ? (candidate.payload as Record<string, unknown>)
        : undefined,
    relatedEntityType:
      candidate.relatedEntityType === undefined
        ? undefined
        : String(candidate.relatedEntityType),
    relatedEntityId:
      candidate.relatedEntityId === undefined
        ? undefined
        : String(candidate.relatedEntityId),
  };
};

export const sortNotificationsByNewest = (
  notifications: Notification[]
): Notification[] => {
  return [...notifications].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
};

export const parseNotifications = (raw: unknown): Notification[] => {
  const parsed =
    typeof raw === 'string'
      ? JSON.parse(raw || '[]')
      : Array.isArray(raw)
      ? raw
      : [];

  if (!Array.isArray(parsed)) return [];

  const safe = parsed
    .map((entry) => sanitizeNotification(entry))
    .filter((entry): entry is Notification => Boolean(entry));

  return sortNotificationsByNewest(safe);
};

export const loadNotificationsFromStorage = async (): Promise<Notification[]> => {
  const raw = await AsyncStorage.getItem(getNotificationsStorageKey());
  try {
    return parseNotifications(raw);
  } catch {
    return [];
  }
};

export const loadNotificationPreferences = async (): Promise<NotificationPreferences> => {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.NOTIFICATION_PREFERENCES);

  try {
    if (!raw) {
      return DEFAULT_NOTIFICATION_PREFERENCES;
    }

    return sanitizeNotificationPreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
};

export const saveNotificationPreferences = async (
  preferences: NotificationPreferences
): Promise<void> => {
  const safePreferences = sanitizeNotificationPreferences(preferences);

  await AsyncStorage.setItem(
    STORAGE_KEYS.NOTIFICATION_PREFERENCES,
    JSON.stringify(safePreferences)
  );
};

export const getEnabledNotificationPreferenceCount = (
  preferences: NotificationPreferences
): number => {
  return Object.values(preferences).reduce(
    (count, isEnabled) => count + (isEnabled ? 1 : 0),
    0
  );
};

export const getNotificationPreferenceKeyForType = (
  type: NotificationType
): NotificationPreferenceKey => {
  if (type === 'message') {
    return 'messages';
  }

  if (type === 'preferredBuddyJob') {
    return 'recommendedJobs';
  }

  if (
    type === 'jobAccepted' ||
    type === 'jobCompleted' ||
    type === 'jobApplication' ||
    type === 'jobApplicationAccepted' ||
    type === 'jobApplicationDeclined' ||
    type === 'jobCancelled' ||
    type === 'chatUnlocked' ||
    type === 'jobExtended' ||
    type === 'issueResolved' ||
    type === 'problemReported'
  ) {
    return 'jobActivity';
  }

  return 'jobUpdates';
};

export const saveNotificationsToStorage = async (
  notifications: Notification[]
): Promise<void> => {
  const safeNotifications = sortNotificationsByNewest(
    notifications
      .map((entry) => sanitizeNotification(entry))
      .filter((entry): entry is Notification => Boolean(entry))
  );

  await AsyncStorage.setItem(
    getNotificationsStorageKey(),
    JSON.stringify(safeNotifications)
  );
};

export const getUnreadNotificationCount = (
  notifications: Notification[]
): number => {
  return notifications.reduce((count, item) => count + (item.read ? 0 : 1), 0);
};

export type NotificationTone = 'default' | 'success' | 'highlight' | 'message';

export type NotificationPresentation = {
  iconName: 'checkmark-circle-outline' | 'trophy-outline' | 'star-outline' | 'chatbubble-ellipses-outline' | 'sparkles-outline';
  tone: NotificationTone;
};

const NOTIFICATION_PRESENTATION: Record<NotificationType, NotificationPresentation> = {
  jobAccepted: {
    iconName: 'checkmark-circle-outline',
    tone: 'success',
  },
  jobCompleted: {
    iconName: 'trophy-outline',
    tone: 'highlight',
  },
  jobApplication: {
    iconName: 'sparkles-outline',
    tone: 'highlight',
  },
  jobApplicationAccepted: {
    iconName: 'checkmark-circle-outline',
    tone: 'success',
  },
  jobApplicationDeclined: {
    iconName: 'chatbubble-ellipses-outline',
    tone: 'default',
  },
  jobCancelled: {
    iconName: 'chatbubble-ellipses-outline',
    tone: 'default',
  },
  chatUnlocked: {
    iconName: 'checkmark-circle-outline',
    tone: 'success',
  },
  jobExtended: {
    iconName: 'checkmark-circle-outline',
    tone: 'default',
  },
  issueResolved: {
    iconName: 'checkmark-circle-outline',
    tone: 'success',
  },
  problemReported: {
    iconName: 'chatbubble-ellipses-outline',
    tone: 'default',
  },
  review: {
    iconName: 'star-outline',
    tone: 'highlight',
  },
  message: {
    iconName: 'chatbubble-ellipses-outline',
    tone: 'message',
  },
  preferredBuddyJob: {
    iconName: 'sparkles-outline',
    tone: 'default',
  },
};

export const getNotificationPresentation = (
  type: NotificationType
): NotificationPresentation => {
  return NOTIFICATION_PRESENTATION[type] ?? NOTIFICATION_PRESENTATION.message;
};
