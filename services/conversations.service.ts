/**
 * Conversations service — Supabase-backed with AsyncStorage local cache.
 *
 * Architecture:
 *  - User messages (text/image) are written to public.messages in Supabase.
 *  - System messages are local-only (client-generated UX events, never in DB).
 *  - AsyncStorage holds all messages as a fast-startup cache.
 *
 * Optimistic send flow (caller's responsibility):
 *  1. Build a message with a temp id (e.g. `opt_${Date.now()}`), status: 'sending'.
 *  2. Append to UI state + call saveMessages() to persist locally.
 *  3. Call insertMessage() → get back the real DB uuid.
 *  4. Swap temp id for db id in UI state; set status: 'sent' (or 'failed').
 *
 * Loading flow:
 *  - loadMessages() returns the local cache immediately (fast path).
 *  - fetchRemoteMessages() fetches Supabase (authoritative for user messages).
 *  - Callers run both and merge: system msgs from local + user msgs from remote.
 *
 * Realtime prep:
 *  - subscribeToMessages() / unsubscribeFromMessages() stubs are ready.
 *  - Wire supabase.channel() inside subscribeToMessages() for Phase 2.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { isSupabaseConfigured } from '../lib/config/env';
import { supabase } from '../lib/supabase/client';

export type StoredMessage = {
  id: string;
  type: 'text' | 'image' | 'system';
  text?: string;
  imageUri?: string;
  sender: 'me' | 'other' | 'system';
  timestamp: string;
  status?: 'sending' | 'sent' | 'failed' | 'seen';
};

// ─── Local cache ───────────────────────────────────────────────────────────────

const chatKey = (jobId: string): string => `chat_${jobId}`;

const safeParseMessages = (raw: string | null): StoredMessage[] => {
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const loadMessages = async (
  jobId: string,
  _userId?: string
): Promise<StoredMessage[]> => {
  const raw = await AsyncStorage.getItem(chatKey(jobId));
  return safeParseMessages(raw);
};

export const saveMessages = async (
  jobId: string,
  messages: StoredMessage[],
  _userId?: string
): Promise<void> => {
  await AsyncStorage.setItem(chatKey(jobId), JSON.stringify(messages));
};

export const appendMessage = async (
  jobId: string,
  message: StoredMessage,
  _userId?: string
): Promise<StoredMessage[]> => {
  const existing = await loadMessages(jobId);
  const next = [...existing, message];
  await saveMessages(jobId, next);
  return next;
};

export const clearMessages = async (
  jobId: string,
  _userId?: string
): Promise<void> => {
  await AsyncStorage.removeItem(chatKey(jobId));
};

// ─── Supabase row type & mapper ────────────────────────────────────────────────

type MessageRow = {
  id: string;
  job_id: string;
  sender_id: string;
  body: string | null;
  image_url: string | null;
  created_at: string;
  read_at: string | null;
  metadata: Record<string, unknown>;
};

const rowToStoredMessage = (row: MessageRow, currentUserId: string): StoredMessage => {
  const isOwn = row.sender_id === currentUserId;
  const ts = new Date(row.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  if (row.image_url) {
    return {
      id: row.id,
      type: 'image',
      imageUri: row.image_url,
      sender: isOwn ? 'me' : 'other',
      timestamp: ts,
      status: 'sent',
    };
  }
  return {
    id: row.id,
    type: 'text',
    text: row.body ?? '',
    sender: isOwn ? 'me' : 'other',
    timestamp: ts,
    status: 'sent',
  };
};

// ─── Remote operations ─────────────────────────────────────────────────────────

// Fetches all user messages for a job from Supabase, ordered oldest-first.
// Returns null when Supabase is unreachable — caller falls back to local cache.
export const fetchRemoteMessages = async (
  jobId: string,
  currentUserId: string
): Promise<StoredMessage[] | null> => {
  if (!isSupabaseConfigured || !currentUserId) return null;
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true })
      .limit(200);

    if (error) {
      console.warn('[conversations.service] fetchRemoteMessages failed:', error.message);
      return null;
    }
    return (data as MessageRow[]).map((row) => rowToStoredMessage(row, currentUserId));
  } catch (e) {
    console.warn('[conversations.service] Supabase unreachable:', e);
    return null;
  }
};

// Inserts a user message to Supabase. Returns the generated DB uuid, or null on failure.
// Called after the optimistic local append — caller reconciles state with the returned id.
export const insertMessage = async (
  jobId: string,
  body: string | null,
  imageUrl: string | null,
  senderId: string
): Promise<string | null> => {
  if (!isSupabaseConfigured || !senderId) return null;
  try {
    const { data, error } = await supabase
      .from('messages')
      .insert({ job_id: jobId, sender_id: senderId, body, image_url: imageUrl })
      .select('id')
      .single();

    if (error) {
      console.warn('[conversations.service] insertMessage failed:', error.message);
      return null;
    }
    return (data as { id: string }).id;
  } catch (e) {
    console.warn('[conversations.service] insertMessage error:', e);
    return null;
  }
};

// Marks all messages in the conversation sent by others as read.
// Called on chat open; background fire-and-forget is fine.
export const markConversationRead = async (
  jobId: string,
  currentUserId: string
): Promise<void> => {
  if (!isSupabaseConfigured || !currentUserId) return;
  try {
    const { error } = await supabase
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('job_id', jobId)
      .neq('sender_id', currentUserId)
      .is('read_at', null);

    if (error) {
      console.warn('[conversations.service] markConversationRead failed:', error.message);
    }
  } catch (e) {
    console.warn('[conversations.service] markConversationRead error:', e);
  }
};

// ─── Realtime ─────────────────────────────────────────────────────────────────
//
// Subscribes to INSERT events on public.messages for a single conversation.
// Returns a cleanup function — call it on component unmount.
//
// Deduplication is the caller's responsibility: incoming messages are mapped
// from DB rows and may overlap with optimistic messages already in UI state.
// The caller should filter by id before appending to state.
//
// Requires Supabase realtime to be enabled for the messages table in the
// Supabase Dashboard (Database → Replication → public.messages → enabled).

export type MessageListener = (newMessages: StoredMessage[]) => void;

// Track active channels by jobId so we never call .on() on an already-subscribed channel.
const activeChannels = new Map<string, ReturnType<typeof supabase.channel>>();

export const subscribeToMessages = (
  jobId: string,
  currentUserId: string,
  onUpdate: MessageListener
): (() => void) => {
  if (!isSupabaseConfigured || !jobId || !currentUserId) return () => {};

  // Remove any existing channel for this jobId before creating a new one.
  const existing = activeChannels.get(jobId);
  if (existing) {
    supabase.removeChannel(existing).catch(() => {});
    activeChannels.delete(jobId);
  }

  // Use a unique name to prevent Supabase from reusing a previously subscribed channel.
  const channelName = `messages:${jobId}:${Date.now()}`;
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `job_id=eq.${jobId}`,
      },
      (payload) => {
        const row = payload.new as MessageRow;
        if (!row?.id) return;
        onUpdate([rowToStoredMessage(row, currentUserId)]);
      }
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') {
        console.warn('[conversations.service] realtime channel error for job:', jobId);
      }
    });

  activeChannels.set(jobId, channel);

  return () => {
    supabase.removeChannel(channel).catch(() => {});
    activeChannels.delete(jobId);
  };
};
