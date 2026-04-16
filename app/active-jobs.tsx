import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../lib/colors';
import i18n, { useLanguage } from '../lib/i18n';
import { isJobChatAccessible } from '../lib/job-actions';
import { getBuddyPointsForJob, isActiveJobStatus, Job } from '../lib/jobs';
import { goBackOrReplace } from '../lib/navigation';
import { applyPaymentStateForJobStatus, ensureJobPaymentState } from '../lib/payments';
import { layout, spacing } from '../lib/spacing';
import { typography } from '../lib/typography';
import { recordJobCompletionEarning } from '../lib/wallet';

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
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<Tab>('now');
  const [acceptedJobs, setAcceptedJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadJobs = useCallback(async () => {
    try {
      setIsLoading(true);
      const jobsRaw = await AsyncStorage.getItem('jobs');
      const parsed = jobsRaw ? JSON.parse(jobsRaw) : [];
      const safe: Job[] = Array.isArray(parsed) ? parsed : [];
      setAcceptedJobs(safe.filter((j) => isActiveJobStatus(j.status)));
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

    router.push({
      pathname: '/chat',
      params: {
        jobId: job.id,
        problem: job.problem,
        price: job.price,
        time: job.time,
        timeMode: job.timeMode,
        creatorName: job.creatorName || i18n.t('common.default_user_name'),
        currentUserRole: 'buddy',
      },
    });
  };

  const completeJob = async (job: Job) => {
    try {
      const jobsRaw = await AsyncStorage.getItem('jobs');
      const parsed = jobsRaw ? JSON.parse(jobsRaw) : [];
      const safe: Job[] = Array.isArray(parsed) ? parsed : [];
      const updated = safe.map((j) =>
        j.id === job.id
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
      await AsyncStorage.setItem('jobs', JSON.stringify(updated));
      await AsyncStorage.setItem(
        'buddyScore',
        (currentScore + getBuddyPointsForJob(job)).toString()
      );
      await recordJobCompletionEarning(job);
      router.push({
        pathname: '/review/[jobId]',
        params: {
          jobId: job.id,
          currentUserRole: 'buddy',
        },
      });
    } catch {
      alert(i18n.t('job.job_complete_error'));
    }
  };

  const nowJobs = acceptedJobs.filter(
    (j) => !j.timeMode || j.timeMode === 'sofort' || j.timeMode === 'flexibel'
  );
  const scheduledJobs = acceptedJobs.filter((j) => j.timeMode === 'termin');

  const currentJobs = activeTab === 'now' ? nowJobs : scheduledJobs;
  const emptyKey =
    activeTab === 'now' ? 'profile.no_now_jobs' : 'profile.no_scheduled_jobs';

  const renderJobCard = (job: Job) => (
    <View key={job.id} style={styles.jobCard}>
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

        {job.category && (
          <View style={styles.metaChip}>
            <Text style={styles.metaChipText}>
              {i18n.t(`preferences.categories.${job.category}`)}
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
        <Pressable
          style={styles.completeButton}
          onPress={() => completeJob(job)}
        >
          <Text style={styles.completeButtonText}>
            {i18n.t('common.done')}
          </Text>
        </Pressable>
      </View>
    </View>
  );

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
            <Text style={styles.emptyText}>{i18n.t(emptyKey)}</Text>
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
    backgroundColor: colors.primary,
    borderColor: colors.primary,
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
    borderRadius: 10,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  tabBadgeActive: {
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  tabBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
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
    gap: spacing.md,
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
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  jobCard: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.lightGrey,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  jobTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  jobProblem: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    flex: 1,
  },
  pricePill: {
    backgroundColor: colors.lightOrange,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: '#FFD4C7',
  },
  priceText: {
    ...typography.metaStrong,
    color: colors.primary,
  },
  jobMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  metaChip: {
    backgroundColor: colors.lightGrey,
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
  jobActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chatButton: {
    flex: 1,
    backgroundColor: colors.secondary,
    borderRadius: layout.borderRadiusSmall,
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
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  completeButtonText: {
    ...typography.buttonSecondary,
    color: colors.card,
  },
});
