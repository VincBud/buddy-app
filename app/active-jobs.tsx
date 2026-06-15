import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../lib/colors';
import i18n, { useLanguage } from '../lib/i18n';
import { completeJob as completeJobAction, isJobChatAccessible } from '../lib/job-actions';
import { getBuddyPointsForJob, isActiveJobStatus, Job } from '../lib/jobs';
import { loadJobs as loadJobsService } from '../services/jobs.service';
import { getBuddyScore, setBuddyScore } from '../services/user.service';
import { goBackOrReplace } from '../lib/navigation';
import { layout, spacing } from '../lib/spacing';
import { typography } from '../lib/typography';
import { recordJobCompletionEarning } from '../lib/wallet';
import { getActiveUserId } from '../lib/auth';
import { incrementReliabilityStats } from '../services/user.service';

type Tab = 'now' | 'scheduled';

const hasRawRangePlaceholder = (value: string): boolean => {
  return /\{\s*range\s*\}|%\{\s*range\s*\}/i.test(value);
};

const cleanFlexibleRangeValue = (value: string): string => {
  return value
    .replace(/\{\s*range\s*\}|%\{\s*range\s*\}/gi, '')
    .replace(/^\s*(flexibel|flexible)\s*:?\s*/i, '')
    .trim();
};

const getCategoryIcon = (category: string): string => {
  if (category === 'transport') return '🚗';
  if (category === 'handyman') return '🔧';
  if (category === 'household') return '🧹';
  if (category === 'tech') return '💻';
  if (category === 'errands') return '🛒';
  return '🧩';
};

const getActiveJobTimingLabel = (job: Job): string => {
  const mode = String(job.timeMode || '').toLowerCase();
  const rawTime = String(job.time || '').trim();

  if (mode === 'flexibel' || mode === 'flexible') {
    const cleanedRange = cleanFlexibleRangeValue(rawTime || String(job.flexibleRange || ''));
    if (cleanedRange && !hasRawRangePlaceholder(cleanedRange)) {
      return cleanedRange;
    }
    return i18n.t('feed.badges.flexible');
  }

  if (rawTime && !hasRawRangePlaceholder(rawTime)) {
    return rawTime;
  }

  if (mode === 'sofort') return i18n.t('feed.badges.now');
  if (mode === 'termin' || mode === 'scheduled') return i18n.t('feed.badges.scheduled');
  return i18n.t('common.time_open');
};

