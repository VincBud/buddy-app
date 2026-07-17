/**
 * Notifications service — dual-write: local optimistic + Supabase.
 *
 * Reads: Supabase is authoritative; AsyncStorage is a 30-second optimistic cache
 * for notifications just written by this client that may not yet be in Supabase.
 *
 * Writes: local-first for immediate UX, then best-effort Supabase in background.
 * Mark-read operations also dual-write so read state persists across devices.
 *
 * recipientId: only the three call sites that know the real recipient pass it.
 * If omitted, the notification is local-only (no Supabase write).
 */

import { eventBus } from '../lib/event-bus';
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
import { isSupabaseConfigured } from '../lib/config/env';
import { debugLog } from '../lib/config/debug';
import { supabase } from '../lib/supabase/client';
import { getActiveUserId } from '../lib/auth';

// ─── Supabase row type & mapper ────────────────────────────────────────────────

type NotificationRow = {
  id: string;
  recipient_id: string;
  actor_id: string | null;
  job_id: string | null;
  application_id: string | null;
  conversation_id: string | null;
  type: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

const rowToNotification = (row: NotificationRow): Notification => ({
  id: row.id,
  type: row.type as NotificationType,
  title: row.title,
  message: row.body,
  createdAt: row.created_at,
  read: row.read_at !== null,
  relatedJobId: row.job_id ?? undefined,
  actorId: row.actor_id ?? undefined,
  payload: row.payload ?? undefined,
  userId: row.recipient_id,
  relatedUserId: row.actor_id ?? undefined,
});

// ─── Remote helpers ────────────────────────────────────────────────────────────

const fetchRemoteNotifications = async (): Promise<Notification[] | null> => {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.warn('[notifications.service] Supabase fetch failed:', error.message);
      return null;
    }
    const rows = data as NotificationRow[];
    return rows.map(rowToNotification);
  } catch (e) {
    console.warn('[notifications.service] Supabase unreachable:', e);
    return null;
  }
};

const createRemoteNotification = async (
  n: Notification,
  recipientId: string
): Promise<void> => {
  if (!isSupabaseConfigured || !recipientId) return;

  // RLS on public.notifications enforces recipient_id = auth.uid() on INSERT.
  // Cross-user delivery (buddy accepted/declined, new application for owner) must
  // be implemented server-side via a Postgres trigger or Edge Function.
  // Skip the write here — the local notification was already saved by the caller.
  if (recipientId !== getActiveUserId()) return;

  try {
    const { error } = await supabase.from('notifications').insert({
      id: n.id,
      recipient_id: recipientId,
      type: n.type,
      title: n.title,
      body: n.message,
      job_id: n.relatedJobId ?? null,
      actor_id: n.relatedUserId ?? null,
      payload: {},
      read_at: null,
    });
    // 23505 = unique_violation on PK — idempotent, not an error
    if (error && error.code !== '23505') {
      console.warn('[notifications.service] Supabase insert failed:', error.message);
    }
  } catch (e) {
    console.warn('[notifications.service] createRemoteNotification error:', e);
  }
};

// public.notifications.id is uuid. Legacy local-only notifications carry
// `${timestamp}_${type}` ids — sending those to Supabase just raises
// "invalid input syntax for type uuid", so remote sync is skipped for them.
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const markReadRemote = async (id: string): Promise<void> => {
  if (!isSupabaseConfigured || !UUID_REGEX.test(id)) return;
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id);
    if (error) console.warn('[notifications.service] Supabase markRead failed:', error.message);
  } catch (e) {
    console.warn('[notifications.service] markReadRemote error:', e);
  }
};

const markUnreadRemote = async (id: string): Promise<void> => {
  if (!isSupabaseConfigured || !UUID_REGEX.test(id)) return;
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: null })
      .eq('id', id);
    if (error) console.warn('[notifications.service] Supabase markUnread failed:', error.message);
  } catch (e) {
    console.warn('[notifications.service] markUnreadRemote error:', e);
  }
};

const deleteRemoteNotification = async (id: string): Promise<void> => {
  if (!isSupabaseConfigured || !UUID_REGEX.test(id)) return;
  try {
    const { error } = await supabase.from('notifications').delete().eq('id', id);
    if (error) console.warn('[notifications.service] Supabase delete failed:', error.message);
  } catch (e) {
    console.warn('[notifications.service] deleteRemoteNotification error:', e);
  }
};

const markAllReadRemote = async (): Promise<void> => {
  if (!isSupabaseConfigured) return;
  try {
    // RLS scopes this to the current user's rows only
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .is('read_at', null);
    if (error) console.warn('[notifications.service] Supabase markAllRead failed:', error.message);
  } catch (e) {
    console.warn('[notifications.service] markAllReadRemote error:', e);
  }
};

// ─── Public API ────────────────────────────────────────────────────────────────

