/**
 * Notifications service — single access point for all notification operations.
 *
 * All functions accept an optional `userId` parameter unused today but maps
 * directly to the authenticated user in Supabase.
 * Swap implementations here when backend is ready.
 */

import {
  createNotification,
  getNotificationPreferenceKeyForType,
  getUnreadNotificationCount,
  loadNotificationPreferences,
  loadNotificationsFromStorage,
  Notification,
  NotificationPreferences,
  NotificationType,
  saveNotificationPreferences,
  saveNotificationsToStorage,
} from '../lib/notifications';

export const getNotifications = async (
  _userId?: string
): Promise<Notification[]> => {
  return loadNotificationsFromStorage();
};

export const setNotifications = async (
  notifications: Notification[],
  _userId?: string
): Promise<void> => {
  return saveNotificationsToStorage(notifications);
};

export const addNotification = async (
  type: NotificationType,
  title: string,
  message: string,
  relatedJobId?: string,
  userId?: string,
  relatedUserId?: string
): Promise<void> => {
  const notification = createNotification(
    type,
    title,
    message,
    relatedJobId,
    userId,
    relatedUserId
  );
  const existing = await loadNotificationsFromStorage();
  await saveNotificationsToStorage([notification, ...existing]);
};

export const markAllNotificationsRead = async (
  _userId?: string
): Promise<void> => {
  const notifications = await loadNotificationsFromStorage();
  const updated = notifications.map((n) => ({ ...n, read: true }));
  await saveNotificationsToStorage(updated);
};

export const markNotificationRead = async (
  id: string,
  _userId?: string
): Promise<void> => {
  const notifications = await loadNotificationsFromStorage();
  const updated = notifications.map((n) =>
    n.id === id ? { ...n, read: true } : n
  );
  await saveNotificationsToStorage(updated);
};

export const getNotificationPreferences = async (
  _userId?: string
): Promise<NotificationPreferences> => {
  return loadNotificationPreferences();
};

export const setNotificationPreferences = async (
  preferences: NotificationPreferences,
  _userId?: string
): Promise<void> => {
  return saveNotificationPreferences(preferences);
};

export const isNotificationTypeEnabled = async (
  type: NotificationType,
  _userId?: string
): Promise<boolean> => {
  const prefs = await loadNotificationPreferences();
  const key = getNotificationPreferenceKeyForType(type);
  return prefs[key] ?? true;
};

export const getUnreadCount = async (_userId?: string): Promise<number> => {
  const notifications = await loadNotificationsFromStorage();
  return getUnreadNotificationCount(notifications);
};