export default function ActiveJobsScreen() {
  useLanguage();
  const isEnglish = String(i18n.locale).toLowerCase().startsWith('en');
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<Tab>('now');
  const [acceptedJobs, setAcceptedJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (toast) {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 2500);
    }
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [toast]);

  const showToast = (message: string, variant: 'success' | 'error' = 'success') => {
    setToast({ message, variant });
  };

  const loadJobs = useCallback(async () => {
    try {
      setIsLoading(true);
      const jobs = await loadJobsService();
      const userId = getActiveUserId();
      const filtered = jobs.filter(
        (j) =>
          isActiveJobStatus(j.status) &&
          // requesterId: owner's own active jobs
          // match.selectedApplicationId: local-only buddy match (owner device set it)
          // assignedBuddyId: server-backed buddy match (set by review_job_application RPC)
          (j.requesterId === userId ||
           j.match?.selectedApplicationId === userId ||
           j.assignedBuddyId === userId)
      );
      setAcceptedJobs(filtered);
    } catch {
      setAcceptedJobs([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadJobs();
    }, [loadJobs])
  );

  const handleBack = () => {
    goBackOrReplace(router, '/(tabs)/profile');
  };

  const openChat = (job: Job) => {
    if (!isJobChatAccessible(job)) {
      return;
    }
    const userId = getActiveUserId();
    const role = job.requesterId === userId ? 'auftraggeber' : 'buddy';
    router.push({
      pathname: '/chat',
      params: {
        jobId: job.id,
        problem: job.problem,
        price: job.price,
        time: job.time,
        timeMode: job.timeMode,
        creatorName: job.creatorName || i18n.t('common.default_user_name'),
        currentUserRole: role,
      },
    });
  };

  const completeJob = async (job: Job) => {
    try {
      await completeJobAction({ jobId: job.id, completedByRole: 'buddy' });
      const currentScore = await getBuddyScore();
      await setBuddyScore(currentScore + getBuddyPointsForJob(job));
      await recordJobCompletionEarning(job);
      await incrementReliabilityStats(getActiveUserId(), 'completedJobs');
      if (job.requesterId) {
        await incrementReliabilityStats(job.requesterId, 'completedJobs');
      }
      router.push({
        pathname: '/review/[jobId]',
        params: {
          jobId: job.id,
          currentUserRole: 'buddy',
        },
      });
    } catch {
      showToast(isEnglish ? 'Could not complete job. Please try again.' : 'Abschluss fehlgeschlagen. Bitte erneut versuchen.', 'error');
    }
  };

  const nowJobs = acceptedJobs.filter(
    (j) =>
      !j.timeMode ||
      j.timeMode === 'sofort' ||
      (j.timeMode === 'flexibel' && !j.appointmentDate)
  );
  const scheduledJobs = acceptedJobs.filter(
    (j) => j.timeMode === 'termin' || (j.timeMode === 'flexibel' && !!j.appointmentDate)
  );

  const currentJobs = activeTab === 'now' ? nowJobs : scheduledJobs;
  const emptyKey =
    activeTab === 'now' ? 'profile.no_now_jobs' : 'profile.no_scheduled_jobs';

  const renderJobCard = (job: Job) => {
    const category = job.category ?? 'other';
    return (
      <View key={job.id} style={styles.jobCard}>
        <View style={styles.categoryTopRow}>
          <View style={styles.categoryChip}>
            <Text style={styles.categoryChipText}>
              {getCategoryIcon(category)} {i18n.t(`preferences.categories.${category}`)}
            </Text>
          </View>
        </View>

        <View style={styles.jobTopRow}>
          <Text style={styles.jobProblem} numberOfLines={2}>
            {job.problem}
          </Text>
          <View style={styles.pricePill}>
            <Text style={styles.priceText}>{job.price}€</Text>
          </View>
        </View>

        <View style={styles.jobMetaRow}>
          {activeTab === 'scheduled' && job.appointmentDate ? (
            <View style={styles.metaChip}>
              <Text style={styles.metaChipText}>
                {i18n.t('profile.scheduled_on', {
                  date: job.appointmentDate,
                  time: job.appointmentTime ?? '',
                })}
              </Text>
            </View>
          ) : (
            <View style={styles.metaChip}>
              <Text style={styles.metaChipText}>{getActiveJobTimingLabel(job)}</Text>
            </View>
          )}

          {job.status === 'issue_reported' && (
            <View style={styles.issueChip}>
              <Text style={styles.issueChipText}>
                {i18n.t('job.status_issue', { defaultValue: 'Problem gemeldet' })}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.jobActions}>
          <Pressable
            style={styles.chatButton}
            onPress={() => openChat(job)}
          >
            <Text style={styles.chatButtonText}>
              {i18n.t('profile.open_chat')}
            </Text>
          </Pressable>
          {job.status !== 'issue_reported' && (
            <Pressable
              style={styles.completeButton}
              onPress={() => completeJob(job)}
            >
              <Text style={styles.completeButtonText}>
                {i18n.t('common.done')}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  };

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top },
      ]}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={handleBack}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>
          {i18n.t('profile.active_jobs_section')}
        </Text>
        <View style={styles.headerRight} />
      </View>

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        <Pressable
          style={[styles.tab, activeTab === 'now' && styles.tabActive]}
          onPress={() => setActiveTab('now')}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'now' && styles.tabTextActive,
            ]}
          >
            {i18n.t('profile.tab_now')}
          </Text>
          {nowJobs.length > 0 && (
            <View
              style={[
                styles.tabBadge,
                activeTab === 'now' && styles.tabBadgeActive,
              ]}
            >
              <Text
                style={[
                  styles.tabBadgeText,
                  activeTab === 'now' && styles.tabBadgeTextActive,
                ]}
              >
                {nowJobs.length}
              </Text>
            </View>
          )}
        </Pressable>

        <Pressable
          style={[styles.tab, activeTab === 'scheduled' && styles.tabActive]}
          onPress={() => setActiveTab('scheduled')}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'scheduled' && styles.tabTextActive,
            ]}
          >
            {i18n.t('profile.tab_scheduled')}
          </Text>
          {scheduledJobs.length > 0 && (
            <View
              style={[
                styles.tabBadge,
                activeTab === 'scheduled' && styles.tabBadgeActive,
              ]}
            >
              <Text
                style={[
                  styles.tabBadgeText,
                  activeTab === 'scheduled' && styles.tabBadgeTextActive,
                ]}
              >
                {scheduledJobs.length}
              </Text>
            </View>
          )}
        </Pressable>
      </View>

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

      {/* Content */}
      <ScrollView
        key={activeTab}
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <Text style={styles.loadingText}>{i18n.t('common.loading_job')}</Text>
          </View>
        ) : currentJobs.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons
              name={activeTab === 'now' ? 'flash-outline' : 'calendar-outline'}
              size={36}
              color={colors.secondary}
              style={styles.emptyIcon}
            />
            <Text style={styles.emptyText}>{i18n.t(emptyKey)}</Text>
            <Text style={styles.emptyHint}>
              {activeTab === 'now'
                ? (isEnglish ? 'Browse the feed and apply for open jobs near you.' : 'Schau im Feed vorbei und bewirb dich auf offene Jobs in deiner Nähe.')
                : (isEnglish ? 'Jobs with a fixed appointment appear here once you are hired.' : 'Terminbasierte Jobs erscheinen hier, sobald du ausgewählt wurdest.')}
            </Text>
          </View>
        ) : (
          currentJobs.map(renderJobCard)
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.screenPaddingX,
    paddingVertical: spacing.md,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.lightGrey,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -spacing.sm,
  },
  backIcon: {
    fontSize: 32,
    lineHeight: 36,
    color: colors.textPrimary,
    fontWeight: '400',
  },
  headerTitle: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'center',
  },
  headerRight: {
    width: 40,
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: layout.screenPaddingX,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    backgroundColor: colors.background,
    gap: spacing.sm,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: layout.borderRadiusSmall,
    backgroundColor: colors.lightGrey,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary,
  },
  tabText: {
    ...typography.metaStrong,
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: colors.card,
  },
  tabBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: colors.veryLightPurple,
    borderWidth: 1,
    borderColor: colors.overlayLightPurple,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  tabBadgeActive: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderColor: 'rgba(255,255,255,0.3)',
  },
  tabBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.secondary,
    lineHeight: 14,
  },
  tabBadgeTextActive: {
    color: colors.card,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: layout.screenPaddingX,
    paddingTop: spacing.lg,
    gap: spacing.lg,
  },
  loadingContainer: {
    marginTop: spacing.xxxl,
    alignItems: 'center',
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  emptyState: {
    marginTop: spacing.xxxl,
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    paddingVertical: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyIcon: {
    marginBottom: spacing.md,
  },
  emptyText: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  emptyHint: {
    ...typography.meta,
    color: colors.placeholder,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: spacing.sm,
  },
  jobCard: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  categoryTopRow: {
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  categoryChip: {
    backgroundColor: colors.veryLightPurple,
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.overlayLightPurple,
  },
  categoryChipText: {
    color: colors.secondary,
    ...typography.metaStrong,
  },
  jobTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  jobProblem: {
    color: colors.textPrimary,
    fontSize: 21,
    fontWeight: '800',
    lineHeight: 28,
    flex: 1,
  },
  pricePill: {
    backgroundColor: colors.lightOrange,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FFD4C7',
    minWidth: 94,
  },
  priceText: {
    color: colors.primary,
    fontSize: 22,
    fontWeight: '800',
  },
  jobMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  metaChip: {
    backgroundColor: colors.veryLightGrey,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metaChipText: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  issueChip: {
    backgroundColor: '#FFF7ED',
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: '#FFEDD5',
  },
  issueChipText: {
    ...typography.meta,
    color: colors.primary,
    fontWeight: '600',
  },
  jobActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chatButton: {
    flex: 1,
    backgroundColor: colors.secondary,
    borderRadius: 10,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  chatButtonText: {
    ...typography.buttonSecondary,
    color: colors.card,
  },
  completeButton: {
    flex: 1,
    backgroundColor: colors.alternateGreen,
    borderRadius: 10,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  completeButtonText: {
    ...typography.buttonSecondary,
    color: colors.card,
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
});