export const getNotifications = async (
  _userId?: string
): Promise<Notification[]> => {
  const sessionUid = getActiveUserId();
  debugLog(`[notifications.service] getNotifications: sessionUid=${sessionUid}`);

  const [local, remote] = await Promise.all([
    loadNotificationsFromStorage(),
    fetchRemoteNotifications(),
  ]);

  debugLog(
    `[notifications.service] getNotifications: localCount=${local.length}` +
    ` remoteCount=${remote?.length ?? 'null'}`
  );

  // Defensive recipient guard — drop any notification whose userId (mapped from
  // recipient_id) is explicitly set to a different user. Handles both Supabase
  // rows (RLS should already prevent leakage) and local optimistic writes.
  const isOwned = (n: Notification): boolean => {
    if (!n.userId) return true; // no recipient metadata — treat as self
    if (!sessionUid) return true; // not signed in yet — pass through
    if (n.userId !== sessionUid) {
      debugLog(
        `[notifications.service] dropping: id=${n.id} type=${n.type}` +
        ` recipient=${n.userId} ≠ session=${sessionUid}`
      );
      return false;
    }
    return true;
  };

  const ownedLocal = local.filter(isOwned);
  if (!remote) return ownedLocal;

  const ownedRemote = remote.filter(isOwned);

  // Remote is authoritative. Keep local-only entries written in the last 30 s
  // that haven't propagated to Supabase yet (optimistic cache window).
  const remoteIds = new Set(ownedRemote.map((n) => n.id));
  const optimisticLocal = ownedLocal.filter(
    (n) =>
      !remoteIds.has(n.id) &&
      Date.now() - new Date(n.createdAt).getTime() < 30_000
  );

  const merged = [...ownedRemote, ...optimisticLocal].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  debugLog(
    `[notifications.service] getNotifications: merged=${merged.length}` +
    (merged.length > 0
      ? ` types=${[...new Set(merged.map((n) => n.type))].join(',')}`
      : '')
  );

  await saveNotificationsToStorage(merged);
  return merged;
};

export const setNotifications = async (
  notifications: Notification[],
  _userId?: string
): Promise<void> => {
  await saveNotificationsToStorage(notifications);
  eventBus.emit('notifications:changed');
};

// TODO(rate-limit): enforce per-user notification write rate limit (e.g. 30/min) to prevent notification flooding.
export const addNotification = async (
  type: NotificationType,
  title: string,
  message: string,
  relatedJobId?: string,
  userId?: string,
  relatedUserId?: string,
  recipientId?: string
): Promise<void> => {
  const sessionUid = getActiveUserId();

  // Never write locally when the notification belongs to another user.
  // Cross-user delivery is handled server-side by the Postgres trigger.
  // Without this guard the calling user's local store gets flooded with
  // notifications intended for the counterparty (e.g. the applicant sees
  // the jobApplication notification they triggered for the owner).
  if (recipientId && recipientId !== sessionUid) {
    debugLog(
      `[notifications.service] addNotification: skipping type=${type}` +
      ` — recipient=${recipientId} ≠ session=${sessionUid}`
    );
    return;
  }

  debugLog(
    `[notifications.service] addNotification: type=${type}` +
    ` relatedJobId=${relatedJobId} session=${sessionUid}`
  );

  const notification = createNotification(
    type,
    title,
    message,
    relatedJobId,
    userId,
    relatedUserId
  );

  // Local-first: immediate UX feedback
  const existing = await loadNotificationsFromStorage();
  await saveNotificationsToStorage([notification, ...existing]);
  eventBus.emit('notifications:changed');

  // Background Supabase write — recipient is guaranteed to be sessionUid here
  if (recipientId) {
    createRemoteNotification(notification, recipientId).catch((e) => {
      console.warn('[notifications.service] background remote write error:', e);
    });
  }
};

export const markAllNotificationsRead = async (
  _userId?: string
): Promise<void> => {
  const notifications = await loadNotificationsFromStorage();
  const updated = notifications.map((n) => ({ ...n, read: true }));
  await saveNotificationsToStorage(updated);
  eventBus.emit('notifications:changed');

  markAllReadRemote().catch((e) => {
    console.warn('[notifications.service] background markAllRead error:', e);
  });
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
  eventBus.emit('notifications:changed');

  markReadRemote(id).catch((e) => {
    console.warn('[notifications.service] background markRead error:', e);
  });
};

export const markNotificationUnread = async (
  id: string,
  _userId?: string
): Promise<void> => {
  const notifications = await loadNotificationsFromStorage();
  const updated = notifications.map((n) =>
    n.id === id ? { ...n, read: false } : n
  );
  await saveNotificationsToStorage(updated);
  eventBus.emit('notifications:changed');

  markUnreadRemote(id).catch((e) => {
    console.warn('[notifications.service] background markUnread error:', e);
  });
};

/**
 * Deletes a single notification locally AND remotely. Without the remote delete
 * the Supabase row (authoritative in getNotifications) resurrects the entry on
 * the next merge — the exact "deleted notification came back" bug.
 */
export const deleteNotificationById = async (
  id: string,
  _userId?: string
): Promise<void> => {
  const notifications = await loadNotificationsFromStorage();
  const remaining = notifications.filter((n) => n.id !== id);
  await saveNotificationsToStorage(remaining);
  eventBus.emit('notifications:changed');

  deleteRemoteNotification(id).catch((e) => {
    console.warn('[notifications.service] background delete error:', e);
  });
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

/**
 * Deletes all local + remote `jobApplication` notifications that match a specific
 * job + buddy pair. Called after an owner accepts an application so the stale
 * "Neue Bewerbung" card disappears immediately without a manual refresh.
 */
export const deleteJobApplicationNotification = async (
  jobId: string,
  buddyId: string
): Promise<void> => {
  const all = await loadNotificationsFromStorage();
  const isMatch = (n: Notification): boolean =>
    n.type === 'jobApplication' &&
    String(n.relatedJobId) === String(jobId) &&
    (String(n.actorId) === String(buddyId) ||
      String((n.payload as Record<string, unknown>)?.buddyId) === String(buddyId));

  const toDelete = all.filter(isMatch);
  const remaining = all.filter((n) => !isMatch(n));

  await saveNotificationsToStorage(remaining);
  eventBus.emit('notifications:changed');

  for (const n of toDelete) {
    deleteRemoteNotification(n.id).catch((e) =>
      console.warn('[notifications.service] deleteJobApplicationNotification remote error:', e)
    );
  }
};
