import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Image,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../lib/colors';
import i18n, { useLanguage } from '../../lib/i18n';
import { requestJobApplication, reviewJobApplication } from '../../lib/job-actions';
import {
    canExtendJob,
    extendJobExpiry,
    getBuddyPointsForJob,
    getRemainingExtensions,
    isJobOpenForApplications,
    Job,
    JobApplicationState,
    LOCAL_USER_ID,
} from '../../lib/jobs';
import { getLevelInfo } from '../../lib/levels';
import { goBackOrReplace } from '../../lib/navigation';
import { createNotification, Notification } from '../../lib/notifications';
import {
    ensureJobPaymentState,
    formatPriceLine,
    PaymentStatus,
} from '../../lib/payments';
import {
    getInterestedBuddyCount,
    getJobViewsCount,
    getRequesterCompletedJobs,
    getRequesterRatingCount,
    getRequesterReliability,
    incrementJobViews,
} from '../../lib/signals';
import { layout, spacing } from '../../lib/spacing';
import { getReliabilitySignal } from '../../lib/trust';
import { typography } from '../../lib/typography';

const USER_LOCATION = {
  lat: 47.856,
  lng: 12.128,
};

const EXTEND_OPTIONS: { label: string; ms: number }[] = [
  { label: '1h',  ms: 1  * 3600 * 1000 },
  { label: '3h',  ms: 3  * 3600 * 1000 },
  { label: '6h',  ms: 6  * 3600 * 1000 },
  { label: '12h', ms: 12 * 3600 * 1000 },
  { label: '24h', ms: 24 * 3600 * 1000 },
];

const getDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export default function JobDetailScreen() {
  useLanguage();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    id?: string | string[];
    currentUserRole?: 'auftraggeber' | 'buddy' | string | string[];
  }>();
  const [job, setJob] = useState<Job | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAccepting, setIsAccepting] = useState(false);
  const [buddyScore, setBuddyScore] = useState(0);
  const [isExtendModalVisible, setIsExtendModalVisible] = useState(false);
  const [selectedDurationMs, setSelectedDurationMs] = useState(EXTEND_OPTIONS[1].ms);
  const [isCancelConfirmVisible, setIsCancelConfirmVisible] = useState(false);
  const [isReviewingApplication, setIsReviewingApplication] = useState(false);
  const isEnglish = String(i18n.locale).toLowerCase().startsWith('en');

  // The stable ID for the local buddy (non-owner) in this mock setup
  const LOCAL_BUDDY_ID = 'buddy_local';

  // The local buddy's own application on this job, if any
  const localApplication = useMemo(() => {
    if (!job) return null;
    return job.match?.applications?.find((a) => a.buddyId === LOCAL_BUDDY_ID) ?? null;
  }, [job]);

  const jobId = useMemo(() => {
    if (!params.id) return '';
    return Array.isArray(params.id) ? params.id[0] : params.id;
  }, [params.id]);

  const handleBack = () => {
    goBackOrReplace(router, '/(tabs)/feed');
  };

  useEffect(() => {
    const loadJob = async () => {
      try {
        setIsLoading(true);

        const [jobsRaw, scoreRaw] = await Promise.all([
          AsyncStorage.getItem('jobs'),
          AsyncStorage.getItem('buddyScore'),
        ]);
        const parsedJobs = jobsRaw ? JSON.parse(jobsRaw) : [];
        const safeJobs: Job[] = Array.isArray(parsedJobs) ? parsedJobs : [];
        const parsedScore = scoreRaw ? Number(scoreRaw) : 0;

        const foundJob =
          safeJobs.find((item) => String(item.id) === String(jobId)) || null;

        if (foundJob) {
          const viewedJob = incrementJobViews(foundJob);
          const updatedJobs = safeJobs.map((item) =>
            String(item.id) === String(jobId) ? viewedJob : item
          );
          await AsyncStorage.setItem('jobs', JSON.stringify(updatedJobs));
          setJob(viewedJob);
        } else {
          setJob(null);
        }
        setBuddyScore(Number.isFinite(parsedScore) ? parsedScore : 0);
      } catch (error) {
        console.error('Fehler beim Laden des Jobs:', error);
        setJob(null);
        setBuddyScore(0);
      } finally {
        setIsLoading(false);
      }
    };

    if (jobId) {
      loadJob();
    } else {
      setJob(null);
      setIsLoading(false);
    }
  }, [jobId]);

  const getTimeBadge = (currentJob: Job) => {
    if (currentJob.timeMode === 'sofort') return i18n.t('common.asap_badge');
    if (currentJob.timeMode === 'flexibel') return i18n.t('common.flexible');
    if (currentJob.timeMode === 'termin') return i18n.t('common.scheduled');
    return currentJob.time || i18n.t('common.time_open');
  };

  const getProblemTitle = (currentJob: Job) => {
    const safeName = String(currentJob.creatorName || i18n.t('common.default_user_name'));
    const translated = i18n.t('job.problem_title', { name: safeName });

    if (typeof translated !== 'string') {
      return isEnglish ? `${safeName}'s Problem` : `Problem von ${safeName}`;
    }

    if (
      translated.includes('{name}') ||
      translated.includes('%{name}') ||
      translated.includes('{{name}}')
    ) {
      return isEnglish ? `${safeName}'s Problem` : `Problem von ${safeName}`;
    }

    return translated;
  };

  const getJobTypeHeadline = (currentJob: Job): string => {
    if (currentJob.timeMode === 'sofort') {
      return i18n.t('job.detail_type_now');
    }
    if (currentJob.timeMode === 'flexibel') {
      return i18n.t('job.detail_type_flexible');
    }
    if (currentJob.timeMode === 'termin') {
      return i18n.t('job.detail_type_scheduled');
    }
    return i18n.t('job.detail_type_default');
  };

  const estimateTravelTime = (distanceKm: number): number => {
    if (distanceKm <= 1) return 2;
    if (distanceKm <= 3) return Math.round(distanceKm * 1.5);
    if (distanceKm <= 10) return Math.round(distanceKm + 2);
    return Math.round(distanceKm / 2);
  };

  const getFileCountText = (count: number): string => {
    if (count === 1) return i18n.t('common.files_count_singular');
    return i18n.t('common.files_count_plural');
  };

  const getDistanceLabel = (currentJob: Job): string => {
    if (!currentJob.location) return i18n.t('common.nearby');
    const km = getDistance(
      USER_LOCATION.lat,
      USER_LOCATION.lng,
      currentJob.location.lat,
      currentJob.location.lng
    );
    if (!Number.isFinite(km) || km < 1) return '<1 km';
    const travelTimeMin = estimateTravelTime(km);
    return `${travelTimeMin} min · ${km.toFixed(1)} km`;
  };

  const getDescriptionText = (currentJob: Job): string => {
    const maybeDescription = (currentJob as Job & { description?: string }).description;
    if (typeof maybeDescription === 'string' && maybeDescription.trim().length > 0) {
      return maybeDescription.trim();
    }
    return currentJob.problem;
  };

  const getUiLabel = (key: 'description' | 'images') => {
    if (key === 'description') return i18n.t('job.detail_section_expectations');
    return i18n.t('job.detail_section_files');
  };

  const getAcceptCtaText = () => {
    if (localApplication?.requesterDecision === 'accepted') {
      return i18n.t('job.request_confirmed_button');
    }
    if (localApplication?.requesterDecision === 'pending') {
      return i18n.t('job.request_pending_button');
    }
    if (localApplication?.requesterDecision === 'declined') {
      return isEnglish ? 'Request Declined' : 'Anfrage abgelehnt';
    }
    if (!isJobOpenForApplications(job?.status ?? 'open')) {
      return i18n.t('job.request_confirmed_button');
    }
    return i18n.t('job.accept_button');
  };

  const getAcceptHelperText = () => {
    if (localApplication?.requesterDecision === 'accepted') {
      return isEnglish
        ? 'Accepted — chat is now available'
        : 'Angenommen — Chat ist jetzt verfügbar';
    }
    if (localApplication?.requesterDecision === 'declined') {
      return isEnglish
        ? 'Your request was not selected for this job'
        : 'Deine Anfrage wurde für diesen Auftrag nicht ausgewählt';
    }
    if (localApplication?.requesterDecision === 'pending') {
      return i18n.t('job.request_pending_helper');
    }
    if (job?.status === 'matched') {
      return i18n.t('job.request_confirmed_helper');
    }
    return i18n.t('job.accept_helper');
  };

  const getRewardLineText = (currentJob: Job): string => {
    return i18n.t('job.detail_reward_line', { price: currentJob.price });
  };

  const getPaymentState = (currentJob: Job) => {
    return ensureJobPaymentState(currentJob);
  };

  const getPaymentStatusHint = (
    status: PaymentStatus,
    forRequester: boolean
  ): string | null => {
    if (forRequester) {
      if (status === 'pending_authorization') return i18n.t('job.payment_status_securing');
      if (status === 'reserved' || status === 'paid') return i18n.t('job.payment_status_secured');
      if (status === 'release_pending') return i18n.t('job.payment_status_release_pending');
      return null;
    }
    // Buddy view
    if (status === 'reserved' || status === 'paid') return i18n.t('job.payout_status_secured');
    if (status === 'release_pending') return i18n.t('job.payout_status_release_pending');
    return null;
  };

  const getBuddyRewardProgressText = (currentJob: Job): string => {
    const points = getBuddyPointsForJob(currentJob);
    const levelInfo = getLevelInfo(buddyScore);

    if (levelInfo.nextLevelThreshold === null) {
      return i18n.t('job.detail_progress_max');
    }

    const scoreAfterReward = buddyScore + points;
    const pointsAfterReward = Math.max(0, levelInfo.nextLevelThreshold - scoreAfterReward);

    if (pointsAfterReward === 0) {
      return i18n.t('job.detail_progress_unlock', {
        level: levelInfo.level + 1,
      });
    }

    return i18n.t('job.detail_progress_to_next', {
      points: pointsAfterReward,
      level: levelInfo.level + 1,
    });
  };

  const isHotJob = (currentJob: Job): boolean => {
    const price = parseFloat(currentJob.price) || 0;
    return price >= 75 || currentJob.timeMode === 'sofort';
  };

  const getTimeModeBadge = (
    currentJob: Job
  ): { key: string; label: string; variant: 'now' | 'flexible' | 'scheduled' } | null => {
    if (currentJob.timeMode === 'sofort') {
      return {
        key: 'now',
        label: `⚡ ${i18n.t('feed.badges.now')}`,
        variant: 'now',
      };
    }

    if (currentJob.timeMode === 'flexibel') {
      return {
        key: 'flexible',
        label: i18n.t('feed.badges.flexible'),
        variant: 'flexible',
      };
    }

    if (currentJob.timeMode === 'termin') {
      return {
        key: 'scheduled',
        label: i18n.t('feed.badges.scheduled'),
        variant: 'scheduled',
      };
    }

    return null;
  };

  const getDetailBadges = (currentJob: Job): Array<{ key: string; label: string; variant: 'hot' | 'now' | 'flexible' | 'scheduled' }> => {
    const badges: Array<{ key: string; label: string; variant: 'hot' | 'now' | 'flexible' | 'scheduled' }> = [];
    const timeModeBadge = getTimeModeBadge(currentJob);

    if (timeModeBadge) {
      badges.push(timeModeBadge);
    }

    if (isHotJob(currentJob)) {
      badges.push({
        key: 'hot',
        label: `🔥 ${i18n.t('feed.badges.in_demand')}`,
        variant: 'hot',
      });
    }

    return badges.slice(0, 2);
  };

  const getJobSignalItems = (currentJob: Job): string[] => {
    const signalItems: string[] = [];

    const views = getJobViewsCount(currentJob);
    if (typeof views === 'number' && views > 0) {
      signalItems.push(i18n.t('job.signal_views', { count: views }));
    }

    const interested = getInterestedBuddyCount(currentJob);
    if (typeof interested === 'number' && interested > 0) {
      signalItems.push(i18n.t('job.signal_interest', { count: interested }));
    }

    const requesterRatingCount = getRequesterRatingCount(currentJob);
    if (typeof requesterRatingCount === 'number' && requesterRatingCount > 0) {
      signalItems.push(i18n.t('job.signal_requester_reviews', { count: requesterRatingCount }));
    }

    const requesterCompleted = getRequesterCompletedJobs(currentJob);
    if (typeof requesterCompleted === 'number' && requesterCompleted > 0) {
      signalItems.push(i18n.t('job.signal_requester_completed', { count: requesterCompleted }));
    }

    const reliability = getRequesterReliability(currentJob);
    if (reliability) {
      signalItems.push(i18n.t(`job.signal_reliability_${reliability}`));
    }

    return signalItems.slice(0, 4);
  };

  const confirmExtend = async () => {
    if (!job || !canExtendJob(job)) return;
    const jobId = job.id;
    const durationMs = selectedDurationMs;
    setIsExtendModalVisible(false);
    try {
      const jobsRaw = await AsyncStorage.getItem('jobs');
      const parsed = jobsRaw ? JSON.parse(jobsRaw) : [];
      const safe: Job[] = Array.isArray(parsed) ? parsed : [];
      const updatedAll = safe.map((j) =>
        String(j.id) === String(jobId) ? extendJobExpiry(j, durationMs) : j
      );
      await AsyncStorage.setItem('jobs', JSON.stringify(updatedAll));
      const updatedJob = updatedAll.find((j) => String(j.id) === String(jobId));
      if (updatedJob) setJob(updatedJob);
    } catch {
      // fail silently — state unchanged
    }
  };

  const confirmCancel = async () => {
    if (!job) return;
    const jobId = job.id;
    setIsCancelConfirmVisible(false);
    try {
      const jobsRaw = await AsyncStorage.getItem('jobs');
      const parsed = jobsRaw ? JSON.parse(jobsRaw) : [];
      const safe: Job[] = Array.isArray(parsed) ? parsed : [];
      const updatedAll = safe.map((j) =>
        String(j.id) === String(jobId) ? { ...j, status: 'cancelled' as const } : j
      );
      await AsyncStorage.setItem('jobs', JSON.stringify(updatedAll));
      handleBack();
    } catch {
      // fail silently
    }
  };

  const acceptApplication = async (buddyId: string) => {
    if (!job) return;
    try {
      setIsReviewingApplication(true);
      const result = await reviewJobApplication({
        jobId: job.id,
        buddyId,
        decision: 'accept',
        requesterId: LOCAL_USER_ID,
      });
      if (result.updatedJob) setJob(result.updatedJob);
    } catch {
      // fail silently
    } finally {
      setIsReviewingApplication(false);
    }
  };

  const declineApplication = async (buddyId: string) => {
    if (!job) return;
    try {
      setIsReviewingApplication(true);
      const result = await reviewJobApplication({
        jobId: job.id,
        buddyId,
        decision: 'decline',
        requesterId: LOCAL_USER_ID,
      });
      if (result.updatedJob) setJob(result.updatedJob);
    } catch {
      // fail silently
    } finally {
      setIsReviewingApplication(false);
    }
  };

  const acceptJob = async () => {
    if (!job) return;
    if (!isJobOpenForApplications(job.status)) return;
    if (localApplication) return; // already applied — backend deduplicates too

    try {
      setIsAccepting(true);
      const jobsRaw = await AsyncStorage.getItem('jobs');
      const parsedJobs = jobsRaw ? JSON.parse(jobsRaw) : [];
      const safeJobs: Job[] = Array.isArray(parsedJobs) ? parsedJobs : [];
      const completedJobs = safeJobs.filter((entry) => entry.status === 'completed');
      const completedJobsCount = completedJobs.length;
      const completedWithReview = completedJobs.filter(
        (entry) => entry.review && typeof entry.review.rating === 'number'
      );
      const ratingCount = completedWithReview.length;
      const averageRating =
        ratingCount > 0
          ? completedWithReview.reduce((sum, entry) => sum + (entry.review?.rating ?? 0), 0) / ratingCount
          : undefined;

      const requestResult = await requestJobApplication({
        jobId: job.id,
        applicant: {
          buddyId: 'buddy_local',
          buddyName: isEnglish ? 'Buddy' : 'Buddy',
          buddyScore,
          buddyRatingAverage: averageRating,
          buddyRatingCount: ratingCount,
          buddyCompletedJobs: completedJobsCount,
          buddyReliability: getReliabilitySignal({ completedJobs: completedJobsCount }),
        },
      });

      if (!requestResult.updatedJob) {
        setIsAccepting(false);
        return;
      }

      // Create and persist notification
      const notification = createNotification(
        'jobApplication',
        i18n.t('notifications.job_application_received'),
        i18n.t('notifications.job_application_received_message', {
          buddy: requestResult.updatedJob.match?.applications?.at(-1)?.buddyName || (isEnglish ? 'Buddy' : 'Buddy'),
          score: requestResult.updatedJob.match?.applications?.at(-1)?.buddyScore ?? buddyScore,
        }),
        job.id
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
      setJob(requestResult.updatedJob);
      Alert.alert(
        i18n.t('job.request_sent_title'),
        i18n.t('job.request_sent_message')
      );
      setIsAccepting(false);
    } catch (error) {
      console.error('Fehler beim Annehmen des Jobs:', error);
      alert(i18n.t('job.job_accept_error'));
      setIsAccepting(false);
    }
  };

  if (isLoading) {
    return (
      <>
        <Stack.Screen
          options={{
            headerShown: false,
          }}
        />
        <View style={styles.centeredContainer}>
          <Text style={styles.loadingText}>{i18n.t('common.loading_job')}</Text>
        </View>
      </>
    );
  }

  if (!job) {
    return (
      <>
        <Stack.Screen
          options={{
            headerShown: false,
          }}
        />
        <View style={styles.centeredContainer}>
          <Text style={styles.notFoundTitle}>
            {i18n.t('common.job_not_found_title')}
          </Text>
          <Text style={styles.notFoundText}>
            {i18n.t('common.job_not_found_text')}
          </Text>

          <Pressable style={styles.backButton} onPress={handleBack}>
            <Text style={styles.backButtonText}>{i18n.t('common.back')}</Text>
          </Pressable>
        </View>
      </>
    );
  }

  // ─── Shared building blocks ──────────────────────────────────────────────

  const renderHeader = (currentJob: Job) => (
    <View style={styles.header}>
      <Pressable style={styles.backButton} onPress={handleBack}>
        <Text style={styles.backButtonText}>←</Text>
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {getProblemTitle(currentJob)}
      </Text>
      <View style={styles.headerSpacer} />
    </View>
  );

  const renderHeroCard = (currentJob: Job, showRewardLine: boolean) => (
    <View style={styles.heroCard}>
      <View style={styles.heroTopRow}>
        <View style={styles.heroTextBlock}>
          <Text style={styles.title}>{getJobTypeHeadline(currentJob)}</Text>
        </View>
        <View style={styles.pricePill}>
          <Text style={styles.price}>{currentJob.price}€</Text>
        </View>
      </View>

      {showRewardLine && (
        <Text style={styles.rewardLine}>{getRewardLineText(currentJob)}</Text>
      )}

      {getDetailBadges(currentJob).length > 0 && (
        <View style={styles.detailBadgesRow}>
          {getDetailBadges(currentJob).map((badge) => (
            <View
              key={badge.key}
              style={[
                styles.detailBadge,
                badge.variant === 'hot' && styles.detailBadgeHot,
                badge.variant === 'now' && styles.detailBadgeNow,
                badge.variant === 'flexible' && styles.detailBadgeFlexible,
                badge.variant === 'scheduled' && styles.detailBadgeScheduled,
              ]}
            >
              <Text
                style={[
                  styles.detailBadgeText,
                  badge.variant === 'hot' && styles.detailBadgeTextHot,
                  badge.variant === 'now' && styles.detailBadgeTextNow,
                  badge.variant === 'flexible' && styles.detailBadgeTextFlexible,
                  badge.variant === 'scheduled' && styles.detailBadgeTextScheduled,
                ]}
              >
                {badge.label}
              </Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.metaChipsRow}>
        <View style={styles.metaChip}>
          <Text style={styles.metaChipText}>📍 {getDistanceLabel(currentJob)}</Text>
        </View>
        {currentJob.media && currentJob.media.length > 0 && (
          <View style={styles.metaChip}>
            <Text style={styles.metaChipText}>
              📷 {currentJob.media.length} {getFileCountText(currentJob.media.length)}
            </Text>
          </View>
        )}
      </View>
    </View>
  );

  const renderDescriptionCard = (currentJob: Job) => (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{getUiLabel('description')}</Text>
      <Text style={styles.description}>{getDescriptionText(currentJob)}</Text>
      {getJobSignalItems(currentJob).length > 0 && (
        <View style={styles.signalRow}>
          {getJobSignalItems(currentJob).map((signal) => (
            <View key={signal} style={styles.signalChip}>
              <Text style={styles.signalChipText}>{signal}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );

  const renderMediaCard = (currentJob: Job) => {
    if (!currentJob.media || currentJob.media.length === 0) return null;
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{getUiLabel('images')}</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.mediaRow}
        >
          {currentJob.media.map((uri) => (
            <Image key={uri} source={{ uri }} style={styles.mediaPreview} />
          ))}
        </ScrollView>
      </View>
    );
  };

  const scrollProps = {
    style: styles.screen,
    contentContainerStyle: [
      styles.content,
      {
        paddingTop: insets.top + spacing.md,
        paddingBottom: Math.max(insets.bottom + spacing.xl, spacing.xxxl),
      },
    ] as object,
    showsVerticalScrollIndicator: false,
    bounces: true,
  };

  // ─── Owner applicant section ─────────────────────────────────────────────

  const renderApplicantSection = (currentJob: Job) => {
    const applications = currentJob.match?.applications ?? [];
    const selectedId = currentJob.match?.selectedApplicationId;
    const isMatchedOrActive = currentJob.status === 'matched' || currentJob.status === 'active';

    const renderApplicantCard = (application: JobApplicationState) => {
      const isPending = application.requesterDecision === 'pending';
      const isSelected = application.buddyId === selectedId;
      const isDeclined = application.requesterDecision === 'declined';
      const initials = application.buddyName
        .trim().split(/\s+/).map((n: string) => n[0]).slice(0, 2).join('').toUpperCase() || '?';

      return (
        <View
          key={application.buddyId}
          style={[
            styles.applicantCard,
            isSelected && styles.applicantCardSelected,
            isDeclined && styles.applicantCardDeclined,
          ]}
        >
          <View style={styles.applicantRow}>
            <View style={styles.applicantAvatar}>
              <Text style={styles.applicantAvatarText}>{initials}</Text>
            </View>
            <View style={styles.applicantInfo}>
              <Text style={styles.applicantName}>{application.buddyName}</Text>
              <View style={styles.applicantMetaRow}>
                {typeof application.buddyRatingAverage === 'number' && (
                  <Text style={styles.applicantMeta}>⭐ {application.buddyRatingAverage.toFixed(1)}</Text>
                )}
                {typeof application.buddyScore === 'number' && (
                  <Text style={styles.applicantMeta}>{' '}· Score {application.buddyScore}</Text>
                )}
                {application.buddyReliability === 'trusted' && (
                  <Text style={styles.applicantMeta}>{isEnglish ? ' · Trusted' : ' · Vertrauenswürdig'}</Text>
                )}
              </View>
              {typeof application.buddyCompletedJobs === 'number' && application.buddyCompletedJobs > 0 && (
                <Text style={styles.applicantMetaSecondary}>
                  {isEnglish
                    ? `${application.buddyCompletedJobs} completed jobs`
                    : `${application.buddyCompletedJobs} abgeschlossene Aufträge`}
                </Text>
              )}
            </View>
            {isSelected && (
              <View style={styles.applicantAcceptedBadge}>
                <Text style={styles.applicantAcceptedBadgeText}>✓</Text>
              </View>
            )}
            {isDeclined && (
              <Text style={styles.applicantDeclinedLabel}>
                {isEnglish ? 'Declined' : 'Abgelehnt'}
              </Text>
            )}
          </View>

          {isPending && !isMatchedOrActive && (
            <View style={styles.applicantActions}>
              <Pressable
                style={[styles.declineButton, isReviewingApplication && styles.applicantActionDisabled]}
                onPress={() => declineApplication(application.buddyId)}
                disabled={isReviewingApplication}
              >
                <Text style={styles.declineButtonText}>{isEnglish ? 'Decline' : 'Ablehnen'}</Text>
              </Pressable>
              <Pressable
                style={[styles.acceptApplicationButton, isReviewingApplication && styles.applicantActionDisabled]}
                onPress={() => acceptApplication(application.buddyId)}
                disabled={isReviewingApplication}
              >
                <Text style={styles.acceptApplicationButtonText}>{isEnglish ? 'Accept' : 'Annehmen'}</Text>
              </Pressable>
            </View>
          )}

          {isSelected && isMatchedOrActive && (
            <View style={styles.applicantAcceptedState}>
              <Text style={styles.applicantAcceptedStateText}>
                {isEnglish ? 'Chat unlocked · Job running' : 'Chat verfügbar · Job läuft'}
              </Text>
            </View>
          )}
        </View>
      );
    };

    return (
      <View style={styles.card}>
        <View style={styles.applicantSectionHeader}>
          <Text style={styles.sectionTitle}>
            {isEnglish ? 'Requests' : 'Anfragen'}
            {applications.length > 0 && ` (${applications.length})`}
          </Text>
          {isMatchedOrActive && (
            <View style={styles.applicantAcceptedBadge}>
              <Text style={styles.applicantAcceptedBadgeText}>
                {isEnglish ? 'Accepted ✓' : 'Angenommen ✓'}
              </Text>
            </View>
          )}
        </View>

        {applications.length === 0 ? (
          <Text style={styles.applicantEmptyText}>
            {isEnglish ? 'No requests yet' : 'Noch keine Anfragen'}
          </Text>
        ) : (
          applications.map(renderApplicantCard)
        )}
      </View>
    );
  };

  // ─── Owner detail path ───────────────────────────────────────────────────

  const renderOwnerDetail = (currentJob: Job) => (
    <>
      <ScrollView {...scrollProps}>
        {renderHeader(currentJob)}
        {renderHeroCard(currentJob, false)}
        {renderDescriptionCard(currentJob)}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{i18n.t('job.detail_section_payment')}</Text>
          <View style={styles.paymentRow}>
            <Text style={styles.paymentLabel}>{i18n.t('job.payment_line_job')}</Text>
            <Text style={styles.paymentValue}>{formatPriceLine(getPaymentState(currentJob).buddyEarnings)}</Text>
          </View>
          <View style={styles.paymentRow}>
            <Text style={styles.paymentLabel}>{i18n.t('job.payment_line_fee')}</Text>
            <Text style={styles.paymentValue}>{formatPriceLine(getPaymentState(currentJob).platformKeeps)}</Text>
          </View>
          <View style={[styles.paymentRow, styles.paymentTotalRow]}>
            <Text style={styles.paymentTotalLabel}>{i18n.t('job.payment_line_total')}</Text>
            <Text style={styles.paymentTotalValue}>{formatPriceLine(getPaymentState(currentJob).requesterPays)}</Text>
          </View>
          {getPaymentStatusHint(getPaymentState(currentJob).paymentStatus, true) && (
            <Text style={styles.paymentStatusHint}>
              {getPaymentStatusHint(getPaymentState(currentJob).paymentStatus, true)}
            </Text>
          )}
        </View>

        {renderApplicantSection(currentJob)}
        {renderMediaCard(currentJob)}

        <View style={styles.ownerActionRow}>
          <Pressable
            style={styles.ownerCancelButton}
            onPress={() => setIsCancelConfirmVisible(true)}
          >
            <Text style={styles.ownerCancelButtonText}>
              {isEnglish ? 'Cancel job' : 'Job abbrechen'}
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.ownerExtendButton,
              !canExtendJob(currentJob) && styles.ownerExtendButtonDisabled,
            ]}
            onPress={() => {
              if (canExtendJob(currentJob)) {
                setSelectedDurationMs(EXTEND_OPTIONS[1].ms);
                setIsExtendModalVisible(true);
              }
            }}
            disabled={!canExtendJob(currentJob)}
          >
            <Text style={[
              styles.ownerExtendButtonText,
              !canExtendJob(currentJob) && styles.ownerExtendButtonTextDisabled,
            ]}>
              {isEnglish ? '+ Extend' : '+ Verlängern'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal
        visible={isExtendModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setIsExtendModalVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setIsExtendModalVisible(false)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>
              {isEnglish ? 'Extend runtime' : 'Laufzeit verlängern'}
            </Text>
            <Text style={styles.modalDurationHint}>
              {isEnglish ? 'Choose duration' : 'Dauer wählen'}
            </Text>
            <Text style={styles.modalExtensionsHint}>
              {(() => {
                const r = getRemainingExtensions(currentJob);
                if (r === 1) return isEnglish ? 'Last extension available' : 'Letzte verfügbare Verlängerung';
                return isEnglish ? `${r} extensions remaining` : `Noch ${r} Verlängerungen verfügbar`;
              })()}
            </Text>
            <View style={styles.durationRow}>
              {EXTEND_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.ms}
                  style={[
                    styles.durationOption,
                    selectedDurationMs === opt.ms && styles.durationOptionSelected,
                  ]}
                  onPress={() => setSelectedDurationMs(opt.ms)}
                >
                  <Text style={[
                    styles.durationOptionText,
                    selectedDurationMs === opt.ms && styles.durationOptionTextSelected,
                  ]}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={styles.confirmButton} onPress={confirmExtend}>
              <Text style={styles.confirmButtonText}>
                {isEnglish ? 'Confirm' : 'Bestätigen'}
              </Text>
            </Pressable>
            <Pressable style={styles.modalCancelButton} onPress={() => setIsExtendModalVisible(false)}>
              <Text style={styles.modalCancelButtonText}>
                {isEnglish ? 'Cancel' : 'Abbrechen'}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={isCancelConfirmVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setIsCancelConfirmVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setIsCancelConfirmVisible(false)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>
              {isEnglish ? 'Cancel job?' : 'Job abbrechen?'}
            </Text>
            <Text style={styles.cancelWarningText}>
              {isEnglish
                ? 'This job will be closed and removed from the marketplace. This cannot be undone.'
                : 'Dieser Auftrag wird geschlossen und aus dem Marktplatz entfernt. Diese Aktion kann nicht rückgängig gemacht werden.'}
            </Text>
            <Pressable style={styles.confirmCancelButton} onPress={confirmCancel}>
              <Text style={styles.confirmCancelButtonText}>
                {isEnglish ? 'Yes, cancel job' : 'Ja, Job abbrechen'}
              </Text>
            </Pressable>
            <Pressable style={styles.modalCancelButton} onPress={() => setIsCancelConfirmVisible(false)}>
              <Text style={styles.modalCancelButtonText}>
                {isEnglish ? 'Go back' : 'Zurück'}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );

  // ─── Marketplace (non-owner) detail path ─────────────────────────────────

  const renderMarketplaceDetail = (currentJob: Job) => (
    <ScrollView {...scrollProps}>
      {renderHeader(currentJob)}
      {renderHeroCard(currentJob, true)}
      {renderDescriptionCard(currentJob)}

      <View style={[styles.card, styles.paymentCardCompact]}>
        <Text style={styles.sectionTitle}>{i18n.t('job.detail_section_payout')}</Text>
        <View style={styles.paymentRowSingle}>
          <Text style={styles.paymentSingleLabel}>{i18n.t('job.payout_line_buddy')}</Text>
          <Text style={styles.paymentSingleValue}>{formatPriceLine(getPaymentState(currentJob).buddyEarnings)}</Text>
        </View>
        {getPaymentStatusHint(getPaymentState(currentJob).paymentStatus, false) && (
          <Text style={styles.paymentStatusHint}>
            {getPaymentStatusHint(getPaymentState(currentJob).paymentStatus, false)}
          </Text>
        )}
      </View>

      {renderMediaCard(currentJob)}

      <Text style={styles.gamificationProgress}>{getBuddyRewardProgressText(currentJob)}</Text>
      <Pressable
        style={[styles.acceptButton, isAccepting && styles.acceptButtonDisabled]}
        onPress={acceptJob}
        disabled={isAccepting || !!localApplication || !isJobOpenForApplications(currentJob.status)}
      >
        <Text style={styles.acceptButtonText}>
          {isAccepting ? i18n.t('job.accepting') : getAcceptCtaText()}
        </Text>
      </Pressable>
      <Text style={styles.acceptHelperText}>{getAcceptHelperText()}</Text>
    </ScrollView>
  );

  // ─── Main render dispatch ─────────────────────────────────────────────────

  const isOwnerView = job.requesterId === LOCAL_USER_ID;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {isOwnerView ? renderOwnerDetail(job) : renderMarketplaceDetail(job)}
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: layout.screenPaddingX,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: layout.borderRadiusMedium,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  backButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  headerTitle: {
    flex: 1,
    ...typography.cardTitle,
    color: colors.textPrimary,
    textAlign: 'center',
    marginHorizontal: spacing.lg,
  },
  headerSpacer: {
    width: 40,
  },
  centeredContainer: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: layout.screenPaddingX,
  },
  loadingText: {
    ...typography.body,
    color: colors.textPrimary,
  },
  notFoundTitle: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  notFoundText: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: layout.cardPadding,
    textAlign: 'center',
  },
  heroCard: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    padding: spacing.xl,
    marginBottom: spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    borderWidth: 1,
    borderColor: colors.lightGrey,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  heroTextBlock: {
    flex: 1,
  },
  title: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    lineHeight: 30,
  },
  pricePill: {
    backgroundColor: colors.lightGrey,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  price: {
    ...typography.screenTitle,
    color: colors.primary,
  },
  detailBadgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  detailBadge: {
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  detailBadgeHot: {
    backgroundColor: colors.purpleBadge,
  },
  detailBadgeNow: {
    backgroundColor: colors.lightGrey,
  },
  detailBadgeFlexible: {
    backgroundColor: colors.veryLightPurple,
  },
  detailBadgeScheduled: {
    backgroundColor: colors.veryLightGrey,
  },
  detailBadgeText: {
    ...typography.meta,
    fontWeight: '700',
  },
  detailBadgeTextHot: {
    color: colors.secondary,
  },
  detailBadgeTextNow: {
    color: colors.secondary,
  },
  detailBadgeTextFlexible: {
    color: colors.secondary,
  },
  detailBadgeTextScheduled: {
    color: colors.textSecondary,
  },
  metaChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  metaChip: {
    backgroundColor: colors.lightGrey,
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metaChipText: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  statusBadge: {
    backgroundColor: colors.lightGrey,
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  statusBadgeText: {
    color: colors.textSecondary,
    ...typography.meta,
  },
  ratingText: {
    color: colors.textSecondary,
    ...typography.meta,
  },
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  paymentTotalRow: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.lightBorder,
  },
  paymentLabel: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  paymentValue: {
    ...typography.metaStrong,
    color: colors.textPrimary,
  },
  paymentTotalLabel: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
  },
  paymentTotalValue: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
  },
  paymentRowSingle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  paymentSingleLabel: {
    ...typography.metaStrong,
    color: colors.textSecondary,
  },
  paymentSingleValue: {
    ...typography.sectionTitle,
    color: colors.primary,
  },
  paymentStatusHint: {
    ...typography.meta,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  paymentCardCompact: {
    paddingVertical: spacing.md,
  },
  mediaRow: {
    gap: spacing.md,
  },
  mediaPreview: {
    width: 250,
    height: 170,
    borderRadius: layout.borderRadiusSmall,
    backgroundColor: colors.lightGreyVariant,
  },
  sectionTitle: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  description: {
    ...typography.body,
    color: colors.textPrimary,
    lineHeight: 24,
  },
  acceptButton: {
    backgroundColor: colors.primary,
    borderRadius: layout.borderRadiusMedium,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  acceptButtonDisabled: {
    backgroundColor: colors.lightGrey,
    shadowOpacity: 0.04,
  },
  acceptButtonText: {
    color: colors.card,
    ...typography.button,
  },
  acceptHelperText: {
    ...typography.meta,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  rewardLine: {
    ...typography.meta,
    color: colors.primary,
    marginTop: spacing.md,
    fontWeight: '600',
    lineHeight: 20,
  },
  signalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  signalChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    backgroundColor: colors.veryLightGrey,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  signalChipText: {
    ...typography.meta,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  gamificationProgress: {
    ...typography.meta,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    lineHeight: 19,
  },
  ownerActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.lightBorder,
  },
  ownerCancelButton: {
    borderRadius: 7,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'transparent',
  },
  ownerCancelButtonText: {
    fontSize: 12,
    fontWeight: '500' as const,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  ownerExtendButton: {
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.veryLightPurple,
    borderWidth: 1,
    borderColor: colors.overlayLightPurple,
  },
  ownerExtendButtonDisabled: {
    backgroundColor: colors.lightGrey,
    borderColor: colors.border,
    opacity: 0.5,
  },
  ownerExtendButtonText: {
    fontSize: 13,
    fontWeight: '700' as const,
    lineHeight: 17,
    color: colors.secondary,
  },
  ownerExtendButtonTextDisabled: {
    color: colors.placeholder,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.42)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: layout.borderRadiusLarge,
    borderTopRightRadius: layout.borderRadiusLarge,
    padding: layout.cardPadding,
    paddingBottom: spacing.xxxl,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.lightGrey,
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  modalTitle: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  modalDurationHint: {
    ...typography.metaStrong,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  modalExtensionsHint: {
    ...typography.meta,
    color: colors.placeholder,
    marginBottom: spacing.md,
  },
  durationRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  durationOption: {
    borderRadius: 999,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.lightGrey,
    borderWidth: 1,
    borderColor: colors.border,
  },
  durationOptionSelected: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary,
  },
  durationOptionText: {
    ...typography.metaStrong,
    color: colors.textPrimary,
  },
  durationOptionTextSelected: {
    color: colors.card,
  },
  confirmButton: {
    backgroundColor: colors.secondary,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  confirmButtonText: {
    ...typography.button,
    color: colors.card,
  },
  confirmCancelButton: {
    backgroundColor: colors.red,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  confirmCancelButtonText: {
    ...typography.button,
    color: colors.card,
  },
  cancelWarningText: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.xl,
  },
  modalCancelButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  modalCancelButtonText: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  // ─── Applicant section ───────────────────────────────────────────────────
  applicantSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  applicantAcceptedBadge: {
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.lightGreen,
    borderWidth: 1,
    borderColor: '#C6F0CC',
  },
  applicantAcceptedBadgeText: {
    fontSize: 11,
    fontWeight: '600' as const,
    lineHeight: 15,
    color: colors.green,
  },
  applicantEmptyText: {
    ...typography.meta,
    color: colors.placeholder,
  },
  applicantRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  applicantAvatar: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.veryLightPurple,
    borderWidth: 1,
    borderColor: colors.overlayLightPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applicantAvatarText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: colors.secondary,
  },
  applicantInfo: {
    flex: 1,
  },
  applicantName: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  applicantMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 2,
  },
  applicantMeta: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  applicantMetaSecondary: {
    ...typography.meta,
    color: colors.placeholder,
    marginTop: 1,
  },
  applicantActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.lightBorder,
  },
  declineButton: {
    borderRadius: 7,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'transparent',
  },
  declineButtonText: {
    fontSize: 12,
    fontWeight: '500' as const,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  acceptApplicationButton: {
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.secondary,
    borderWidth: 1,
    borderColor: colors.secondary,
  },
  acceptApplicationButtonText: {
    fontSize: 13,
    fontWeight: '700' as const,
    lineHeight: 17,
    color: colors.card,
  },
  applicantActionDisabled: {
    opacity: 0.5,
  },
  applicantAcceptedState: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.lightBorder,
  },
  applicantAcceptedStateText: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  applicantCard: {
    paddingBottom: spacing.md,
    marginBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.lightBorder,
  },
  applicantCardSelected: {
    // no extra visual needed — the ✓ badge and accepted state handle it
  },
  applicantCardDeclined: {
    opacity: 0.45,
  },
  applicantDeclinedLabel: {
    ...typography.meta,
    color: colors.placeholder,
    marginLeft: spacing.xs,
  },
});
