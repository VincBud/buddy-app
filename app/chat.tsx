import * as ImagePicker from 'expo-image-picker';
import { type Href, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors } from '../lib/colors';
import { debugLog } from '../lib/config/debug';
import { getActiveUserId } from '../lib/auth';
import i18n, { useLanguage } from '../lib/i18n';
import { activateMatchedJob, confirmJobCompletion, confirmJobCancellation, declineJobCancellation, isJobChatAccessible, isJobChatWritable, openJobDispute, requestJobCancellation } from '../lib/job-actions';
import { getBuddyPointsForJob, Job } from '../lib/jobs';
import { goBackOrReplace } from '../lib/navigation';
import { addNotification } from '../services/notifications.service';
import { uploadChatImage } from '../services/media.service';
import { loadJobs } from '../services/jobs.service';
import { getBuddyScore, setBuddyScore, incrementReliabilityStats } from '../services/user.service';
import {
  loadMessages as loadStoredMessages,
  saveMessages as saveStoredMessages,
  fetchRemoteMessages,
  insertMessage,
  markConversationRead,
  subscribeToMessages,
  StoredMessage,
} from '../services/conversations.service';
import { layout, spacing } from '../lib/spacing';
import { typography } from '../lib/typography';
import { recordJobCompletionEarning } from '../lib/wallet';

type ChatMessage = StoredMessage;

type ChatParticipantRole = 'auftraggeber' | 'buddy';

type ChatJobContext = {
  jobId: string;
  problem: string;
  price: string;
  creatorName: string;
  status: Job['status'];
};

type ChatRouteParams = {
  jobId: string;
  problem: string;
  price: string;
  creatorName?: string;
  currentUserRole?: ChatParticipantRole;
};

const getCounterpartRole = (
  role: ChatParticipantRole
): ChatParticipantRole => {
  return role === 'buddy' ? 'auftraggeber' : 'buddy';
};

const normalizeChatParticipantRole = (
  value: unknown
): ChatParticipantRole | null => {
  return value === 'auftraggeber' || value === 'buddy' ? value : null;
};

const resolveCurrentUserRole = (
  roleParam: unknown
): ChatParticipantRole => {
  const normalizedRole = normalizeChatParticipantRole(roleParam);
  if (normalizedRole) {
    return normalizedRole;
  }

  // Fallback keeps legacy flows stable until route-level role is provided by backend/session.
  return 'buddy';
};

const getMessageRole = (
  message: Pick<ChatMessage, 'sender'>,
  currentUserRole: ChatParticipantRole
): ChatParticipantRole => {
  return message.sender === 'me' ? currentUserRole : getCounterpartRole(currentUserRole);
};

const buildChatContextFromParams = (
  params: Partial<ChatRouteParams>
): ChatJobContext => {
  return {
    jobId: params.jobId || '',
    problem: params.problem || '',
    price: params.price || '',
    creatorName: params.creatorName || '',
    status: 'matched',
  };
};

const resolveJobContext = (
  currentJob: Job | undefined,
  params: Partial<ChatRouteParams>,
  previous: ChatJobContext,
  fallbackStatus: Job['status']
): ChatJobContext => {
  if (!currentJob) {
    return {
      ...previous,
      status: fallbackStatus,
    };
  }

  return {
    jobId: currentJob.id,
    problem: currentJob.problem || params.problem || '',
    price: currentJob.price || params.price || '',
    creatorName:
      currentJob.creatorName || params.creatorName || i18n.t('common.default_user_name'),
    status: currentJob.status,
  };
};

