import AsyncStorage from '@react-native-async-storage/async-storage';

export type NotificationType =
  | 'jobAccepted'
  | 'jobCompleted'
  | 'jobApplication'
  | 'jobApplicationAccepted'
  | 'jobApplicationDeclined'
  | 'jobCancelled'
  | 'problemReported'
  | 'review'
  | 'message'
  | 'preferredBuddyJob';

export const NOTIFICATIONS_STORAGE_KEY = 'notifications';
export const NOTIFICATION_PREFERENCES_STORAGE_KEY = 'notification_preferences';

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
  userId?: string;
  relatedUserId?: string;
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
  relatedUserId?: string
): Notification => {
  return {
    id: `${Date.now()}_${type}`,
    type,
    title,
    message,
    createdAt: new Date().toISOString(),
    read: false,
    relatedJobId,
    userId,
    relatedUserId,
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
  const raw = await AsyncStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
  try {
    return parseNotifications(raw);
  } catch {
    return [];
  }
};

export const loadNotificationPreferences = async (): Promise<NotificationPreferences> => {
  const raw = await AsyncStorage.getItem(NOTIFICATION_PREFERENCES_STORAGE_KEY);

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
    NOTIFICATION_PREFERENCES_STORAGE_KEY,
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
    NOTIFICATIONS_STORAGE_KEY,
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
