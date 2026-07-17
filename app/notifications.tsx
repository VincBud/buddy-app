import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getActiveUserId } from '../lib/auth';
import { colors } from '../lib/colors';
import { debugLog } from '../lib/config/debug';
import { eventBus } from '../lib/event-bus';
import i18n, { useLanguage } from '../lib/i18n';
import { Job } from '../lib/jobs';
import { goBackOrReplace } from '../lib/navigation';
import {
    getNotificationPresentation,
    getUnreadNotificationCount,
    Notification,
} from '../lib/notifications';
import { loadJobs } from '../services/jobs.service';
import {
    deleteJobApplicationNotification,
    deleteNotificationById,
    getNotifications,
    markAllNotificationsRead,
    markNotificationRead,
    markNotificationUnread,
} from '../services/notifications.service';
import { fetchApplicantPreview, ApplicantPreview, updateJobRequest } from '../services/job-requests.service';
import { layout, spacing } from '../lib/spacing';
import { getReliabilitySignal, getTrustStarFillRatio } from '../lib/trust';
import { typography } from '../lib/typography';

export default function NotificationsScreen() {
  const language = useLanguage();
  const isEnglish = language === 'en';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [reviewingJobId, setReviewingJobId] = useState<string | null>(null);
  const [applicationJobsById, setApplicationJobsById] = useState<Record<string, Job>>({});
  const [buddyPreview, setBuddyPreview] = useState<{ data: ApplicantPreview | null; loading: boolean } | null>(null);
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emptyFade = useRef(new Animated.Value(0)).current;
  const seenIds = useRef(new Set<string>());
  const cardAnims = useRef(new Map<string, Animated.Value>()).current;
  const loadedJobIds = useRef(new Set<string>());

  useEffect(() => {
    if (toast) {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 2500);
    }
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [toast]);

  useEffect(() => {
    if (notifications.length === 0) {
      Animated.timing(emptyFade, {
        toValue: 1,
        duration: 380,
        useNativeDriver: true,
      }).start();
    }
  }, [notifications.length, emptyFade]);

  const showToast = (message: string, variant: 'success' | 'error' = 'success') => {
    setToast({ message, variant });
  };

  const loadNotifications = useCallback(async () => {
    try {
      const loaded = await getNotifications();
      debugLog(
        `[notifications] load: sessionUid=${getActiveUserId()} count=${loaded.length}` +
        (loaded.length > 0
          ? ` types=${[...new Set(loaded.map((n: Notification) => n.type))].join(',')}`
          : '')
      );

      // Animate cards that haven't been seen before
      loaded.forEach((n: Notification) => {
        if (!seenIds.current.has(n.id)) {
          const anim = new Animated.Value(0);
          cardAnims.set(n.id, anim);
          Animated.timing(anim, { toValue: 1, duration: 260, useNativeDriver: true }).start();
        }
      });
      loaded.forEach((n: Notification) => seenIds.current.add(n.id));

      setNotifications(loaded);

      const relatedJobIds = loaded
        .filter(
          (entry: Notification) =>
            entry.type === 'jobApplication' &&
            typeof entry.relatedJobId === 'string' &&
            entry.relatedJobId.trim().length > 0
        )
        .map((entry: Notification) => String(entry.relatedJobId));

      if (relatedJobIds.length === 0) {
        setApplicationJobsById({});
        loadedJobIds.current.clear();
        return;
      }

      const hasNewIds = relatedJobIds.some(id => !loadedJobIds.current.has(id));
      if (!hasNewIds) return;

      const safeJobs: Job[] = await loadJobs();
      relatedJobIds.forEach(id => loadedJobIds.current.add(id));

      const nextById = safeJobs.reduce<Record<string, Job>>((acc, job) => {
        if (relatedJobIds.includes(String(job.id))) {
          acc[String(job.id)] = job;
        }
        return acc;
      }, {});

      setApplicationJobsById(nextById);
    } catch (error) {
      console.error('Error loading notifications:', error);
      setNotifications([]);
      setApplicationJobsById({});
    }
  }, []);

  // Instant refresh via event bus
  useEffect(() => {
    return eventBus.on('notifications:changed', loadNotifications);
  }, [loadNotifications]);

  // Load on focus (cold start / tab switch)
  useFocusEffect(
    useCallback(() => {
      loadNotifications();
    }, [loadNotifications])
  );

  // Read/unread/delete go through the service methods that also sync Supabase.
  // The remote `read_at` / row is authoritative in getNotifications — a purely
  // local write is silently reverted by the next merge (unread again, deleted
  // rows resurrected). Local state is updated optimistically for instant UI.

  const markAsRead = async (id: string) => {
    try {
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      await markNotificationRead(id);
    } catch (error) {
      console.error('Error marking as read:', error);
    }
  };

  const markAsUnread = async (id: string) => {
    try {
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: false } : n)));
      await markNotificationUnread(id);
    } catch (error) {
      console.error('Error marking as unread:', error);
    }
  };

  const deleteNotification = async (id: string) => {
    try {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      await deleteNotificationById(id);
      showToast(isEnglish ? 'Deleted' : 'Gelöscht');
    } catch (error) {
      console.error('Error deleting notification:', error);
      showToast(isEnglish ? 'Could not delete notification.' : 'Löschen fehlgeschlagen.', 'error');
    }
  };

  const markAllAsRead = async () => {
    try {
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      await markAllNotificationsRead();
      showToast(isEnglish ? 'All marked as read' : 'Alle als gelesen markiert');
    } catch (error) {
      console.error('Error marking all as read:', error);
      showToast(isEnglish ? 'Something went wrong.' : 'Etwas ist schiefgelaufen.', 'error');
    }
  };

  const NAVIGABLE_TYPES: string[] = [
    'jobApplication', 'jobApplicationAccepted', 'jobApplicationDeclined',
    'jobAccepted', 'chatUnlocked', 'jobCompleted', 'jobCancelled',
    'jobExtended', 'issueResolved', 'problemReported', 'review', 'preferredBuddyJob',
  ];

  const navigateToJob = async (notification: Notification) => {
    if (!notification.relatedJobId) return;
    await markAsRead(notification.id);
    router.push({
      pathname: '/job/[id]',
      params: { id: String(notification.relatedJobId) },
    });
  };

  const getNotificationTypeLabel = (type: string): string => {
    const key = `notifications.${type}`;
    return i18n.t(key);
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString();
  };

  const handleBack = () => {
    goBackOrReplace(router, '/(tabs)');
  };

  const reviewApplication = async (
    notification: Notification,
    decision: 'accept' | 'decline' | 'wait'
  ) => {
    if (!notification.relatedJobId) return;
    const jobId = String(notification.relatedJobId);

    // Prefer DB-authoritative sources: actorId (actor_id column) or payload.buddyId.
    // Fall back to local job state for backwards compat with local-only notifications.
    const buddyId =
      notification.actorId ??
      (notification.payload?.buddyId as string | undefined) ??
      (notification.relatedUserId) ??
      (() => {
        const matchedJob = applicationJobsById[jobId];
        const app =
          matchedJob?.match?.applications?.find((a) => a.requesterDecision === 'pending') ??
          matchedJob?.match?.applications?.at(-1);
        return app?.buddyId;
      })();

    debugLog(
      `[notifications] reviewApplication: notificationId=${notification.id} type=${notification.type} jobId=${jobId} actorId=${notification.actorId} payloadBuddyId=${notification.payload?.buddyId} resolvedBuddyId=${buddyId} decision=${decision}`
    );

    if (!buddyId) {
      showToast(isEnglish ? 'Applicant not found.' : 'Bewerber nicht gefunden.', 'error');
      return;
    }

    try {
      setReviewingJobId(jobId);
      const result = await updateJobRequest({
        jobId,
        buddyId,
        decision,
        requesterId: getActiveUserId(),
      });
      debugLog(`[notifications] reviewApplication: result updatedJob=${result.updatedJob?.id} status=${result.updatedJob?.status}`);

      // The DB trigger sends jobApplicationAccepted/Declined to the buddy.
      // No local notification needed on the owner side — navigate to chat on
      // accept, show a confirmation toast on decline.
      if (decision === 'decline') {
        showToast(isEnglish ? 'Applicant declined.' : 'Bewerber abgelehnt.');
      }

      if (result.updatedJob) {
        setApplicationJobsById((prev) => ({
          ...prev,
          [jobId]: result.updatedJob as Job,
        }));
      }

      if (decision === 'accept' && buddyId) {
        // Remove the stale "Neue Bewerbung" card for this exact job+buddy immediately.
        await deleteJobApplicationNotification(jobId, buddyId);
      } else {
        await markAsRead(notification.id);
      }
      await loadNotifications();

      if (decision === 'accept') {
        if (!result.rpcSuccess) {
          showToast(
            isEnglish
              ? 'Server error — please try again.'
              : 'Serverfehler – bitte erneut versuchen.',
            'error'
          );
        } else if (result.updatedJob) {
          const j = result.updatedJob;
          router.push({
            pathname: '/chat',
            params: {
              jobId: j.id,
              problem: j.problem ?? '',
              price: j.price ?? '',
              time: j.time ?? '',
              timeMode: j.timeMode ?? 'sofort',
              creatorName: j.creatorName ?? '',
              currentUserRole: 'auftraggeber',
            },
          });
        } else {
          showToast(
            isEnglish
              ? 'Accepted — chat could not be opened.'
              : 'Angenommen – Chat konnte nicht geöffnet werden.',
            'error'
          );
        }
      }
    } catch (error) {
      console.warn('[notifications] reviewApplication error:', error);
      showToast(isEnglish ? 'Action failed. Please try again.' : 'Aktion fehlgeschlagen.', 'error');
    } finally {
      setReviewingJobId(null);
    }
  };

  const openBuddyPreview = async (notification: Notification) => {
    if (!notification.relatedJobId) return;
    const jobId = String(notification.relatedJobId);
    const buddyId =
      notification.actorId ??
      (notification.payload?.buddyId as string | undefined);

    debugLog(
      `[notifications] openBuddyPreview: buddyId=${buddyId} jobId=${jobId} sessionUid=${getActiveUserId()}`
    );

    if (!buddyId) {
      showToast(isEnglish ? 'Profile not available.' : 'Profil nicht verfügbar.', 'error');
      return;
    }

    setBuddyPreview({ data: null, loading: true });
    const preview = await fetchApplicantPreview(jobId, buddyId);
    debugLog(
      `[notifications] openBuddyPreview: result name=${preview?.buddyName} rating=${preview?.buddyRatingAverage} score=${preview?.buddyScore}`
    );
    setBuddyPreview({ data: preview, loading: false });
  };

  const unreadCount = getUnreadNotificationCount(notifications);

  const getApplicationTrustModel = (relatedJobId: string) => {
    const matchedJob = applicationJobsById[String(relatedJobId)];
    const applications = matchedJob?.match?.applications ?? [];
    const application =
      applications.find((a) => a.buddyId === matchedJob?.match?.selectedApplicationId) ??
      applications.find((a) => a.requesterDecision === 'pending') ??
      applications[applications.length - 1];
    if (!application) return null;

    const ratingAverage =
      typeof application.buddyRatingAverage === 'number' && Number.isFinite(application.buddyRatingAverage)
        ? application.buddyRatingAverage
        : null;
    const ratingCount =
      typeof application.buddyRatingCount === 'number' && Number.isFinite(application.buddyRatingCount)
        ? Math.max(0, Math.floor(application.buddyRatingCount))
        : 0;
    const completedJobs =
      typeof application.buddyCompletedJobs === 'number' && Number.isFinite(application.buddyCompletedJobs)
        ? Math.max(0, Math.floor(application.buddyCompletedJobs))
        : 0;

    const fill = getTrustStarFillRatio(ratingAverage, ratingCount);
    const reliability = application.buddyReliability || getReliabilitySignal({
      completedJobs,
      responseRate: application.buddyResponseRate,
    });

    return {
      ratingAverage,
      ratingCount,
      completedJobs,
      reliability,
      fill,
    };
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.headerRow}>
          <Pressable style={styles.backButton} onPress={handleBack}>
            <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <View style={styles.headerActions}>
            {unreadCount > 0 && (
              <Pressable style={styles.markAllButton} onPress={markAllAsRead}>
                <Text style={styles.markAllButtonText}>
                  {i18n.t('notifications.mark_all_read')}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
        <Text style={styles.title}>{i18n.t('notifications.title')}</Text>
        <Text style={styles.subtitle}>
          {unreadCount > 0
            ? i18n.t('notifications.unread_count', { count: unreadCount })
            : i18n.t('notifications.all_read')}
        </Text>
      </View>

      {notifications.length === 0 ? (
        <ScrollView
          style={styles.screen}
          contentContainerStyle={styles.emptyContent}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={[styles.emptyState, { opacity: emptyFade }]}>
            <Ionicons name="notifications-outline" size={40} color="#FF7A55" style={styles.emptyIcon} />
            <Text style={styles.emptyTitle}>
              {i18n.t('notifications.empty_title')}
            </Text>
            <Text style={styles.emptyText}>
              {i18n.t('notifications.empty_state')}
            </Text>
          </Animated.View>
        </ScrollView>
      ) : (
        <ScrollView
          style={styles.screen}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {notifications.map((notification) => {
            const applicationTrust =
              notification.relatedJobId && notification.type === 'jobApplication'
                ? getApplicationTrustModel(String(notification.relatedJobId))
                : null;
            const buddyName = notification.type === 'jobApplication' && notification.relatedJobId
              ? (applicationJobsById[String(notification.relatedJobId)]?.match?.applications?.at(-1))?.buddyName || i18n.t('common.default_user_name')
              : null;
            const presentation = getNotificationPresentation(notification.type);
            const iconColor =
              presentation.tone === 'success' ? colors.green :
              presentation.tone === 'highlight' ? colors.primary :
              presentation.tone === 'message' ? colors.secondary :
              colors.textPrimary;

            const cardAnim = cardAnims.get(notification.id) ?? new Animated.Value(1);

            const isNavigable = notification.type !== 'jobApplication' &&
              Boolean(notification.relatedJobId) &&
              NAVIGABLE_TYPES.includes(notification.type);

            return (
            <Pressable
              key={notification.id}
              onPress={() => { if (isNavigable) navigateToJob(notification); }}
            >
            <Animated.View
              style={[
                styles.card,
                !notification.read ? styles.unreadCard : styles.readCard,
                {
                  opacity: cardAnim,
                  transform: [{ translateY: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
                },
              ]}
            >
              <View style={styles.cardContent}>
                <View style={styles.cardHeader}>
                  <View style={styles.titleRow}>
                    <View
                      style={[
                        styles.typeIconWrap,
                        presentation.tone === 'success' && styles.typeIconSuccess,
                        presentation.tone === 'highlight' && styles.typeIconHighlight,
                        presentation.tone === 'message' && styles.typeIconMessage,
                      ]}
                    >
                      <Ionicons
                        name={presentation.iconName}
                        size={15}
                        color={iconColor}
                      />
                    </View>
                    <Text style={styles.cardTitle}>{notification.title}</Text>
                    {!notification.read && <View style={styles.unreadDot} />}
                  </View>
                  <Text style={styles.cardTime}>
                    {formatDate(notification.createdAt)}
                  </Text>
                </View>
                {notification.type !== 'jobApplication' && (
                  <Text style={styles.cardMessage}>{notification.message}</Text>
                )}
                {notification.type === 'jobApplication' && (
                  <Text style={styles.cardMessage}>{notification.message}</Text>
                )}
                {notification.type === 'jobApplication' && notification.relatedJobId && (applicationJobsById[String(notification.relatedJobId)]?.match?.applications?.length ?? 0) > 0 && (
                  <View style={styles.applicationReviewSection}>
                    <Text style={styles.applicationBuddyAction}>
                      {i18n.t('notifications.requester_review_candidate', { buddy: buddyName ?? '' })}
                    </Text>
                    {applicationTrust && (
                      <View style={styles.applicationTrustRow}>
                        {applicationTrust.ratingAverage !== null ? (
                          <>
                            <View style={styles.trustStarWrap}>
                              <Text style={styles.trustStarBase}>★</Text>
                              <View
                                style={[
                                  styles.trustStarFillClip,
                                  { width: `${Math.max(0, Math.min(1, applicationTrust.fill)) * 100}%` },
                                ]}
                              >
                                <Text style={styles.trustStarFill}>★</Text>
                              </View>
                            </View>
                            <Text style={styles.applicationTrustText}>
                              {i18n.t('notifications.requester_review_rating', {
                                rating: applicationTrust.ratingAverage.toFixed(1),
                                count: applicationTrust.ratingCount,
                              })}
                            </Text>
                          </>
                        ) : (
                          <View style={styles.newBuddyBadge}>
                            <Text style={styles.newBuddyBadgeText}>
                              {i18n.t('notifications.requester_review_rating_empty')}
                            </Text>
                          </View>
                        )}
                        {applicationTrust.completedJobs > 0 && (
                          <View style={styles.applicationTrustChip}>
                            <Text style={styles.applicationTrustChipText}>
                              {i18n.t('notifications.requester_review_completed_jobs', {
                                count: applicationTrust.completedJobs,
                              })}
                            </Text>
                          </View>
                        )}
                        {applicationTrust.reliability !== 'new' && (
                          <View style={styles.applicationTrustChip}>
                            <Text style={styles.applicationTrustChipText}>
                              {i18n.t(`notifications.requester_review_reliability_${applicationTrust.reliability}`)}
                            </Text>
                          </View>
                        )}
                      </View>
                    )}
                    <Text style={styles.reviewSafetyHint}>
                      {i18n.t('notifications.requester_review_safety_hint')}
                    </Text>
                  </View>
                )}
                {notification.type !== 'jobApplication' && (
                  <View style={styles.metaRow}>
                    <Text style={styles.cardType}>
                      {getNotificationTypeLabel(notification.type)}
                    </Text>
                  </View>
                )}
              </View>

              {notification.type === 'jobApplication' && notification.relatedJobId && (
                <View style={styles.requesterReviewActions}>
                  <Pressable
                    style={[styles.reviewActionButton, styles.reviewActionAccept, reviewingJobId === String(notification.relatedJobId) && styles.actionButtonDisabled]}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      reviewApplication(notification, 'accept');
                    }}
                    disabled={reviewingJobId === String(notification.relatedJobId)}
                  >
                    <Text style={styles.reviewActionAcceptText}>{i18n.t('notifications.requester_accept')}</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.reviewActionButton, styles.reviewActionDecline, reviewingJobId === String(notification.relatedJobId) && styles.actionButtonDisabled]}
                    onPress={() => reviewApplication(notification, 'decline')}
                    disabled={reviewingJobId === String(notification.relatedJobId)}
                  >
                    <Text style={styles.reviewActionDeclineText}>{i18n.t('notifications.requester_decline')}</Text>
                  </Pressable>
                </View>
              )}

              <View style={styles.actions}>
                <View style={styles.actionsStart}>
                  {notification.type === 'jobApplication' && notification.relatedJobId && (
                    <Pressable
                      style={styles.utilityAction}
                      onPress={() => openBuddyPreview(notification)}
                    >
                      <Ionicons name="person-outline" size={13} color={colors.textSecondary} />
                      <Text style={styles.utilityActionText} numberOfLines={1}>
                        {i18n.t('notifications.view_profile')}
                      </Text>
                    </Pressable>
                  )}
                  {!notification.read ? (
                    <Pressable
                      style={styles.utilityAction}
                      onPress={() => markAsRead(notification.id)}
                    >
                      <Ionicons name="checkmark-done-outline" size={13} color={colors.secondary} />
                      <Text style={[styles.utilityActionText, styles.utilityActionTextAccent]} numberOfLines={1}>
                        {i18n.t('notifications.mark_as_read')}
                      </Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      style={styles.utilityAction}
                      onPress={() => markAsUnread(notification.id)}
                    >
                      <Ionicons name="mail-unread-outline" size={13} color={colors.textSecondary} />
                      <Text style={styles.utilityActionText} numberOfLines={1}>
                        {i18n.t('notifications.mark_as_unread')}
                      </Text>
                    </Pressable>
                  )}
                </View>
                <Pressable
                  style={styles.utilityActionDelete}
                  onPress={() => deleteNotification(notification.id)}
                >
                  <Ionicons name="trash-outline" size={13} color={colors.red} />
                  <Text style={[styles.utilityActionText, styles.utilityActionTextDelete]} numberOfLines={1}>
                    {i18n.t('notifications.delete')}
                  </Text>
                </Pressable>
              </View>
            </Animated.View>
            </Pressable>
            );
          })}
        </ScrollView>
      )}

      {toast && (
        <View
          style={[
            styles.toast,
            toast.variant === 'error' && styles.toastError,
            { bottom: insets.bottom + spacing.xxl },
          ]}
          pointerEvents="none"
        >
          <Text style={styles.toastText}>{toast.message}</Text>
        </View>
      )}

      <Modal
        visible={buddyPreview !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setBuddyPreview(null)}
      >
        <Pressable style={styles.previewOverlay} onPress={() => setBuddyPreview(null)}>
          <Pressable style={[styles.previewSheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.previewHandle} />
            <Text style={styles.previewTitle}>{i18n.t('notifications.buddy_preview_title')}</Text>

            {buddyPreview?.loading ? (
              <ActivityIndicator color={colors.secondary} style={{ marginVertical: spacing.xl }} />
            ) : buddyPreview?.data ? (
              <View style={styles.previewBody}>
                {buddyPreview.data.avatarUrl ? (
                  <Image source={{ uri: buddyPreview.data.avatarUrl }} style={styles.previewAvatar} />
                ) : (
                  <View style={[styles.previewAvatar, styles.previewAvatarPlaceholder]} />
                )}
                <Text style={styles.previewName}>{buddyPreview.data.buddyName || '—'}</Text>

                <View style={styles.previewRow}>
                  {buddyPreview.data.buddyRatingAverage !== null && buddyPreview.data.buddyRatingAverage !== undefined ? (
                    <Text style={styles.previewMeta}>
                      {'⭐ ' + i18n.t('notifications.buddy_preview_rating', {
                        rating: buddyPreview.data.buddyRatingAverage.toFixed(1),
                        count: buddyPreview.data.buddyRatingCount ?? 0,
                      })}
                    </Text>
                  ) : (
                    <Text style={styles.previewMeta}>{i18n.t('notifications.buddy_preview_no_rating')}</Text>
                  )}
                </View>

                {(buddyPreview.data.buddyCompletedJobs ?? 0) > 0 && (
                  <Text style={styles.previewMeta}>
                    {i18n.t('notifications.buddy_preview_jobs', { count: buddyPreview.data.buddyCompletedJobs ?? 0 })}
                  </Text>
                )}

                {buddyPreview.data.buddyReliability && (
                  <View style={styles.previewChip}>
                    <Text style={styles.previewChipText}>
                      {i18n.t(`notifications.buddy_preview_level_${buddyPreview.data.buddyReliability}`)}
                    </Text>
                  </View>
                )}

                {buddyPreview.data.buddyScore !== null && buddyPreview.data.buddyScore !== undefined && (
                  <Text style={styles.previewMeta}>
                    {i18n.t('notifications.buddy_preview_score', { score: buddyPreview.data.buddyScore })}
                  </Text>
                )}
              </View>
            ) : (
              <Text style={[styles.previewMeta, { textAlign: 'center', marginVertical: spacing.xl }]}>
                {i18n.t('notifications.buddy_preview_no_rating')}
              </Text>
            )}

            <Pressable style={styles.previewClose} onPress={() => setBuddyPreview(null)}>
              <Text style={styles.previewCloseText}>{i18n.t('notifications.buddy_preview_close')}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: layout.screenPaddingX,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.veryLightGrey2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    ...typography.screenTitle,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.meta,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    lineHeight: 18,
  },
  markAllButton: {
    backgroundColor: colors.veryLightGrey,
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.lightBorder,
  },
  markAllButtonText: {
    ...typography.meta,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: layout.screenPaddingX,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  emptyContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: layout.screenPaddingX,
  },
  emptyState: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.xxxl,
    paddingHorizontal: layout.screenPaddingX,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyTitle: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    fontWeight: '700',
    marginBottom: spacing.sm,
    letterSpacing: -0.2,
  },
  emptyIcon: {
    marginBottom: spacing.lg,
  },
  emptyText: {
    ...typography.meta,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 220,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    padding: spacing.lg,
    marginBottom: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  unreadCard: {
    backgroundColor: '#FDFCFF',
    borderLeftWidth: 4,
    borderLeftColor: colors.secondary,
    shadowOpacity: 0.10,
  },
  readCard: {
    backgroundColor: colors.card,
  },
  cardContent: {
    marginBottom: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  typeIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.lightGreyVariant,
  },
  typeIconSuccess: {
    backgroundColor: '#DCFCE7',
  },
  typeIconHighlight: {
    backgroundColor: '#FFD4C8',
  },
  typeIconMessage: {
    backgroundColor: colors.lightPurple,
  },
  cardTitle: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    flex: 1,
  },
  unreadDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.secondary,
    shadowColor: colors.secondary,
    shadowOpacity: 0.45,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 0 },
  },
  cardMessage: {
    ...typography.body,
    color: colors.mediumDarkGrey,
    marginBottom: spacing.sm,
    lineHeight: 21,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginTop: spacing.xs,
  },
  applicationReviewSection: {
    marginBottom: spacing.sm,
  },
  applicationBuddyAction: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  reviewSafetyHint: {
    ...typography.meta,
    color: colors.placeholder,
    marginTop: spacing.sm,
    lineHeight: 18,
  },
  newBuddyBadge: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    backgroundColor: colors.veryLightGrey,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  newBuddyBadgeText: {
    ...typography.meta,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  applicationTrustRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  trustStarWrap: {
    width: 15,
    height: 15,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  trustStarBase: {
    ...typography.meta,
    color: colors.lightBorder,
    lineHeight: 14,
  },
  trustStarFillClip: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  trustStarFill: {
    ...typography.meta,
    color: colors.yellow,
    lineHeight: 14,
  },
  applicationTrustText: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  applicationTrustChip: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.lightGreyVariant,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  applicationTrustChipText: {
    ...typography.meta,
    color: colors.mediumDarkGrey,
    lineHeight: 16,
  },
  requesterReviewActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.veryLightGrey2,
    paddingTop: spacing.md,
  },
  reviewActionButton: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewActionAccept: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary,
  },
  reviewActionDecline: {
    backgroundColor: colors.card,
    borderColor: colors.border,
  },
  reviewActionAcceptText: {
    ...typography.metaStrong,
    color: colors.card,
  },
  reviewActionDeclineText: {
    ...typography.metaStrong,
    color: colors.textSecondary,
  },
  reviewActionWaitText: {
    ...typography.metaStrong,
    color: colors.textSecondary,
  },
  actionButtonDisabled: {
    opacity: 0.45,
  },
  cardTime: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  cardType: {
    ...typography.meta,
    color: colors.placeholder,
    backgroundColor: colors.veryLightGrey,
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.veryLightGrey2,
  },
  actionsStart: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
    flexWrap: 'wrap',
  },
  utilityAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  utilityActionDelete: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingLeft: spacing.sm,
  },
  utilityActionText: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  utilityActionTextAccent: {
    color: colors.secondary,
    fontWeight: '600',
  },
  utilityActionTextDelete: {
    color: colors.red,
    fontWeight: '600',
  },
  toast: {
    position: 'absolute',
    left: layout.screenPaddingX,
    right: layout.screenPaddingX,
    backgroundColor: colors.green,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  toastError: {
    backgroundColor: colors.red,
  },
  toastText: {
    ...typography.metaStrong,
    color: colors.card,
    textAlign: 'center',
  },
  previewOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  previewSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: spacing.sm,
    paddingHorizontal: layout.screenPaddingX,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  previewHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.lightBorder,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  previewTitle: {
    ...typography.sectionTitle,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
    textAlign: 'center',
  },
  previewBody: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
    alignItems: 'flex-start',
  },
  previewName: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 18,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  previewMeta: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  previewChip: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.veryLightGrey,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  previewChipText: {
    ...typography.meta,
    color: colors.mediumDarkGrey,
  },
  previewClose: {
    backgroundColor: colors.veryLightGrey,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  previewCloseText: {
    ...typography.metaStrong,
    color: colors.textPrimary,
  },
  previewAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  previewAvatarPlaceholder: {
    backgroundColor: colors.veryLightGrey2,
  },
});
