import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../lib/colors';
import i18n, { useLanguage } from '../lib/i18n';
import { reviewJobApplication } from '../lib/job-actions';
import { Job } from '../lib/jobs';
import { goBackOrReplace } from '../lib/navigation';
import {
    createNotification,
    getEnabledNotificationPreferenceCount,
    getNotificationPresentation,
    getUnreadNotificationCount,
    loadNotificationPreferences,
    loadNotificationsFromStorage,
    Notification,
    NotificationPreferences,
    saveNotificationsToStorage,
} from '../lib/notifications';
import { layout, spacing } from '../lib/spacing';
import { getReliabilitySignal, getTrustStarFillRatio } from '../lib/trust';
import { typography } from '../lib/typography';

export default function NotificationsScreen() {
  const language = useLanguage();
  const isEnglish = language === 'en';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [reviewingJobId, setReviewingJobId] = useState<string | null>(null);
  const [applicationJobsById, setApplicationJobsById] = useState<Record<string, Job>>({});

  const loadNotifications = useCallback(async () => {
    try {
      const loaded = await loadNotificationsFromStorage();
      setNotifications(loaded);

      const relatedJobIds = loaded
        .filter(
          (entry) =>
            entry.type === 'jobApplication' &&
            typeof entry.relatedJobId === 'string' &&
            entry.relatedJobId.trim().length > 0
        )
        .map((entry) => String(entry.relatedJobId));

      if (relatedJobIds.length === 0) {
        setApplicationJobsById({});
        return;
      }

      const jobsRaw = await AsyncStorage.getItem('jobs');
      const parsedJobs = jobsRaw ? JSON.parse(jobsRaw) : [];
      const safeJobs: Job[] = Array.isArray(parsedJobs) ? parsedJobs : [];

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

  const loadPreferences = useCallback(async () => {
    try {
      const prefs = await loadNotificationPreferences();
      setPreferences(prefs);
    } catch {
      // non-fatal, omit summary
    }
  }, []);

  // Load on focus
  useFocusEffect(
    useCallback(() => {
      loadNotifications();
      loadPreferences();
    }, [loadNotifications, loadPreferences])
  );

  const markAsRead = async (id: string) => {
    try {
      const updated = notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      );
      setNotifications(updated);
      await saveNotificationsToStorage(updated);
    } catch (error) {
      console.error('Error marking as read:', error);
    }
  };

  const markAsUnread = async (id: string) => {
    try {
      const updated = notifications.map((n) =>
        n.id === id ? { ...n, read: false } : n
      );
      setNotifications(updated);
      await saveNotificationsToStorage(updated);
    } catch (error) {
      console.error('Error marking as unread:', error);
    }
  };

  const deleteNotification = async (id: string) => {
    try {
      const updated = notifications.filter((n) => n.id !== id);
      setNotifications(updated);
      await saveNotificationsToStorage(updated);
    } catch (error) {
      console.error('Error deleting notification:', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      const updated = notifications.map((n) => ({ ...n, read: true }));
      setNotifications(updated);
      await saveNotificationsToStorage(updated);
    } catch (error) {
      console.error('Error marking all as read:', error);
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

    const matchedJob = applicationJobsById[jobId];
    const pendingApplication =
      matchedJob?.match?.applications?.find((a) => a.requesterDecision === 'pending') ??
      matchedJob?.match?.applications?.at(-1);
    const buddyId = pendingApplication?.buddyId;
    if (!buddyId) return;

    try {
      setReviewingJobId(jobId);
      const result = await reviewJobApplication({
        jobId,
        buddyId,
        decision,
        requesterId: 'requester_local',
      });

      if (decision === 'accept' || decision === 'decline') {
        const type =
          decision === 'accept' ? 'jobApplicationAccepted' : 'jobApplicationDeclined';
        const title =
          decision === 'accept'
            ? i18n.t('notifications.job_application_accepted_title')
            : i18n.t('notifications.job_application_declined_title');
        const message =
          decision === 'accept'
            ? i18n.t('notifications.job_application_accepted_message')
            : i18n.t('notifications.job_application_declined_message');

        const created = createNotification(type, title, message, jobId);
        const withUpdate = [created, ...notifications];
        setNotifications(withUpdate);
        await saveNotificationsToStorage(withUpdate);
      }

      if (result.updatedJob) {
        setApplicationJobsById((prev) => ({
          ...prev,
          [jobId]: result.updatedJob as Job,
        }));
      }

      await markAsRead(notification.id);
      await loadNotifications();
    } catch (error) {
      console.error('Error reviewing application:', error);
    } finally {
      setReviewingJobId(null);
    }
  };

  const unreadCount = getUnreadNotificationCount(notifications);
  const enabledCount = preferences ? getEnabledNotificationPreferenceCount(preferences) : null;
  const totalCount = 5;

  const getPreferencesSummary = (): string => {
    if (enabledCount === null) return '';
    if (enabledCount === totalCount) return i18n.t('notifications.center_preferences_summary_all');
    if (enabledCount === 0) return i18n.t('notifications.center_preferences_summary_none');
    return i18n.t('notifications.center_preferences_summary_partial', { count: enabledCount, total: totalCount });
  };

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
            <Pressable
              style={styles.settingsButton}
              onPress={() => router.push('/notifications-settings')}
            >
              <Ionicons name="options-outline" size={18} color={colors.textPrimary} />
            </Pressable>
          </View>
        </View>
        <Text style={styles.title}>{i18n.t('notifications.title')}</Text>
        <Text style={styles.subtitle}>
          {unreadCount > 0
            ? i18n.t('notifications.unread_count', { count: unreadCount })
            : i18n.t('notifications.all_read')}
        </Text>
        {enabledCount !== null && (
          <Pressable
            style={styles.preferencesBanner}
            onPress={() => router.push('/notifications-settings')}
          >
            <Ionicons name="notifications-outline" size={13} color={colors.textSecondary} />
            <Text style={styles.preferencesBannerText}>{getPreferencesSummary()}</Text>
            <Ionicons name="chevron-forward" size={13} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>

      {notifications.length === 0 ? (
        <ScrollView
          style={styles.screen}
          contentContainerStyle={styles.emptyContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.emptyState}>
            <Ionicons name="notifications-off-outline" size={32} color={colors.textSecondary} style={styles.emptyIcon} />
            <Text style={styles.emptyTitle}>
              {i18n.t('notifications.empty_title')}
            </Text>
            <Text style={styles.emptyText}>
              {i18n.t('notifications.empty_state')}
            </Text>
            <Pressable
              style={styles.emptyCta}
              onPress={() => router.push('/notifications-settings')}
            >
              <Ionicons name="settings-outline" size={14} color={colors.textPrimary} />
              <Text style={styles.emptyCtaText}>
                {i18n.t('notifications.empty_cta')}
              </Text>
            </Pressable>
          </View>
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

            return (
            <View
              key={notification.id}
              style={[styles.card, !notification.read ? styles.unreadCard : styles.readCard]}
            >
              <View style={styles.cardContent}>
                <View style={styles.cardHeader}>
                  <View style={styles.titleRow}>
                    <View
                      style={[
                        styles.typeIconWrap,
                        getNotificationPresentation(notification.type).tone === 'success' && styles.typeIconSuccess,
                        getNotificationPresentation(notification.type).tone === 'highlight' && styles.typeIconHighlight,
                        getNotificationPresentation(notification.type).tone === 'message' && styles.typeIconMessage,
                      ]}
                    >
                      <Ionicons
                        name={getNotificationPresentation(notification.type).iconName}
                        size={14}
                        color={colors.textPrimary}
                      />
                    </View>
                    <Text style={styles.cardTitle}>{notification.title}</Text>
                    {!notification.read && <View style={styles.unreadDot} />}
                  </View>
                  <Text style={styles.cardTime}>
                    {formatDate(notification.createdAt)}
                  </Text>
                </View>
                <Text style={styles.cardMessage}>{notification.message}</Text>
                {notification.type === 'jobApplication' && notification.relatedJobId && (applicationJobsById[String(notification.relatedJobId)]?.match?.applications?.length ?? 0) > 0 && (
                  <View style={styles.applicationMetaRow}>
                    <Text style={styles.applicationMetaText}>
                      {i18n.t('notifications.requester_review_candidate', {
                        buddy: (applicationJobsById[String(notification.relatedJobId)]?.match?.applications?.at(-1))?.buddyName || i18n.t('common.default_user_name'),
                        score: (applicationJobsById[String(notification.relatedJobId)]?.match?.applications?.at(-1))?.buddyScore ?? 0,
                        jobs: (applicationJobsById[String(notification.relatedJobId)]?.match?.applications?.at(-1))?.buddyCompletedJobs ?? 0,
                      })}
                    </Text>
                    {applicationTrust && (
                      <View style={styles.applicationTrustRow}>
                        <View style={styles.trustStarWrap}>
                          <Text style={styles.trustStarBase}>★</Text>
                          <View
                            style={[
                              styles.trustStarFillClip,
                              {
                                width: `${
                                  Math.max(0, Math.min(1, applicationTrust.fill)) * 100
                                }%`,
                              },
                            ]}
                          >
                            <Text style={styles.trustStarFill}>★</Text>
                          </View>
                        </View>

                        <Text style={styles.applicationTrustText}>
                          {applicationTrust.ratingAverage !== null
                            ? i18n.t('notifications.requester_review_rating', {
                                rating: applicationTrust.ratingAverage.toFixed(1),
                                count: applicationTrust.ratingCount,
                              })
                            : i18n.t('notifications.requester_review_rating_empty')}
                        </Text>

                        <View style={styles.applicationTrustChip}>
                          <Text style={styles.applicationTrustChipText}>
                            {i18n.t('notifications.requester_review_completed_jobs', {
                              count: applicationTrust.completedJobs,
                            })}
                          </Text>
                        </View>

                        <View style={styles.applicationTrustChip}>
                          <Text style={styles.applicationTrustChipText}>
                            {i18n.t(`notifications.requester_review_reliability_${applicationTrust.reliability}`)}
                          </Text>
                        </View>
                      </View>
                    )}
                  </View>
                )}
                <View style={styles.metaRow}>
                  <Text style={styles.cardType}>
                    {getNotificationTypeLabel(notification.type)}
                  </Text>
                </View>
              </View>

              {notification.type === 'jobApplication' && notification.relatedJobId && (
                <View style={styles.requesterReviewActions}>
                  <Pressable
                    style={[styles.reviewActionButton, styles.reviewActionAccept, reviewingJobId === String(notification.relatedJobId) && styles.actionButtonDisabled]}
                    onPress={() => reviewApplication(notification, 'accept')}
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
                  <Pressable
                    style={[styles.reviewActionButton, reviewingJobId === String(notification.relatedJobId) && styles.actionButtonDisabled]}
                    onPress={() => reviewApplication(notification, 'wait')}
                    disabled={reviewingJobId === String(notification.relatedJobId)}
                  >
                    <Text style={styles.reviewActionWaitText}>{i18n.t('notifications.requester_wait')}</Text>
                  </Pressable>
                </View>
              )}

              <View style={styles.actions}>
                {notification.relatedJobId && NAVIGABLE_TYPES.includes(notification.type) && (
                  <Pressable
                    style={[styles.actionButton, styles.viewButton]}
                    onPress={() => navigateToJob(notification)}
                  >
                    <Ionicons name="arrow-forward-outline" size={14} color={colors.textPrimary} />
                    <Text style={styles.viewButtonText} numberOfLines={1}>
                      {isEnglish ? 'View' : 'Ansehen'}
                    </Text>
                  </Pressable>
                )}
                {!notification.read ? (
                  <Pressable
                    style={[styles.actionButton, styles.actionPrimaryButton]}
                    onPress={() => markAsRead(notification.id)}
                  >
                    <Ionicons name="checkmark-done-outline" size={14} color={colors.secondary} />
                    <Text style={styles.actionText} numberOfLines={1}>
                      {i18n.t('notifications.mark_as_read')}
                    </Text>
                  </Pressable>
                ) : (
                  <Pressable
                    style={[styles.actionButton, styles.actionPrimaryButton, styles.secondaryButton]}
                    onPress={() => markAsUnread(notification.id)}
                  >
                    <Ionicons name="mail-unread-outline" size={14} color={colors.secondary} />
                    <Text style={[styles.actionText, styles.secondaryText]} numberOfLines={1}>
                      {i18n.t('notifications.mark_as_unread')}
                    </Text>
                  </Pressable>
                )}

                <Pressable
                  style={[styles.actionButton, styles.deleteButton]}
                  onPress={() => deleteNotification(notification.id)}
                >
                  <Ionicons name="trash-outline" size={14} color={colors.primary} />
                  <Text style={[styles.deleteActionText, styles.deleteText]} numberOfLines={1}>
                    {i18n.t('notifications.delete')}
                  </Text>
                </Pressable>
              </View>
            </View>
            );
          })}
        </ScrollView>
      )}
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
  settingsButton: {
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
  preferencesBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.veryLightGrey,
    borderRadius: layout.borderRadiusSmall,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: 'flex-start',
  },
  preferencesBannerText: {
    ...typography.meta,
    color: colors.textSecondary,
    flex: 1,
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
    padding: layout.screenPaddingX,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyTitle: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  emptyIcon: {
    marginBottom: spacing.sm,
    opacity: 0.5,
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.veryLightGrey,
    borderRadius: layout.borderRadiusMedium,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyCtaText: {
    ...typography.meta,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    padding: layout.cardPadding,
    marginBottom: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
    borderWidth: 1,
    borderColor: colors.veryLightGrey2,
  },
  unreadCard: {
    backgroundColor: colors.card,
    borderLeftWidth: 3,
    borderLeftColor: colors.secondary,
    shadowOpacity: 0.08,
  },
  readCard: {
    opacity: 0.92,
    backgroundColor: colors.veryLightGrey,
  },
  cardContent: {
    marginBottom: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  typeIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.veryLightGrey,
  },
  typeIconSuccess: {
    backgroundColor: colors.lightGreen,
  },
  typeIconHighlight: {
    backgroundColor: colors.lightOrange,
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
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.secondary,
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
  },
  applicationMetaRow: {
    marginBottom: spacing.xs,
  },
  applicationMetaText: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  applicationTrustRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
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
    color: colors.secondary,
    lineHeight: 14,
  },
  applicationTrustText: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  applicationTrustChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    backgroundColor: colors.veryLightGrey,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  applicationTrustChipText: {
    ...typography.meta,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  requesterReviewActions: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  reviewActionButton: {
    minHeight: 32,
    borderRadius: layout.borderRadiusSmall,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewActionAccept: {
    backgroundColor: colors.lightGreen,
    borderColor: colors.lightGreen,
  },
  reviewActionDecline: {
    backgroundColor: colors.lightOrange,
    borderColor: colors.lightOrange,
  },
  reviewActionAcceptText: {
    ...typography.metaStrong,
    color: colors.textPrimary,
  },
  reviewActionDeclineText: {
    ...typography.metaStrong,
    color: colors.textPrimary,
  },
  reviewActionWaitText: {
    ...typography.meta,
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
    color: colors.iosShadow,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.veryLightGrey2,
  },
  actionButton: {
    borderRadius: layout.borderRadiusMedium,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 34,
  },
  actionPrimaryButton: {
    backgroundColor: 'transparent',
  },
  actionText: {
    color: colors.secondary,
    ...typography.meta,
    textAlign: 'center',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
  },
  secondaryText: {
    color: colors.secondary,
  },
  deleteButton: {
    backgroundColor: 'transparent',
    paddingHorizontal: spacing.sm,
  },
  deleteActionText: {
    ...typography.meta,
    textAlign: 'center',
  },
  deleteText: {
    color: colors.primary,
  },
  viewButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.borderRadiusMedium,
    paddingHorizontal: spacing.sm,
  },
  viewButtonText: {
    ...typography.meta,
    color: colors.textPrimary,
    fontWeight: '600',
  },
});
