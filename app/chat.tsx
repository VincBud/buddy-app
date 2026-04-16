import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors } from '../lib/colors';
import i18n, { useLanguage } from '../lib/i18n';
import { activateMatchedJob, isJobChatAccessible, isJobChatWritable } from '../lib/job-actions';
import { getBuddyPointsForJob, Job } from '../lib/jobs';
import { goBackOrReplace } from '../lib/navigation';
import { createNotification, Notification } from '../lib/notifications';
import { applyPaymentStateForJobStatus, ensureJobPaymentState } from '../lib/payments';
import { layout, spacing } from '../lib/spacing';
import { typography } from '../lib/typography';
import { recordJobCompletionEarning } from '../lib/wallet';

type ChatMessage = {
  id: string;
  type: 'text' | 'image';
  text?: string;
  imageUri?: string;
  sender: 'me' | 'other';
  timestamp: string;
};

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

const createTextMessage = (
  text: string,
  sender: 'me' | 'other'
): ChatMessage => {
  return {
    id: Date.now().toString(),
    type: 'text',
    text: text.trim(),
    sender,
    timestamp: getCurrentTimestamp(),
  };
};

const createImageMessage = (
  imageUri: string,
  sender: 'me' | 'other'
): ChatMessage => {
  return {
    id: `${Date.now()}_image`,
    type: 'image',
    imageUri,
    sender,
    timestamp: getCurrentTimestamp(),
  };
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

    const sender: 'me' | 'other' = safe.sender === 'other' ? 'other' : 'me';

    const timestamp =
      typeof safe.timestamp === 'string' && safe.timestamp.trim().length > 0
        ? safe.timestamp
        : getCurrentTimestamp();

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

export default function ChatScreen() {
  useLanguage();
  const router = useRouter();
  const params = useLocalSearchParams<ChatRouteParams>();
  const { jobId, problem, price, creatorName } = params;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
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

  const chatStorageKey = `chat_${jobId}`;

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
    router.push({ pathname: '/chat-details/[id]', params: { id: jobContext.jobId } });
  };

  const loadJobContext = useCallback(async () => {
    try {
      const jobsRaw = await AsyncStorage.getItem('jobs');
      const parsedJobs = jobsRaw ? JSON.parse(jobsRaw) : [];
      const safeJobs: Job[] = Array.isArray(parsedJobs) ? parsedJobs : [];
      const currentJob = safeJobs.find((j) => j.id === jobId);
      setCurrentJob(currentJob ?? null);

      setJobContext((prev) =>
        resolveJobContext(
          currentJob,
          {
            jobId,
            problem,
            price,
            creatorName,
          },
          prev,
          jobStatus
        )
      );
    } catch (error) {
      console.error('Error loading job context:', error);
      setJobContext((prev) => ({
        ...prev,
        status: jobStatus,
      }));
    }
  }, [
    creatorName,
    jobId,
    jobStatus,
    price,
    problem,
  ]);

  const loadJobStatus = useCallback(async () => {
    try {
      const jobsRaw = await AsyncStorage.getItem('jobs');
      const parsedJobs = jobsRaw ? JSON.parse(jobsRaw) : [];
      const safeJobs = Array.isArray(parsedJobs) ? parsedJobs : [];
      const job = safeJobs.find((j) => j.id === jobId);
      if (job) {
        setJobStatus(job.status);
        setCurrentJob(job);
      }
    } catch (error) {
      console.error('Error loading job status:', error);
    }
  }, [jobId]);

  const completeJob = async () => {
    try {
      const jobsRaw = await AsyncStorage.getItem('jobs');
      const parsedJobs = jobsRaw ? JSON.parse(jobsRaw) : [];
      const safeJobs: any[] = Array.isArray(parsedJobs) ? parsedJobs : [];

      const updatedJobs = safeJobs.map((j) =>
        j.id === jobId
          ? {
              ...j,
              status: 'completed' as const,
              payment: applyPaymentStateForJobStatus(
                ensureJobPaymentState(j),
                'completed'
              ),
            }
          : j
      );

      const scoreRaw = await AsyncStorage.getItem('buddyScore');
      const currentScore = scoreRaw ? Number(scoreRaw) : 0;
      const updatedScore = currentScore + getBuddyPointsForJob({ price: jobContext.price });

      await AsyncStorage.setItem('jobs', JSON.stringify(updatedJobs));
      await AsyncStorage.setItem('buddyScore', updatedScore.toString());
      await recordJobCompletionEarning({
        id: jobId,
        problem: jobContext.problem,
        price: jobContext.price,
      });

      // Create and persist notification
      const notification = createNotification(
        'jobCompleted',
        i18n.t('notifications.job_completed'),
        `${i18n.t('notifications.job_completed')}: ${jobContext.problem || 'Job'}`,
        jobId
      );
      const notificationsRaw = await AsyncStorage.getItem('notifications');
      const existingNotifications: Notification[] = notificationsRaw
        ? JSON.parse(notificationsRaw)
        : [];
      const updatedNotifications = [notification, ...existingNotifications];
      await AsyncStorage.setItem(
        'notifications',
        JSON.stringify(updatedNotifications)
      );

      setJobStatus('completed');
      router.push({
        pathname: '/review/[jobId]',
        params: {
          jobId,
          currentUserRole,
        },
      });
    } catch (error) {
      console.error('Error completing job:', error);
      alert(i18n.t('job.job_complete_error'));
    }
  };

  const loadMessages = useCallback(async () => {
    try {
      const storedMessages = await AsyncStorage.getItem(chatStorageKey);

      if (storedMessages) {
        const parsed = JSON.parse(storedMessages);
        setMessages(normalizeStoredMessages(parsed));
      } else {
        setMessages([]);
      }
    } catch (error) {
      console.error(i18n.t('chat.chat_load_error'), error);
    }
  }, [chatStorageKey]);

  const persistMessages = async (nextMessages: ChatMessage[]) => {
    await AsyncStorage.setItem(chatStorageKey, JSON.stringify(nextMessages));
  };

  const queueAutoReply = () => {
    setTimeout(async () => {
      const replyMessage = createTextMessage(i18n.t('chat.chat_reply_message'), 'other');

      const storedMessages = await AsyncStorage.getItem(chatStorageKey);
      const parsed = storedMessages ? JSON.parse(storedMessages) : [];
      const safeMessages = normalizeStoredMessages(parsed);
      const finalMessages = [...safeMessages, replyMessage];

      setMessages(finalMessages);
      await persistMessages(finalMessages);
    }, 900);
  };

  const sendMessage = async () => {
    if (!input.trim()) return;

    const newMessage = createTextMessage(input, 'me');

    const updatedMessages = [...messages, newMessage];
    setMessages(updatedMessages);
    setInput('');

    try {
      await persistMessages(updatedMessages);
      queueAutoReply();
    } catch (error) {
      console.error(i18n.t('chat.chat_save_error'), error);
    }
  };

  const sendImageMessage = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permissionResult.granted) {
        alert(i18n.t('create.allow_media'));
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

      const newMessage = createImageMessage(imageUri, 'me');
      const updatedMessages = [...messages, newMessage];

      setMessages(updatedMessages);
      await persistMessages(updatedMessages);
      queueAutoReply();
    } catch (error) {
      console.error(i18n.t('chat.chat_save_error'), error);
    }
  };

  useEffect(() => {
    if (jobId) {
      loadMessages();
      loadJobStatus();
      loadJobContext();
    }
  }, [jobId, loadMessages, loadJobContext, loadJobStatus]);

  useEffect(() => {
    const activateIfMatched = async () => {
      if (!jobId || !currentJob) return;
      if (currentJob.status !== 'matched') return;
      if (!isJobChatAccessible(currentJob)) return;

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
        }
      } catch (error) {
        console.error('Error activating matched job:', error);
      }
    };

    activateIfMatched();
  }, [currentJob, currentUserRole, jobId]);

  useEffect(() => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, [messages]);

  const hasChatAccess = isJobChatAccessible(currentJob ?? { status: jobStatus });
  const isChatWritable = hasChatAccess && isJobChatWritable(jobStatus);
  const canSend = input.trim().length > 0 && isChatWritable;
  const showCompletionCta = hasChatAccess && (jobStatus === 'matched' || jobStatus === 'active');

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

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <View style={styles.headerCard}>
          <Text style={styles.headerEyebrow}>{i18n.t('chat.active_job')}</Text>
          <Text style={styles.headerTitle} numberOfLines={1} ellipsizeMode="tail">
            {jobContext.problem || getChatTitle()}
          </Text>
          {jobStatus === 'issue_reported' && (
            <Text style={[styles.headerStatusHint, styles.headerStatusHintIssue]}>
              {i18n.t('chat.status_issue_reported_title')} · {i18n.t('chat.status_issue_reported_subtitle')}
            </Text>
          )}
          {jobStatus === 'cancelled' && (
            <Text style={styles.headerStatusHint}>{i18n.t('chat.status_cancelled_subtitle')}</Text>
          )}
          <Pressable
            style={({ pressed }) => [
              styles.detailsButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={openJobDetails}
          >
            <Text style={styles.detailsButtonText}>{i18n.t('chat.open_job_details')}</Text>
          </Pressable>
        </View>

        <ScrollView
          ref={scrollViewRef}
          style={styles.messagesArea}
          contentContainerStyle={styles.messagesContent}
          showsVerticalScrollIndicator={false}
        >
          {messages.length === 0 && (
            <View style={styles.preChatInfoCard}>
              <Text style={styles.preChatInfoText}>
                {hasChatAccess ? i18n.t('chat.prechat_info') : i18n.t('chat.prechat_blocked_info')}
              </Text>
            </View>
          )}

          {messages.map((message, index) => {
            const previousMessage = index > 0 ? messages[index - 1] : null;
            const groupedWithPrevious = previousMessage?.sender === message.sender;
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
              <View
                style={[
                  styles.messageBubble,
                  message.type === 'image' && styles.imageMessageBubble,
                  isAuftraggeberMessage
                    ? styles.auftraggeberMessage
                    : styles.buddyMessage,
                ]}
              >
                {message.type === 'image' && message.imageUri ? (
                  <Image source={{ uri: message.imageUri }} style={styles.imageMessage} />
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
              </View>

              {!groupedWithPrevious && (
                <Text style={styles.timestamp}>{message.timestamp}</Text>
              )}
            </View>
            );
          })}
        </ScrollView>

        <View style={styles.bottomContainer}>
          {showCompletionCta && (
            <Pressable style={styles.completeButtonBottom} onPress={completeJob}>
              <Text style={styles.completeButtonText}>{i18n.t('chat.mark_completed')}</Text>
            </Pressable>
          )}

          <Text style={styles.inputHint}>
            {isChatWritable
              ? i18n.t('chat.input_hint')
              : hasChatAccess
              ? i18n.t('chat.input_disabled_hint')
              : i18n.t('chat.input_blocked_hint')}
          </Text>

          <View style={styles.inputContainer}>
            <Pressable
              style={({ pressed }) => [
                styles.mediaButton,
                !isChatWritable && styles.sendButtonDisabled,
                pressed && styles.buttonPressed,
              ]}
              onPress={sendImageMessage}
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
      </KeyboardAvoidingView>
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
    minHeight: 116,
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
    marginBottom: spacing.lg,
    maxWidth: '80%',
  },
  messageWrapperGrouped: {
    marginTop: -spacing.sm,
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
    color: colors.iosShadow,
    paddingHorizontal: spacing.xs,
  },
  bottomContainer: {
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.lightBorder,
    paddingTop: spacing.xs,
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
  completeButtonBottom: {
    backgroundColor: colors.secondary,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginHorizontal: layout.screenPaddingX,
    marginVertical: spacing.sm,
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
});