const getCurrentTimestamp = (): string => {
  return new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const createSystemMessage = (text: string): ChatMessage => ({
  id: `sys_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  type: 'system',
  text,
  sender: 'system',
  timestamp: getCurrentTimestamp(),
});

const hasSystemMessageWithText = (msgs: ChatMessage[], text: string): boolean =>
  msgs.some((m) => m.type === 'system' && m.text === text);

const CANCEL_REASONS = [
  { key: 'timing',        de: 'Termin passt nicht mehr',          en: 'Timing no longer works' },
  { key: 'no_response',   de: 'Keine Antwort erhalten',           en: 'No response received' },
  { key: 'task_resolved', de: 'Aufgabe hat sich erledigt',        en: 'Task resolved itself' },
  { key: 'person_issue',  de: 'Problem mit der anderen Person',   en: 'Issue with the other person' },
  { key: 'other',         de: 'Sonstiges',                        en: 'Other' },
] as const;

const DISPUTE_REASONS = [
  { key: 'buddy_no_show',           de: 'Buddy erscheint nicht',        en: 'Buddy is not showing up' },
  { key: 'requester_unreachable',   de: 'Auftraggeber reagiert nicht',  en: 'Requester not responding' },
  { key: 'payment_issue',           de: 'Zahlung / Auszahlung',         en: 'Payment issue' },
  { key: 'inappropriate_behavior',  de: 'Unangemessenes Verhalten',     en: 'Inappropriate behavior' },
  { key: 'other',                   de: 'Sonstiges',                    en: 'Other' },
] as const;

const getStatusLabel = (status: Job['status']): string => {
  switch (status) {
    case 'matched': return i18n.t('chat.status_label_matched');
    case 'active': return i18n.t('chat.status_label_active');
    case 'completed': return i18n.t('chat.status_label_completed');
    case 'issue_reported': return i18n.t('chat.status_issue_reported_title');
    case 'cancelled': return i18n.t('chat.status_cancelled_title');
    default: return status;
  }
};

const normalizeStoredMessages = (value: unknown): ChatMessage[] => {
  if (!Array.isArray(value)) return [];

  const normalized: ChatMessage[] = [];

  value.forEach((item, index) => {
    const safe = (item ?? {}) as Partial<ChatMessage> & {
      id?: unknown;
      type?: unknown;
      text?: unknown;
      imageUri?: unknown;
      sender?: unknown;
      timestamp?: unknown;
    };

    const id =
      typeof safe.id === 'string' && safe.id.trim().length > 0
        ? safe.id
        : `legacy_${Date.now()}_${index}`;

    const sender: 'me' | 'other' | 'system' =
      safe.sender === 'system' || safe.type === 'system'
        ? 'system'
        : safe.sender === 'other'
        ? 'other'
        : 'me';

    const timestamp =
      typeof safe.timestamp === 'string' && safe.timestamp.trim().length > 0
        ? safe.timestamp
        : getCurrentTimestamp();

    if (safe.type === 'system' && typeof safe.text === 'string' && safe.text.trim()) {
      normalized.push({ id, type: 'system', text: safe.text.trim(), sender: 'system', timestamp });
      return;
    }

    if (safe.type === 'image' && typeof safe.imageUri === 'string' && safe.imageUri.trim()) {
      normalized.push({
        id,
        type: 'image',
        imageUri: safe.imageUri,
        sender,
        timestamp,
      });
      return;
    }

    if (typeof safe.text === 'string' && safe.text.trim()) {
      normalized.push({
        id,
        type: 'text',
        text: safe.text.trim(),
        sender,
        timestamp,
      });
    }
  });

  return normalized;
};

// Known-broken URLs (e.g. 0-byte legacy uploads). Tracked at module scope so
// the warning fires once per URL per app session — not on every re-render or
// every chat re-open. The set is purely a log/UI guard; it is never persisted.
const brokenImageUrls = new Set<string>();

const ChatMessageImage = memo(({ uri }: { uri: string }) => {
  const [failed, setFailed] = useState(brokenImageUrls.has(uri));
  const [bustedUri, setBustedUri] = useState<string | null>(null);
  const triedRetryRef = useRef(false);

  if (failed) {
    return (
      <View style={[styles.imageMessage, styles.imageMessageBroken]}>
        <Text style={styles.imageMessageBrokenText}>🖼️</Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: bustedUri ?? uri }}
      style={styles.imageMessage}
      onError={() => {
        // Single cache-bust retry for the Supabase CDN; if the underlying
        // object really is 0 bytes the second fetch will fail too and we
        // mark the URL broken without further log spam.
        if (!triedRetryRef.current && uri.startsWith('http')) {
          triedRetryRef.current = true;
          setBustedUri(`${uri}${uri.includes('?') ? '&' : '?'}t=${Date.now()}`);
          return;
        }
        if (!brokenImageUrls.has(uri)) {
          brokenImageUrls.add(uri);
          console.warn(`[chat] image broken url=${uri.slice(-80)}`);
        }
        setFailed(true);
      }}
    />
  );
});

export default function ChatScreen() {
  useLanguage();
  const router = useRouter();
  const params = useLocalSearchParams<ChatRouteParams>();
  const { jobId, problem, price, creatorName } = params;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [pendingAttachment, setPendingAttachment] = useState<{ uri: string } | null>(null);
  const currentUserRole = resolveCurrentUserRole(params.currentUserRole);
  const [jobContext, setJobContext] = useState<ChatJobContext>(
    buildChatContextFromParams({
      jobId,
      problem,
      price,
      creatorName,
    })
  );
  const [jobStatus, setJobStatus] = useState<Job['status']>('open');
  const [currentJob, setCurrentJob] = useState<Job | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const activatingRef = useRef(false);
  const completionFinalizedRef = useRef(false);
  const completionPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [disputeModalVisible, setDisputeModalVisible] = useState(false);
  const [selectedDisputeReason, setSelectedDisputeReason] = useState<string | null>(null);
  const [disputeNote, setDisputeNote] = useState('');
  const [isSubmittingDispute, setIsSubmittingDispute] = useState(false);
  const [cancelModalVisible, setCancelModalVisible] = useState(false);
  const [selectedCancelReason, setSelectedCancelReason] = useState<string | null>(null);
  const [cancelNote, setCancelNote] = useState('');
  const [isSubmittingCancel, setIsSubmittingCancel] = useState(false);
  const errorToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isEnglish = String(i18n.locale).toLowerCase().startsWith('en');

  useEffect(() => {
    if (errorToast) {
      if (errorToastTimer.current) clearTimeout(errorToastTimer.current);
      errorToastTimer.current = setTimeout(() => setErrorToast(null), 2500);
    }
    return () => {
      if (errorToastTimer.current) clearTimeout(errorToastTimer.current);
    };
  }, [errorToast]);


  const getChatTitle = () => {
    if (jobContext.creatorName) {
      return i18n.t('job.problem_title', { name: jobContext.creatorName });
    }
    return jobContext.problem || i18n.t('chat.chat_title');
  };

  const handleBack = () => {
    goBackOrReplace(router, '/(tabs)/feed');
  };

  const openJobDetails = () => {
    if (!jobContext.jobId) return;
    router.push({ pathname: '/chat-details/[id]', params: { id: jobContext.jobId, currentUserRole, fromChat: 'true' } });
  };

  // Trust & Safety: long-press a counterpart's persisted message to report it.
  // Distinct from the openJobDispute "Problem melden" dispute flow. Own and
  // not-yet-sent messages are not reportable (see the onLongPress gate below).
  const handleMessageLongPress = useCallback((messageId: string) => {
    if (!jobId) return;
    Alert.alert(
      i18n.t('report.message_sheet_title'),
      undefined,
      [
        {
          text: i18n.t('report.titles.message'),
          style: 'destructive',
          onPress: () => router.push({
            // Cast: expo-router regenerates the '/report' typed route on the
            // next dev-server run; the route exists at app/report.tsx.
            pathname: '/report',
            params: { targetType: 'message', messageId, jobId },
          } as unknown as Href),
        },
        { text: i18n.t('report.cancel'), style: 'cancel' },
      ],
    );
  }, [jobId, router]);

  // Single data load — replaces the previous split loadJobContext + loadJobStatus
  // that each called loadJobs() independently, causing two parallel Supabase fetches.
  const loadJobData = useCallback(async () => {
    try {
      const safeJobs = await loadJobs();
      const job = safeJobs.find((j) => j.id === jobId) ?? null;
      setCurrentJob(job);
      if (job) setJobStatus(job.status);
      setJobContext((prev) =>
        resolveJobContext(job ?? undefined, { jobId, problem, price, creatorName }, prev, job?.status ?? jobStatus)
      );
    } catch (error) {
      console.warn('[chat] loadJobData error:', error);
      setJobContext((prev) => ({ ...prev, status: jobStatus }));
    }
  }, [creatorName, jobId, jobStatus, price, problem]);

  useEffect(() => {
    return () => {
      if (completionPollingRef.current) clearInterval(completionPollingRef.current);
    };
  }, []);

  const finalizeCompletion = useCallback(async (job: Job) => {
    if (completionFinalizedRef.current) return;
    completionFinalizedRef.current = true;
    if (completionPollingRef.current) {
      clearInterval(completionPollingRef.current);
      completionPollingRef.current = null;
    }

    const currentScore = await getBuddyScore();
    await setBuddyScore(currentScore + getBuddyPointsForJob({ price: jobContext.price }));
    await recordJobCompletionEarning({
      id: jobId,
      problem: jobContext.problem,
      price: jobContext.price,
      payment: job.payment,
    });
    await incrementReliabilityStats(getActiveUserId(), 'completedJobs');
    if (job.requesterId) {
      await incrementReliabilityStats(job.requesterId, 'completedJobs');
    }

    await addNotification(
      'jobCompleted',
      i18n.t('notifications.job_completed'),
      `${i18n.t('notifications.job_completed')}: ${jobContext.problem || 'Job'}`,
      jobId
    );

    const completedSysMsg = createSystemMessage(i18n.t('chat.system_job_completed'));
    const newSysMsgs: ChatMessage[] = [completedSysMsg];

    if (currentUserRole === 'buddy') {
      const payout = Number(job.payment?.buddyEarnings) || 0;
      if (payout > 0) {
        newSysMsgs.push(createSystemMessage(
          isEnglish
            ? `💰 Payout ready: ${payout.toFixed(2)}€ — Your payout has been released.`
            : `💰 Auszahlung bereit: ${payout.toFixed(2)}€ — Deine Auszahlung wurde freigegeben.`
        ));
      }
    }

    setMessages((prev) => {
      const next = [...prev, ...newSysMsgs];
      persistMessages(next);
      return next;
    });

    setJobStatus('completed');
    router.push({ pathname: '/review/[jobId]', params: { jobId, currentUserRole } });
  }, [currentUserRole, isEnglish, jobContext.price, jobContext.problem, jobId, router]);

  const startCompletionPolling = useCallback(() => {
    if (completionPollingRef.current) return;
    completionPollingRef.current = setInterval(async () => {
      try {
        const jobs = await loadJobs();
        const job = jobs.find((j) => j.id === jobId);
        if (job?.status === 'completed') {
          setCurrentJob(job);
          setJobStatus('completed');
          await finalizeCompletion(job);
        }
      } catch (e) {
        console.warn('[chat] completion polling error:', e);
      }
    }, 5000);
  }, [finalizeCompletion, jobId]);

  const completeJob = async () => {
    try {
      const { updatedJob, bothConfirmed } = await confirmJobCompletion({
        jobId,
        confirmedByRole: currentUserRole,
      });

      setCurrentJob(updatedJob);

      const sysKey = currentUserRole === 'auftraggeber'
        ? 'chat.system_owner_confirmed_completion'
        : 'chat.system_buddy_confirmed_completion';
      const sysMsg = createSystemMessage(i18n.t(sysKey));
      setMessages((prev) => {
        const next = [...prev, sysMsg];
        persistMessages(next);
        return next;
      });

      if (bothConfirmed) {
        await finalizeCompletion(updatedJob);
      } else {
        startCompletionPolling();
      }
    } catch (error) {
      console.error('Error completing job:', error);
      setErrorToast(isEnglish ? 'Could not complete job. Please try again.' : 'Abschluss fehlgeschlagen. Bitte erneut versuchen.');
    }
  };

  const handleReportIssue = () => {
    if (currentJob?.disputeStatus === 'opened') return;
    setSelectedDisputeReason(null);
    setDisputeNote('');
    setDisputeModalVisible(true);
  };

  const submitDispute = async () => {
    if (!selectedDisputeReason || isSubmittingDispute) return;
    setIsSubmittingDispute(true);
    try {
      const { updatedJob } = await openJobDispute({
        jobId,
        reporterRole: currentUserRole,
        reason: selectedDisputeReason,
        message: disputeNote,
      });
      setCurrentJob(updatedJob);
      const sysMsg = createSystemMessage(isEnglish ? '⚠ Issue reported — we are reviewing the case.' : '⚠ Problem gemeldet — Wir prüfen den Fall.');
      setMessages((prev) => {
        const next = [...prev, sysMsg];
        persistMessages(next);
        return next;
      });
      setDisputeModalVisible(false);
    } catch {
      setErrorToast(isEnglish ? 'Could not submit report. Please try again.' : 'Problem konnte nicht gesendet werden.');
    } finally {
      setIsSubmittingDispute(false);
    }
  };

  const submitCancelRequest = async () => {
    if (!selectedCancelReason || isSubmittingCancel) return;
    setIsSubmittingCancel(true);
    try {
      const { updatedJob } = await requestJobCancellation({
        jobId,
        requestedByRole: currentUserRole,
        reason: selectedCancelReason,
        message: cancelNote,
      });
      setCurrentJob(updatedJob);
      const sysMsg = createSystemMessage(isEnglish ? '↩ Cancellation requested — waiting for the other side.' : '↩ Abbruch angefragt — Warte auf Bestätigung.');
      setMessages((prev) => { const next = [...prev, sysMsg]; persistMessages(next); return next; });
      setCancelModalVisible(false);
    } catch {
      setErrorToast(isEnglish ? 'Could not send cancellation request.' : 'Abbruch konnte nicht gesendet werden.');
    } finally {
      setIsSubmittingCancel(false);
    }
  };

  const handleConfirmCancel = async () => {
    try {
      const { updatedJob } = await confirmJobCancellation({ jobId });
      setCurrentJob(updatedJob);
      setJobStatus('cancelled');
      const sysMsg = createSystemMessage(isEnglish ? '✕ Job cancelled.' : '✕ Job wurde abgebrochen.');
      setMessages((prev) => { const next = [...prev, sysMsg]; persistMessages(next); return next; });
    } catch {
      setErrorToast(isEnglish ? 'Could not confirm cancellation.' : 'Bestätigung fehlgeschlagen.');
    }
  };

  const handleDeclineCancel = async () => {
    try {
      const { updatedJob } = await declineJobCancellation({ jobId });
      setCurrentJob(updatedJob);
      const sysMsg = createSystemMessage(isEnglish ? '↺ Cancellation declined — job continues.' : '↺ Abbruch abgelehnt — Job läuft weiter.');
      setMessages((prev) => { const next = [...prev, sysMsg]; persistMessages(next); return next; });
    } catch {
      setErrorToast(isEnglish ? 'Could not decline cancellation.' : 'Ablehnen fehlgeschlagen.');
    }
  };

  const loadMessages = useCallback(async () => {
    try {
      // Phase 1: local cache — instant display on open
      const localRaw = await loadStoredMessages(jobId);
      const normalized = normalizeStoredMessages(localRaw);

      let liveStatus: Job['status'] = 'open';
      try {
        const safeJobs = await loadJobs();
        const found = safeJobs.find((j) => j.id === jobId);
        if (found) liveStatus = found.status;
      } catch { /* fallback to 'open' */ }

      const toInject: ChatMessage[] = [];
      const matchText = i18n.t('chat.system_match_confirmed');
      const activeText = i18n.t('chat.system_job_active');

      if (['matched', 'active', 'completed', 'issue_reported', 'cancelled'].includes(liveStatus)) {
        if (!hasSystemMessageWithText(normalized, matchText)) {
          toInject.push(createSystemMessage(matchText));
        }
      }
      if (['active', 'completed', 'issue_reported'].includes(liveStatus)) {
        if (!hasSystemMessageWithText(normalized, activeText)) {
          toInject.push(createSystemMessage(activeText));
        }
      }

      const localFinal = [...toInject, ...normalized];
      setMessages(localFinal);
      if (toInject.length > 0) {
        await saveStoredMessages(jobId, localFinal);
      }

      // Phase 2: Supabase — authoritative for user messages
      const uid = getActiveUserId();
      const remote = await fetchRemoteMessages(jobId, uid);
      if (!remote) return;

      // Preserve local system messages; replace user messages with remote truth.
      // Keep any optimistic sends that haven't landed in Supabase yet.
      const systemMsgs = localFinal.filter((m) => m.type === 'system');
      const remoteIds = new Set(remote.map((m) => m.id));
      const stillSending = localFinal.filter(
        (m) => m.type !== 'system' && m.status === 'sending' && !remoteIds.has(m.id)
      );
      const merged = [...systemMsgs, ...remote, ...stillSending];
      setMessages(merged);
      await saveStoredMessages(jobId, merged);

      markConversationRead(jobId, uid).catch(() => {});
    } catch (error) {
      console.warn('[chat] loadMessages error:', error);
    }
  }, [jobId]);

  const persistMessages = async (nextMessages: ChatMessage[]) => {
    await saveStoredMessages(jobId, nextMessages);
  };

  // Gallery picker — sets a pending attachment shown above the composer.
  // Upload happens on send, not on selection (matches WhatsApp/iMessage behaviour).
  const pickAttachment = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        setErrorToast(i18n.t('create.allow_media'));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        quality: 0.8,
      });
      if (result.canceled) return;
      const imageUri = result.assets?.[0]?.uri;
      if (!imageUri) return;
      setPendingAttachment({ uri: imageUri });
    } catch (error) {
      console.warn('[chat] pickAttachment error:', error);
    }
  };

  // TODO(rate-limit): enforce per-user message rate limit (e.g. 60/min) to prevent chat spam.
  // Handles text-only, image-only, and text+image sends in one path.
  //
  // UI is never blocked on image upload: the local-URI bubble appears
  // immediately, then the upload + insert run in the background and patch the
  // bubble's id/imageUri/status when they resolve. The user can keep typing
  // and send more messages while the upload is in flight.
  const sendMessage = async () => {
    const text = input.trim();
    const attachment = pendingAttachment;
    if (!text && !attachment) return;

    // Clear inputs immediately so user can keep typing
    setInput('');
    setPendingAttachment(null);

    const now = getCurrentTimestamp();
    const tempImgId = attachment ? `opt_img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` : null;
    const tempTextId = text ? `opt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` : null;

    const optimisticMsgs: ChatMessage[] = [];
    if (tempImgId && attachment) {
      optimisticMsgs.push({
        id: tempImgId, type: 'image', imageUri: attachment.uri,
        sender: 'me', timestamp: now, status: 'sending',
      });
    }
    if (tempTextId && text) {
      optimisticMsgs.push({
        id: tempTextId, type: 'text', text,
        sender: 'me', timestamp: now, status: 'sending',
      });
    }

    setMessages((prev) => {
      const next = [...prev, ...optimisticMsgs];
      persistMessages(next);
      return next;
    });

    // Image: upload in background, never block the UI
    if (attachment && tempImgId) {
      void (async () => {
        try {
          const t0 = Date.now();
          const imageRemoteUrl = await uploadChatImage(attachment.uri, jobId, getActiveUserId());
          const imageDbId = await insertMessage(jobId, null, imageRemoteUrl, getActiveUserId());
          debugLog(`[chat] image send total ${Date.now() - t0}ms`);
          setMessages((prev) => {
            const mapped = prev.map((m) =>
              m.id === tempImgId
                ? { ...m, id: imageDbId ?? tempImgId, imageUri: imageRemoteUrl, status: (imageDbId ? 'sent' : 'failed') as 'sent' | 'failed' }
                : m
            );
            const seen = new Set<string>();
            return mapped.filter((m) => { const dup = seen.has(m.id); seen.add(m.id); return !dup; });
          });
        } catch (uploadError) {
          console.warn('[chat] background image upload failed:', uploadError);
          setMessages((prev) => prev.map((m) => m.id === tempImgId ? { ...m, status: 'failed' as const } : m));
          setErrorToast(isEnglish ? 'Could not upload image. Please try again.' : 'Bild konnte nicht hochgeladen werden.');
        }
      })();
    }

    // Text: insert is fast (~100ms); await so failures surface immediately.
    if (text && tempTextId) {
      try {
        const dbId = await insertMessage(jobId, text, null, getActiveUserId());
        setMessages((prev) => {
          const mapped = prev.map((m) =>
            m.id === tempTextId
              ? { ...m, id: dbId ?? tempTextId, status: (dbId ? 'sent' : 'failed') as 'sent' | 'failed' }
              : m
          );
          const seen = new Set<string>();
          return mapped.filter((m) => { const dup = seen.has(m.id); seen.add(m.id); return !dup; });
        });
      } catch (insertError) {
        console.warn('[chat] sendMessage: text insert failed:', insertError);
        setMessages((prev) => prev.map((m) => m.id === tempTextId ? { ...m, status: 'failed' as const } : m));
      }
    }
  };

  useEffect(() => {
    if (jobId) {
      loadMessages();
      loadJobData();
    }
    // Intentionally only triggers on jobId. The loadMessages / loadJobData
    // callbacks themselves depend on state (jobStatus etc.) that they SET when
    // they run — including them here causes the effect to re-fire after every
    // load and produce a loadJobs() loop on every chat open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  useEffect(() => {
    const activateIfMatched = async () => {
      if (!jobId || !currentJob) return;
      if (currentJob.status !== 'matched') return;
      if (!isJobChatAccessible(currentJob)) return;
      // Guard against re-entrancy: currentJob changes can re-trigger this effect
      // before the previous activation write has propagated back through state.
      if (activatingRef.current) return;
      activatingRef.current = true;

      try {
        const result = await activateMatchedJob({
          jobId,
          activatedByRole: currentUserRole,
        });

        if (result.updatedJob) {
          setCurrentJob(result.updatedJob);
          setJobStatus(result.updatedJob.status);
          setJobContext((prev) => ({
            ...prev,
            status: result.updatedJob?.status ?? prev.status,
          }));
          if (result.resultingStatus === 'active') {
            await loadMessages(); // injects "job active" system message
            await addNotification(
              'chatUnlocked',
              i18n.t('notifications.chatUnlocked_title'),
              i18n.t('notifications.chatUnlocked_message'),
              jobId
            );
          }
        }
      } catch (error) {
        console.warn('[chat] activateMatchedJob error:', error);
      } finally {
        activatingRef.current = false;
      }
    };

    activateIfMatched();
  }, [currentJob, currentUserRole, jobId]);

  useEffect(() => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, [messages]);

  // Realtime subscription — scoped to the active conversation only.
  // Fires for INSERT events on public.messages WHERE job_id = current jobId.
  // Deduplication: filter by existing ids before appending so optimistic
  // messages that were already reconciled (tempId → dbId) are not re-added.
  useEffect(() => {
    if (!jobId) return;
    const uid = getActiveUserId();
    const unsub = subscribeToMessages(jobId, uid, (incoming) => {
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const newMsgs = incoming.filter((m) => !existingIds.has(m.id));
        if (newMsgs.length === 0) return prev;
        return [...prev, ...newMsgs];
      });
      markConversationRead(jobId, uid).catch(() => {});
    });
    return () => { unsub(); };
  }, [jobId]);

  const hasChatAccess = isJobChatAccessible(currentJob ?? { status: jobStatus });
  const isChatWritable = hasChatAccess && isJobChatWritable(jobStatus);
  const canSend = (input.trim().length > 0 || !!pendingAttachment) && isChatWritable;
  const hasOpenDispute = currentJob?.disputeStatus === 'opened';
  const showCompletionCta = hasChatAccess && (jobStatus === 'matched' || jobStatus === 'active');
  const iHaveConfirmedCompletion = currentUserRole === 'auftraggeber'
    ? Boolean(currentJob?.completionConfirmation?.ownerConfirmedAt)
    : Boolean(currentJob?.completionConfirmation?.buddyConfirmedAt);
  const otherSideConfirmed = !iHaveConfirmedCompletion && (
    currentUserRole === 'auftraggeber'
      ? Boolean(currentJob?.completionConfirmation?.buddyConfirmedAt)
      : Boolean(currentJob?.completionConfirmation?.ownerConfirmedAt)
  );
  const hasPendingCancellation = currentJob?.cancellationStatus === 'requested';
  const iAmCancelRequester = currentJob?.cancelledBy === currentUserRole;

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: i18n.t('chat.chat_title'),
          headerBackTitle: i18n.t('common.back'),
          headerLeft: () => (
            <Pressable onPress={handleBack} hitSlop={8}>
              <Text style={styles.headerBackText}>{i18n.t('common.back')}</Text>
            </Pressable>
          ),
        }}
      />

      {!jobId ? (
        <View style={styles.container}>
          <View style={styles.errorContainer}>
            <Text style={styles.errorTitle}>{i18n.t('common.job_not_found_title')}</Text>
            <Text style={styles.errorText}>{i18n.t('common.job_not_found_text')}</Text>
          </View>
        </View>
      ) : (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <View style={styles.headerCard}>
          <View style={styles.headerTopRow}>
            <Text style={styles.headerEyebrow}>{i18n.t('chat.active_job')}</Text>
            {jobContext.price ? (
              <View style={styles.headerPricePill}>
                <Text style={styles.headerPriceText}>{jobContext.price}€</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.headerTitle} numberOfLines={2} ellipsizeMode="tail">
            {jobContext.problem || getChatTitle()}
          </Text>
          <View style={styles.headerBottomRow}>
            <View style={[
              styles.headerStatusBadge,
              jobStatus === 'active' && styles.headerStatusBadgeActive,
              jobStatus === 'issue_reported' && styles.headerStatusBadgeIssue,
              jobStatus === 'completed' && styles.headerStatusBadgeCompleted,
              jobStatus === 'cancelled' && styles.headerStatusBadgeCancelled,
            ]}>
              <Text style={[
                styles.headerStatusBadgeText,
                jobStatus === 'active' && styles.headerStatusBadgeTextActive,
                jobStatus === 'issue_reported' && styles.headerStatusBadgeTextIssue,
                jobStatus === 'completed' && styles.headerStatusBadgeTextCompleted,
              ]}>
                {getStatusLabel(jobStatus)}
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.detailsButton, pressed && styles.buttonPressed]}
              onPress={openJobDetails}
            >
              <Text style={styles.detailsButtonText}>{i18n.t('chat.open_job_details')}</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView
          ref={scrollViewRef}
          style={styles.messagesArea}
          contentContainerStyle={styles.messagesContent}
          showsVerticalScrollIndicator={false}
        >
          {messages.length === 0 && (
            <View style={styles.preChatInfoCard}>
              <Text style={styles.preChatInfoTitle}>
                {hasChatAccess ? i18n.t('chat.prechat_info') : i18n.t('chat.prechat_blocked_info')}
              </Text>
              <Text style={styles.preChatInfoHint}>{i18n.t('chat.prestate_hint')}</Text>
              {hasChatAccess && (
                <Text style={styles.preChatSafetyHint}>{i18n.t('chat.safety_hint')}</Text>
              )}
              {hasChatAccess && isChatWritable && (
                <Pressable
                  style={styles.starterPromptButton}
                  onPress={() => setInput(i18n.t('chat.starter_prompt'))}
                >
                  <Text style={styles.starterPromptButtonText}>{i18n.t('chat.use_starter_prompt')}</Text>
                </Pressable>
              )}
            </View>
          )}

          {messages.map((message, index) => {
            if (message.type === 'system') {
              return (
                <View key={message.id} style={styles.systemMessageWrapper}>
                  <View style={styles.systemMessagePill}>
                    <Text style={styles.systemMessageText}>{message.text}</Text>
                  </View>
                </View>
              );
            }

            const previousMessage = index > 0 ? messages[index - 1] : null;
            const groupedWithPrevious =
              previousMessage?.sender === message.sender && previousMessage?.type !== 'system';
            const messageRole = getMessageRole(message, currentUserRole);
            const isAuftraggeberMessage = messageRole === 'auftraggeber';

            return (
            <View
              key={message.id}
              style={[
                styles.messageWrapper,
                groupedWithPrevious && styles.messageWrapperGrouped,
                message.sender === 'me'
                  ? styles.messageWrapperRight
                  : styles.messageWrapperLeft,
              ]}
            >
              <Pressable
                style={[
                  styles.messageBubble,
                  message.type === 'image' && styles.imageMessageBubble,
                  isAuftraggeberMessage
                    ? styles.auftraggeberMessage
                    : styles.buddyMessage,
                ]}
                // Only the counterpart's already-persisted messages can be
                // reported (own / sending / failed messages have no reportable
                // server row, and self-reports are rejected by the backend).
                onLongPress={
                  message.sender === 'other' &&
                  message.status !== 'sending' &&
                  message.status !== 'failed'
                    ? () => handleMessageLongPress(message.id)
                    : undefined
                }
                delayLongPress={350}
              >
                {message.type === 'image' && message.imageUri ? (
                  <ChatMessageImage uri={message.imageUri} />
                ) : (
                  <Text
                    style={[
                      styles.messageText,
                      isAuftraggeberMessage
                        ? styles.auftraggeberMessageText
                        : styles.buddyMessageText,
                    ]}
                  >
                    {message.text}
                  </Text>
                )}
              </Pressable>

              {!groupedWithPrevious && (
                <Text style={styles.timestamp}>{message.timestamp}</Text>
              )}
            </View>
            );
          })}
        </ScrollView>

        {hasOpenDispute && (
          <View style={styles.disputeBanner}>
            <Text style={styles.disputeBannerTitle}>
              {isEnglish ? '⚠ Issue reported' : '⚠ Problem gemeldet'}
            </Text>
            <Text style={styles.disputeBannerSubtitle}>
              {isEnglish ? 'We are reviewing the case.' : 'Wir prüfen den Fall.'}
            </Text>
          </View>
        )}

        {hasPendingCancellation && (
          <View style={styles.cancelBanner}>
            {iAmCancelRequester ? (
              <>
                <Text style={styles.cancelBannerTitle}>
                  {isEnglish ? '↩ Cancellation requested' : '↩ Abbruch angefragt'}
                </Text>
                <Text style={styles.cancelBannerSubtitle}>
                  {isEnglish ? 'Waiting for the other side to respond.' : 'Warte auf Bestätigung der anderen Seite.'}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.cancelBannerTitle}>
                  {isEnglish ? '↩ Cancellation requested by the other side' : '↩ Abbruch von der anderen Seite angefragt'}
                </Text>
                {currentJob?.cancellationReason ? (
                  <Text style={styles.cancelBannerSubtitle}>
                    {isEnglish ? `Reason: ${currentJob.cancellationReason}` : `Grund: ${currentJob.cancellationReason}`}
                  </Text>
                ) : null}
                <View style={styles.cancelBannerActions}>
                  <Pressable style={styles.cancelBannerConfirmBtn} onPress={handleConfirmCancel}>
                    <Text style={styles.cancelBannerConfirmBtnText}>
                      {isEnglish ? 'Confirm cancellation' : 'Abbruch bestätigen'}
                    </Text>
                  </Pressable>
                  <Pressable style={styles.cancelBannerDeclineBtn} onPress={handleDeclineCancel}>
                    <Text style={styles.cancelBannerDeclineBtnText}>
                      {isEnglish ? 'Continue job' : 'Job fortsetzen'}
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        )}

        <View style={styles.bottomContainer}>
          {jobStatus === 'completed' && (
            <View style={styles.completionSuccessBanner}>
              <Text style={styles.completionSuccessBannerTitle}>
                {isEnglish ? '✓ Job completed' : '✓ Auftrag abgeschlossen'}
              </Text>
              <Text style={styles.completionSuccessBannerSubtitle}>
                {currentUserRole === 'buddy'
                  ? (isEnglish ? 'Payout ready — your balance has been released.' : 'Auszahlung bereit – dein Guthaben wurde freigegeben.')
                  : (isEnglish ? 'The job has been successfully completed.' : 'Der Auftrag wurde erfolgreich abgeschlossen.')}
              </Text>
            </View>
          )}
          {hasChatAccess && (jobStatus === 'matched' || jobStatus === 'active') && (
            <View style={styles.quickActionsRow}>
              {showCompletionCta && (
                (hasOpenDispute || hasPendingCancellation) ? (
                  <View style={styles.completionPausedRow}>
                    <Text style={styles.completionPausedText}>
                      {hasOpenDispute
                        ? (isEnglish ? 'Completion paused until issue is resolved.' : 'Abschluss pausiert, bis das Problem geklärt ist.')
                        : (isEnglish ? 'Completion paused until cancellation is resolved.' : 'Abschluss pausiert, bis der Abbruch geklärt ist.')}
                    </Text>
                  </View>
                ) : iHaveConfirmedCompletion ? (
                  <View style={styles.completionAwaitingRow}>
                    <Text style={styles.completionAwaitingText}>{i18n.t('chat.completion_awaiting_other')}</Text>
                  </View>
                ) : (
                  <Pressable
                    style={[styles.completeButtonInline, otherSideConfirmed && styles.completeButtonInlineUrgent]}
                    onPress={completeJob}
                  >
                    <Text style={styles.completeButtonInlineText}>
                      {otherSideConfirmed
                        ? (isEnglish ? '✓ Other side confirmed — confirm now' : '✓ Gegenseite bestätigt — jetzt bestätigen')
                        : i18n.t('chat.confirm_completion')}
                    </Text>
                  </Pressable>
                )
              )}
              <Pressable
                style={[styles.reportButtonInline, hasOpenDispute && styles.reportButtonInlineDisabled]}
                onPress={handleReportIssue}
                disabled={hasOpenDispute}
              >
                <Text style={[styles.reportButtonInlineText, hasOpenDispute && styles.reportButtonInlineTextDisabled]}>
                  {hasOpenDispute
                    ? (isEnglish ? 'Reported' : 'Gemeldet')
                    : i18n.t('chat.report_issue')}
                </Text>
              </Pressable>
            </View>
          )}

          {hasChatAccess && (jobStatus === 'matched' || jobStatus === 'active') && (
            <Pressable
              style={styles.cancelTriggerRow}
              onPress={() => {
                setSelectedCancelReason(null);
                setCancelNote('');
                setCancelModalVisible(true);
              }}
              disabled={hasPendingCancellation || hasOpenDispute}
            >
              <Text style={[styles.cancelTriggerText, (hasPendingCancellation || hasOpenDispute) && styles.cancelTriggerTextDisabled]}>
                {hasPendingCancellation
                  ? (isEnglish ? 'Cancellation pending…' : 'Abbruch ausstehend…')
                  : (isEnglish ? 'Cancel job' : 'Job abbrechen')}
              </Text>
            </Pressable>
          )}

          {!isChatWritable && (
            <Text style={styles.inputHint}>
              {hasChatAccess
                ? i18n.t('chat.input_disabled_hint')
                : i18n.t('chat.input_blocked_hint')}
            </Text>
          )}

          {pendingAttachment && (
            <View style={styles.attachmentPreviewBar}>
              <Image source={{ uri: pendingAttachment.uri }} style={styles.attachmentPreviewThumb} />
              <Text style={styles.attachmentPreviewLabel} numberOfLines={1}>
                {isEnglish ? 'Image selected' : 'Bild ausgewählt'}
              </Text>
              <Pressable
                style={({ pressed }) => [styles.attachmentPreviewRemove, pressed && styles.buttonPressed]}
                onPress={() => setPendingAttachment(null)}
                hitSlop={8}
              >
                <Text style={styles.attachmentPreviewRemoveText}>✕</Text>
              </Pressable>
            </View>
          )}

          <View style={styles.inputContainer}>
            <Pressable
              style={({ pressed }) => [
                styles.mediaButton,
                !isChatWritable && styles.sendButtonDisabled,
                pressed && styles.buttonPressed,
              ]}
              onPress={pickAttachment}
              disabled={!isChatWritable}
            >
              <Text style={styles.mediaButtonText}>+</Text>
            </Pressable>

            <TextInput
              style={styles.input}
              placeholder={i18n.t('chat.write_something')}
              placeholderTextColor="#8E8E93"
              value={input}
              onChangeText={setInput}
              multiline
              editable={isChatWritable}
            />

            <Pressable
              style={({ pressed }) => [
                styles.sendButton,
                !canSend && styles.sendButtonDisabled,
                pressed && canSend && styles.buttonPressed,
              ]}
              onPress={sendMessage}
              disabled={!canSend}
            >
              <Text style={styles.sendButtonText}>→</Text>
            </Pressable>
          </View>
        </View>
        {errorToast && (
          <View style={styles.errorToast} pointerEvents="none">
            <Text style={styles.errorToastText}>{errorToast}</Text>
          </View>
        )}
      </KeyboardAvoidingView>
      )}

      <Modal
        visible={disputeModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setDisputeModalVisible(false)}
      >
        <Pressable style={styles.disputeModalBackdrop} onPress={() => setDisputeModalVisible(false)}>
          <Pressable style={styles.disputeModalSheet} onPress={() => {}}>
            <View style={styles.disputeModalHandle} />
            <Text style={styles.disputeModalTitle}>
              {isEnglish ? 'Report issue' : 'Problem melden'}
            </Text>
            <Text style={styles.disputeModalSubtitle}>
              {isEnglish ? 'What happened?' : 'Was ist passiert?'}
            </Text>

            {DISPUTE_REASONS.map((r) => (
              <Pressable
                key={r.key}
                style={[
                  styles.disputeReasonRow,
                  selectedDisputeReason === r.key && styles.disputeReasonRowSelected,
                ]}
                onPress={() => setSelectedDisputeReason(r.key)}
              >
                <View style={[
                  styles.disputeReasonRadio,
                  selectedDisputeReason === r.key && styles.disputeReasonRadioSelected,
                ]} />
                <Text style={[
                  styles.disputeReasonLabel,
                  selectedDisputeReason === r.key && styles.disputeReasonLabelSelected,
                ]}>
                  {isEnglish ? r.en : r.de}
                </Text>
              </Pressable>
            ))}

            <TextInput
              style={styles.disputeNoteInput}
              placeholder={isEnglish ? 'Optional: more details...' : 'Optional: weitere Details...'}
              placeholderTextColor={colors.placeholder}
              value={disputeNote}
              onChangeText={setDisputeNote}
              multiline
            />

            <Pressable
              style={[
                styles.disputeSubmitBtn,
                (!selectedDisputeReason || isSubmittingDispute) && styles.disputeSubmitBtnDisabled,
              ]}
              onPress={submitDispute}
              disabled={!selectedDisputeReason || isSubmittingDispute}
            >
              <Text style={styles.disputeSubmitBtnText}>
                {isEnglish ? 'Submit report' : 'Problem senden'}
              </Text>
            </Pressable>

            <Pressable style={styles.disputeCancelBtn} onPress={() => setDisputeModalVisible(false)}>
              <Text style={styles.disputeCancelBtnText}>
                {isEnglish ? 'Cancel' : 'Abbrechen'}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={cancelModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCancelModalVisible(false)}
      >
        <Pressable style={styles.disputeModalBackdrop} onPress={() => setCancelModalVisible(false)}>
          <Pressable style={styles.disputeModalSheet} onPress={() => {}}>
            <View style={styles.disputeModalHandle} />
            <Text style={styles.disputeModalTitle}>
              {isEnglish ? 'Cancel job' : 'Job abbrechen'}
            </Text>
            <Text style={styles.disputeModalSubtitle}>
              {isEnglish ? 'Why do you want to cancel?' : 'Warum möchtest du abbrechen?'}
            </Text>

            {CANCEL_REASONS.map((r) => (
              <Pressable
                key={r.key}
                style={[
                  styles.disputeReasonRow,
                  selectedCancelReason === r.key && styles.disputeReasonRowSelected,
                ]}
                onPress={() => setSelectedCancelReason(r.key)}
              >
                <View style={[
                  styles.disputeReasonRadio,
                  selectedCancelReason === r.key && styles.disputeReasonRadioSelected,
                ]} />
                <Text style={[
                  styles.disputeReasonLabel,
                  selectedCancelReason === r.key && styles.disputeReasonLabelSelected,
                ]}>
                  {isEnglish ? r.en : r.de}
                </Text>
              </Pressable>
            ))}

            <TextInput
              style={styles.disputeNoteInput}
              placeholder={isEnglish ? 'Optional: more details...' : 'Optional: weitere Details...'}
              placeholderTextColor={colors.placeholder}
              value={cancelNote}
              onChangeText={setCancelNote}
              multiline
            />

            <Pressable
              style={[
                styles.disputeSubmitBtn,
                (!selectedCancelReason || isSubmittingCancel) && styles.disputeSubmitBtnDisabled,
              ]}
              onPress={submitCancelRequest}
              disabled={!selectedCancelReason || isSubmittingCancel}
            >
              <Text style={styles.disputeSubmitBtnText}>
                {isEnglish ? 'Request cancellation' : 'Abbruch anfragen'}
              </Text>
            </Pressable>

            <Pressable style={styles.disputeCancelBtn} onPress={() => setCancelModalVisible(false)}>
              <Text style={styles.disputeCancelBtnText}>
                {isEnglish ? 'Keep the job' : 'Job behalten'}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerBackText: {
    ...typography.metaStrong,
    color: colors.textPrimary,
  },
  headerCard: {
    backgroundColor: colors.card,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginHorizontal: layout.screenPaddingX,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    borderRadius: layout.borderRadiusMedium,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    justifyContent: 'space-between',
  },
  headerEyebrow: {
    ...typography.meta,
    color: colors.secondary,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  headerTitle: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  headerStatusHint: {
    ...typography.meta,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  headerStatusHintIssue: {
    color: colors.red,
  },
  detailsButton: {
    alignSelf: 'flex-start',
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.veryLightGrey,
    borderWidth: 1,
    borderColor: colors.lightBorder,
  },
  detailsButtonText: {
    ...typography.metaStrong,
    color: colors.textPrimary,
  },
  messagesArea: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  messagesContent: {
    paddingBottom: layout.cardPadding,
    paddingTop: spacing.xs,
  },
  preChatInfoCard: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    padding: spacing.lg,
    marginVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.lightBorder,
  },
  preChatInfoText: {
    ...typography.meta,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  buttonPressed: {
    opacity: 0.94,
    transform: [{ scale: 0.992 }],
  },
  messageWrapper: {
    marginBottom: spacing.md,
    maxWidth: '80%',
  },
  messageWrapperGrouped: {
    marginTop: spacing.xs,
  },
  messageWrapperLeft: {
    alignSelf: 'flex-start',
  },
  messageWrapperRight: {
    alignSelf: 'flex-end',
  },
  messageBubble: {
    borderRadius: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.xs,
  },
  imageMessageBubble: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    overflow: 'hidden',
  },
  auftraggeberMessage: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  buddyMessage: {
    backgroundColor: colors.secondary,
    borderBottomLeftRadius: 4,
  },
  messageText: {
    ...typography.body,
  },
  auftraggeberMessageText: {
    color: colors.card,
  },
  buddyMessageText: {
    color: colors.card,
  },
  timestamp: {
    ...typography.meta,
    color: colors.placeholder,
    paddingHorizontal: spacing.xs,
  },
  bottomContainer: {
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.lightBorder,
    paddingTop: spacing.sm,
    paddingBottom: Platform.OS === 'ios' ? spacing.xl : spacing.md,
  },
  inputHint: {
    ...typography.meta,
    color: colors.textSecondary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  attachmentPreviewBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: colors.veryLightGrey,
    borderRadius: layout.borderRadiusMedium,
    borderWidth: 1,
    borderColor: colors.lightBorder,
  },
  attachmentPreviewThumb: {
    width: 44,
    height: 44,
    borderRadius: layout.borderRadiusSmall,
    backgroundColor: colors.lightGreyVariant,
  },
  attachmentPreviewLabel: {
    flex: 1,
    marginHorizontal: spacing.md,
    ...typography.meta,
    color: colors.textSecondary,
  },
  attachmentPreviewRemove: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.lightBorder,
  },
  attachmentPreviewRemoveText: {
    color: colors.textPrimary,
    ...typography.meta,
  },
  mediaButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.veryLightGrey,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  mediaButtonText: {
    ...typography.buttonSecondary,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  input: {
    flex: 1,
    backgroundColor: colors.veryLightGrey,
    borderRadius: layout.borderRadiusMedium,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    ...typography.body,
    color: colors.textPrimary,
    maxHeight: 100,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.md,
  },
  sendButtonDisabled: {
    opacity: 0.45,
  },
  sendButtonText: {
    color: colors.card,
    ...typography.buttonSecondary,
  },
  completeButtonText: {
    color: colors.card,
    ...typography.buttonSecondary,
  },
  imageMessage: {
    width: 180,
    height: 180,
    borderRadius: layout.borderRadiusSmall,
    backgroundColor: colors.veryLightGrey,
  },
  imageMessageBroken: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.lightBorder,
  },
  imageMessageBrokenText: {
    fontSize: 32,
    opacity: 0.5,
  },
  // Header
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  headerPricePill: {
    backgroundColor: colors.lightOrange,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  headerPriceText: {
    ...typography.metaStrong,
    color: colors.primary,
  },
  headerBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  headerStatusBadge: {
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    backgroundColor: colors.veryLightGrey,
    borderWidth: 1,
    borderColor: colors.lightBorder,
  },
  headerStatusBadgeActive: {
    backgroundColor: colors.veryLightPurple,
    borderColor: colors.overlayLightPurple,
  },
  headerStatusBadgeIssue: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  headerStatusBadgeCompleted: {
    backgroundColor: colors.lightGreen,
    borderColor: colors.green,
  },
  headerStatusBadgeCancelled: {
    backgroundColor: colors.veryLightGrey,
    borderColor: colors.lightBorder,
  },
  headerStatusBadgeText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: colors.textSecondary,
  },
  headerStatusBadgeTextActive: {
    color: colors.secondary,
  },
  headerStatusBadgeTextIssue: {
    color: colors.red,
  },
  headerStatusBadgeTextCompleted: {
    color: colors.green,
  },
  // System messages
  systemMessageWrapper: {
    alignItems: 'center',
    marginVertical: spacing.md,
  },
  systemMessagePill: {
    backgroundColor: colors.veryLightGrey2,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    maxWidth: '85%',
  },
  systemMessageText: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  // Message status
  messageStatus: {
    fontSize: 10,
    color: colors.placeholder,
    paddingHorizontal: spacing.xs,
    marginTop: 1,
    alignSelf: 'flex-end',
  },
  // Empty state
  preChatInfoTitle: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  preChatInfoHint: {
    ...typography.meta,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  preChatSafetyHint: {
    ...typography.meta,
    color: colors.placeholder,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  starterPromptButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.veryLightPurple,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.overlayLightPurple,
  },
  starterPromptButtonText: {
    ...typography.metaStrong,
    color: colors.secondary,
  },
  // Quick actions
  quickActionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: layout.screenPaddingX,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  completeButtonInline: {
    flex: 1,
    backgroundColor: colors.alternateGreen,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  completeButtonInlineUrgent: {
    backgroundColor: colors.primary,
  },
  completeButtonInlineText: {
    ...typography.buttonSecondary,
    color: colors.card,
  },
  completionAwaitingRow: {
    flex: 1,
    backgroundColor: colors.veryLightGrey,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completionAwaitingText: {
    ...typography.meta,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  reportButtonInline: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: layout.borderRadiusSmall,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportButtonInlineText: {
    ...typography.metaStrong,
    color: colors.textSecondary,
  },
  reportButtonInlineDisabled: {
    opacity: 0.5,
    borderColor: colors.lightBorder,
    backgroundColor: colors.veryLightGrey,
  },
  reportButtonInlineTextDisabled: {
    ...typography.metaStrong,
    color: colors.placeholder,
  },
  disputeBanner: {
    marginHorizontal: layout.screenPaddingX,
    marginBottom: spacing.xs,
    backgroundColor: colors.lightOrange,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.lightBorder,
  },
  disputeBannerTitle: {
    ...typography.metaStrong,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  disputeBannerSubtitle: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  completionPausedRow: {
    flex: 1,
    backgroundColor: colors.veryLightGrey,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.lightBorder,
  },
  completionPausedText: {
    ...typography.meta,
    color: colors.textSecondary,
    textAlign: 'center',
    fontWeight: '600',
  },
  errorToast: {
    position: 'absolute',
    left: layout.screenPaddingX,
    right: layout.screenPaddingX,
    bottom: 64,
    backgroundColor: colors.red,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  errorToastText: {
    ...typography.metaStrong,
    color: colors.card,
    textAlign: 'center',
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  errorTitle: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    marginBottom: 8,
    textAlign: 'center',
  },
  errorText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  disputeModalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  disputeModalSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: layout.screenPaddingX,
    paddingBottom: spacing.xxxl,
    paddingTop: spacing.md,
  },
  disputeModalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.lightBorder,
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  disputeModalTitle: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  disputeModalSubtitle: {
    ...typography.meta,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  disputeReasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: layout.borderRadiusSmall,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    marginBottom: spacing.sm,
    backgroundColor: colors.veryLightGrey,
    gap: spacing.md,
  },
  disputeReasonRowSelected: {
    borderColor: colors.secondary,
    backgroundColor: colors.veryLightPurple,
  },
  disputeReasonRadio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.lightBorder,
    backgroundColor: colors.card,
  },
  disputeReasonRadioSelected: {
    borderColor: colors.secondary,
    backgroundColor: colors.secondary,
  },
  disputeReasonLabel: {
    ...typography.body,
    color: colors.textSecondary,
    flex: 1,
  },
  disputeReasonLabelSelected: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  disputeNoteInput: {
    minHeight: 72,
    backgroundColor: colors.veryLightPurple,
    borderRadius: layout.borderRadiusMedium,
    padding: spacing.md,
    ...typography.body,
    color: colors.textPrimary,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    textAlignVertical: 'top',
  },
  disputeSubmitBtn: {
    backgroundColor: colors.secondary,
    borderRadius: layout.borderRadiusMedium,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  disputeSubmitBtnDisabled: {
    opacity: 0.5,
  },
  disputeSubmitBtnText: {
    ...typography.buttonSecondary,
    color: colors.card,
  },
  disputeCancelBtn: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  disputeCancelBtnText: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  cancelBanner: {
    marginHorizontal: layout.screenPaddingX,
    marginBottom: spacing.xs,
    backgroundColor: '#FEF9EC',
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: '#F5E4A0',
  },
  cancelBannerTitle: {
    ...typography.metaStrong,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  cancelBannerSubtitle: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  cancelBannerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  cancelBannerConfirmBtn: {
    flex: 1,
    backgroundColor: '#EF4444',
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  cancelBannerConfirmBtnText: {
    ...typography.metaStrong,
    color: colors.card,
  },
  cancelBannerDeclineBtn: {
    flex: 1,
    backgroundColor: colors.veryLightGrey,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.lightBorder,
  },
  cancelBannerDeclineBtnText: {
    ...typography.metaStrong,
    color: colors.textPrimary,
  },
  cancelTriggerRow: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: layout.screenPaddingX,
  },
  cancelTriggerText: {
    ...typography.meta,
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
  cancelTriggerTextDisabled: {
    color: colors.placeholder,
    textDecorationLine: 'none',
  },
  completionSuccessBanner: {
    backgroundColor: colors.lightGreen,
    borderRadius: layout.borderRadiusMedium,
    borderWidth: 1,
    borderColor: '#C6F0CC',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  completionSuccessBannerTitle: {
    ...typography.metaStrong,
    color: colors.green,
  },
  completionSuccessBannerSubtitle: {
    ...typography.meta,
    color: colors.green,
    lineHeight: 17,
  },
});