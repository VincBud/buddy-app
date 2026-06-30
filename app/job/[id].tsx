import { type Href, router, Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Image,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../lib/colors';
import i18n, { useLanguage } from '../../lib/i18n';
import { getActiveUserId } from '../../lib/auth';
import { useCurrentUser } from '../../lib/current-user';
import { cancelJob, pauseJob, repostJob, resumeJob, submitJobRating } from '../../lib/job-actions';
import { createJobRequest, updateJobRequest } from '../../services/job-requests.service';
import { getNormalizedJobReviews } from '../../lib/reviews';
import {
    canExtendJob,
    extendJobExpiry,
    getBuddyPointsForJob,
    getRemainingExtensions,
    isChatAccessibleForJob,
    isJobEditable,
    isJobOpenForApplications,
    isJobPauseable,
    isJobRepostable,
    isJobResumable,
    Job,
    JobApplicationState,
} from '../../lib/jobs';
import { getLevelInfo } from '../../lib/levels';
import { goBackOrReplace } from '../../lib/navigation';
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
import { getBuddyScore } from '../../services/user.service';
import { addNotification } from '../../services/notifications.service';
import { loadJobs, saveJobs } from '../../services/jobs.service';
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
  const { user: currentUser } = useCurrentUser();
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
  const [isPauseConfirmVisible, setIsPauseConfirmVisible] = useState(false);
  const [isRepostConfirmVisible, setIsRepostConfirmVisible] = useState(false);
  const [isReviewingApplication, setIsReviewingApplication] = useState(false);
  const isEnglish = String(i18n.locale).toLowerCase().startsWith('en');
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ratingValue, setRatingValue] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  const [ratingText, setRatingText] = useState('');
  const [isSubmittingRating, setIsSubmittingRating] = useState(false);
  const [ratingSuccess, setRatingSuccess] = useState(false);
  const [isApplicationFinalized, setIsApplicationFinalized] = useState(false);

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

  // Active user ID — drives both the owner check and the buddy application lookup
  const activeUserId = getActiveUserId();

  // The active dev user's own application on this job, if any
  const localApplication = useMemo(() => {
    if (!job) return null;
    return job.match?.applications?.find((a) => a.buddyId === activeUserId) ?? null;
  }, [job, activeUserId]);

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

        const [safeJobs, parsedScore] = await Promise.all([
          loadJobs(),
          getBuddyScore(),
        ]);

        const foundJob =
          safeJobs.find((item) => String(item.id) === String(jobId)) || null;

        if (foundJob) {
          const viewedJob = incrementJobViews(foundJob);
          const updatedJobs = safeJobs.map((item) =>
            String(item.id) === String(jobId) ? viewedJob : item
          );
          await saveJobs(updatedJobs);
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

  // Silently refresh job data on focus so the owner sees new applications
  // without a full reload spinner. Skips view-count increment (initial load only).
  useFocusEffect(
    useCallback(() => {
      if (!jobId) return;
      loadJobs().then((safeJobs) => {
        const found = safeJobs.find((item) => String(item.id) === String(jobId));
        if (found) setJob(found);
      }).catch(() => {/* ignore background refresh errors */});
    }, [jobId])
  );

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

  const isAssignedBuddy = !!(job?.assignedBuddyId && job.assignedBuddyId === activeUserId);

  const getAcceptHelperText = () => {
    // Server-backed: assignedBuddyId is set by review_job_application RPC — authoritative cross-device
    if (isAssignedBuddy && job && isChatAccessibleForJob(job)) {
      return isEnglish
        ? 'Accepted — chat is now available'
        : 'Angenommen — Chat ist jetzt verfügbar';
    }
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
      if (status === 'reserved') return i18n.t('job.payment_status_secured');
      if (status === 'release_pending') return i18n.t('job.payment_status_release_pending');
      if (status === 'paid') return i18n.t('job.payment_status_paid');
      return null;
    }
    // Buddy view
    if (status === 'pending_authorization') return i18n.t('job.payout_status_pending_auth');
    if (status === 'reserved') return i18n.t('job.payout_status_secured');
    if (status === 'release_pending') return i18n.t('job.payout_status_release_pending');
    if (status === 'paid') return i18n.t('job.payout_status_paid');
    return null;
  };

  // Secondary hint shown under the status line while payment is reserved but not yet released
  const getPaymentSecondaryHint = (
    status: PaymentStatus,
    forRequester: boolean
  ): string | null => {
    const isReservedState =
      status === 'pending_authorization' || status === 'reserved';
    if (!isReservedState) return null;
    return forRequester
      ? i18n.t('job.payment_after_completion_hint')
      : i18n.t('job.payout_after_completion_hint');
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
      const safe = await loadJobs();
      const updatedAll = safe.map((j) =>
        String(j.id) === String(jobId) ? extendJobExpiry(j, durationMs) : j
      );
      await saveJobs(updatedAll);
      const updatedJob = updatedAll.find((j) => String(j.id) === String(jobId));
      if (updatedJob) setJob(updatedJob);
      await addNotification(
        'jobExtended',
        i18n.t('notifications.jobExtended_title'),
        i18n.t('notifications.jobExtended_message'),
        jobId
      );
      showToast(isEnglish ? 'Runtime extended ✓' : 'Laufzeit verlängert ✓');
    } catch {
      showToast(isEnglish ? 'Could not extend job.' : 'Verlängerung fehlgeschlagen.', 'error');
    }
  };

  const confirmCancel = async () => {
    if (!job) return;
    setIsCancelConfirmVisible(false);
    try {
      await cancelJob({
        jobId: job.id,
        cancelledByRole: 'auftraggeber',
        cancelledByUserId: activeUserId,
        reason: 'other',
      });
      await addNotification(
        'jobCancelled',
        i18n.t('notifications.jobCancelled_title'),
        i18n.t('notifications.jobCancelled_message'),
        job.id
      );
      handleBack();
    } catch {
      // fail silently
    }
  };

  const confirmPause = async () => {
    if (!job) return;
    setIsPauseConfirmVisible(false);
    try {
      const { updatedJob } = await pauseJob({ jobId: job.id, ownerId: activeUserId });
      if (updatedJob) setJob(updatedJob);
      showToast(isEnglish ? 'Job paused ✓' : 'Job pausiert ✓');
    } catch {
      showToast(isEnglish ? 'Could not pause job.' : 'Pausieren fehlgeschlagen.', 'error');
    }
  };

  const confirmResume = async () => {
    if (!job) return;
    try {
      const { updatedJob } = await resumeJob({ jobId: job.id, ownerId: activeUserId });
      if (updatedJob) setJob(updatedJob);
      showToast(isEnglish ? 'Job resumed ✓' : 'Job fortgesetzt ✓');
    } catch {
      showToast(isEnglish ? 'Could not resume job.' : 'Fortsetzen fehlgeschlagen.', 'error');
    }
  };

  const confirmRepost = async () => {
    if (!job) return;
    setIsRepostConfirmVisible(false);
    try {
      await repostJob({ sourceJobId: job.id, ownerId: activeUserId });
      handleBack();
    } catch {
      // fail silently
    }
  };

  const acceptApplication = async (buddyId: string) => {
    if (!job) return;
    try {
      setIsReviewingApplication(true);
      const { updatedJob } = await updateJobRequest({
        jobId: job.id,
        buddyId,
        decision: 'accept',
        requesterId: activeUserId,
      });
      if (updatedJob) {
        setJob(updatedJob);
        router.push({
          pathname: '/chat',
          params: {
            jobId: updatedJob.id,
            problem: updatedJob.problem,
            price: updatedJob.price,
            time: updatedJob.time,
            timeMode: updatedJob.timeMode,
            creatorName: updatedJob.creatorName || '',
            currentUserRole: 'auftraggeber',
          },
        });
      }
      // DB trigger sends jobApplicationAccepted to the buddy — no local copy needed here.
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
      const { updatedJob } = await updateJobRequest({
        jobId: job.id,
        buddyId,
        decision: 'decline',
        requesterId: activeUserId,
      });
      if (updatedJob) setJob(updatedJob);
      // DB trigger sends jobApplicationDeclined to the buddy — no local copy needed here.
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
      // All identity snapshot fields (buddyName, buddyScore, buddyRatingAverage,
      // buddyRatingCount, buddyCompletedJobs, buddyReliability) are derived
      // server-side by trg_sanitize_job_application_reputation. Client only sends buddy_id.
      const { updatedJob, alreadyFinalized } = await createJobRequest({
        jobId: job.id,
        applicant: {
          buddyId: activeUserId,
        },
      });

      if (alreadyFinalized) {
        setIsApplicationFinalized(true);
        setIsAccepting(false);
        Alert.alert(
          isEnglish ? 'Application Closed' : 'Bewerbung nicht möglich',
          isEnglish
            ? 'Your application for this job has already been finalised.'
            : 'Deine Bewerbung für diesen Auftrag wurde bereits abgeschlossen.'
        );
        return;
      }

      if (!updatedJob) {
        setIsAccepting(false);
        return;
      }

      // DB trigger delivers jobApplication to the job owner — no local write here.
      setJob(updatedJob);
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

  // Trust & Safety report entry point (distinct from the reportJobIssue
  // dispute/"Problem melden" flow). Routes to the shared report modal.
  const renderReportLink = (currentJob: Job) => (
    <Pressable
      style={({ pressed }) => [styles.reportJobLink, pressed && styles.reportJobLinkPressed]}
      // Cast: the expo-router typed-routes file regenerates '/report' on the
      // next dev-server run; the route already exists at app/report.tsx.
      onPress={() => router.push({
        pathname: '/report',
        params: { targetType: 'job', jobId: currentJob.id },
      } as unknown as Href)}
      hitSlop={8}
    >
      <Text style={styles.reportJobLinkText}>{i18n.t('report.titles.job')}</Text>
    </Pressable>
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
          {isPending && !isMatchedOrActive && (
            <Text style={styles.applicantIntentLabel}>
              {isEnglish ? 'Buddy wants to help' : 'Buddy möchte helfen'}
            </Text>
          )}

          <View style={styles.applicantRow}>
            <View style={[styles.applicantAvatar, isSelected && styles.applicantAvatarSelected]}>
              <Text style={[styles.applicantAvatarText, isSelected && styles.applicantAvatarTextSelected]}>
                {initials}
              </Text>
            </View>
            <View style={styles.applicantInfo}>
              <Text style={styles.applicantName}>{application.buddyName}</Text>
              <View style={styles.applicantMetaRow}>
                {typeof application.buddyRatingAverage === 'number' ? (
                  <Text style={styles.applicantMeta}>⭐ {application.buddyRatingAverage.toFixed(1)}</Text>
                ) : (
                  <Text style={styles.applicantMeta}>{isEnglish ? 'New member' : 'Neues Mitglied'}</Text>
                )}
                {typeof application.buddyCompletedJobs === 'number' && application.buddyCompletedJobs > 0 && (
                  <Text style={styles.applicantMeta}>
                    {' · '}{application.buddyCompletedJobs} {isEnglish ? 'jobs done' : 'Jobs abgeschlossen'}
                  </Text>
                )}
                {application.buddyReliability === 'trusted' && (
                  <Text style={[styles.applicantMeta, styles.reliabilityTrusted]}>
                    {' · '}{i18n.t('notifications.requester_review_reliability_trusted')}
                  </Text>
                )}
              </View>
            </View>
            {isSelected && (
              <View style={styles.applicantAcceptedBadge}>
                <Text style={styles.applicantAcceptedBadgeText}>✓</Text>
              </View>
            )}
            {isDeclined && (
              <View style={styles.applicantDeclinedBadge}>
                <Text style={styles.applicantDeclinedBadgeText}>
                  {isEnglish ? 'Declined' : 'Abgelehnt'}
                </Text>
              </View>
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
                {isEnglish ? '✓ Chat unlocked · Job in progress' : '✓ Chat verfügbar · Job läuft'}
              </Text>
            </View>
          )}
        </View>
      );
    };

    const pendingCount = applications.filter(a => a.requesterDecision === 'pending').length;

    return (
      <View style={styles.card}>
        <View style={styles.applicantSectionHeader}>
          <Text style={styles.sectionTitle}>
            {isEnglish ? 'Requests' : 'Anfragen'}
          </Text>
          {isMatchedOrActive ? (
            <View style={styles.applicantAcceptedBadge}>
              <Text style={styles.applicantAcceptedBadgeText}>
                {isEnglish ? 'Accepted ✓' : 'Angenommen ✓'}
              </Text>
            </View>
          ) : pendingCount > 0 ? (
            <View style={styles.applicationCountBadge}>
              <Text style={styles.applicationCountBadgeText}>
                {isEnglish
                  ? `${pendingCount} request${pendingCount === 1 ? '' : 's'} received`
                  : `${pendingCount} Anfrage${pendingCount === 1 ? '' : 'n'} erhalten`}
              </Text>
            </View>
          ) : null}
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

  // ─── Issue banner ────────────────────────────────────────────────────────

  const renderIssueBanner = (currentJob: Job) => {
    if (currentJob.status !== 'issue_reported') return null;
    const summary = currentJob.issueSummary;
    return (
      <View style={styles.issueBanner}>
        <Text style={styles.issueBannerTitle}>
          {isEnglish ? '⚠ Issue reported' : '⚠ Problem gemeldet'}
        </Text>
        <Text style={styles.issueBannerSubtitle}>
          {isEnglish
            ? 'This job is under review. Completion and payment are paused.'
            : 'Dieser Auftrag wird geprüft. Abschluss und Zahlung sind pausiert.'}
        </Text>
        {summary?.reason && (
          <Text style={styles.issueBannerReason}>
            {i18n.t(`chat.report_reason_${summary.reason}`)}
          </Text>
        )}
      </View>
    );
  };

  // ─── Owner detail path ───────────────────────────────────────────────────

  const renderOwnerDetail = (currentJob: Job) => (
    <>
      <ScrollView {...scrollProps}>
        {renderHeader(currentJob)}
        {renderIssueBanner(currentJob)}
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
          {getPaymentSecondaryHint(getPaymentState(currentJob).paymentStatus, true) && (
            <Text style={styles.paymentSubHint}>
              {getPaymentSecondaryHint(getPaymentState(currentJob).paymentStatus, true)}
            </Text>
          )}
        </View>

        {renderApplicantSection(currentJob)}
        {renderRatingCard(currentJob, 'auftraggeber')}
        {renderMediaCard(currentJob)}

        {(isJobEditable(currentJob) || isJobPauseable(currentJob) || isJobResumable(currentJob) || isJobRepostable(currentJob)) && (
          <View style={styles.ownerMgmtRow}>
            {isJobEditable(currentJob) && (
              <Pressable
                style={styles.ownerMgmtBtn}
                onPress={() => router.push('/my-posted-jobs')}
              >
                <Text style={styles.ownerMgmtBtnText}>
                  {isEnglish ? 'Edit' : 'Bearbeiten'}
                </Text>
              </Pressable>
            )}
            {isJobPauseable(currentJob) && (
              <Pressable
                style={styles.ownerMgmtBtn}
                onPress={() => setIsPauseConfirmVisible(true)}
              >
                <Text style={styles.ownerMgmtBtnText}>
                  {isEnglish ? 'Pause' : 'Pausieren'}
                </Text>
              </Pressable>
            )}
            {isJobResumable(currentJob) && (
              <Pressable
                style={[styles.ownerMgmtBtn, styles.ownerMgmtBtnPrimary]}
                onPress={confirmResume}
              >
                <Text style={[styles.ownerMgmtBtnText, styles.ownerMgmtBtnTextPrimary]}>
                  {isEnglish ? '▶ Resume' : '▶ Fortsetzen'}
                </Text>
              </Pressable>
            )}
            {isJobRepostable(currentJob) && (
              <Pressable
                style={styles.ownerMgmtBtn}
                onPress={() => setIsRepostConfirmVisible(true)}
              >
                <Text style={styles.ownerMgmtBtnText}>
                  {isEnglish ? '↩ Repost' : '↩ Erneut posten'}
                </Text>
              </Pressable>
            )}
          </View>
        )}

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
              (!canExtendJob(currentJob) || currentJob.status === 'issue_reported') && styles.ownerExtendButtonDisabled,
            ]}
            onPress={() => {
              if (canExtendJob(currentJob) && currentJob.status !== 'issue_reported') {
                setSelectedDurationMs(EXTEND_OPTIONS[1].ms);
                setIsExtendModalVisible(true);
              }
            }}
            disabled={!canExtendJob(currentJob) || currentJob.status === 'issue_reported'}
          >
            <Text style={[
              styles.ownerExtendButtonText,
              !canExtendJob(currentJob) && styles.ownerExtendButtonTextDisabled,
            ]}>
              {isEnglish ? '+ Extend' : '+ Verlängern'}
            </Text>
          </Pressable>
        </View>
        {renderReportLink(currentJob)}
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

      <Modal
        visible={isPauseConfirmVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setIsPauseConfirmVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setIsPauseConfirmVisible(false)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>
              {isEnglish ? 'Pause job?' : 'Job pausieren?'}
            </Text>
            <Text style={styles.cancelWarningText}>
              {isEnglish
                ? "Your job will be hidden from the feed until you resume it. No data is lost."
                : 'Dein Auftrag wird im Feed ausgeblendet, bis du ihn fortsetzt. Alle Daten bleiben erhalten.'}
            </Text>
            <Pressable style={styles.confirmButton} onPress={confirmPause}>
              <Text style={styles.confirmButtonText}>
                {isEnglish ? 'Pause job' : 'Job pausieren'}
              </Text>
            </Pressable>
            <Pressable style={styles.modalCancelButton} onPress={() => setIsPauseConfirmVisible(false)}>
              <Text style={styles.modalCancelButtonText}>
                {isEnglish ? 'Go back' : 'Zurück'}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={isRepostConfirmVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setIsRepostConfirmVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setIsRepostConfirmVisible(false)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>
              {isEnglish ? 'Repost job?' : 'Job erneut posten?'}
            </Text>
            <Text style={styles.cancelWarningText}>
              {isEnglish
                ? 'A fresh copy of this job will be posted to the marketplace. The original stays in your history.'
                : 'Eine neue Kopie dieses Auftrags wird im Marktplatz gepostet. Das Original bleibt in deinem Verlauf.'}
            </Text>
            <Pressable style={styles.confirmButton} onPress={confirmRepost}>
              <Text style={styles.confirmButtonText}>
                {isEnglish ? 'Yes, repost' : 'Ja, erneut posten'}
              </Text>
            </Pressable>
            <Pressable style={styles.modalCancelButton} onPress={() => setIsRepostConfirmVisible(false)}>
              <Text style={styles.modalCancelButtonText}>
                {isEnglish ? 'Cancel' : 'Abbrechen'}
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
      {renderIssueBanner(currentJob)}
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
        {getPaymentSecondaryHint(getPaymentState(currentJob).paymentStatus, false) && (
          <Text style={styles.paymentSubHint}>
            {getPaymentSecondaryHint(getPaymentState(currentJob).paymentStatus, false)}
          </Text>
        )}
      </View>

      {renderRatingCard(currentJob, 'buddy')}
      {renderMediaCard(currentJob)}

      <Text style={styles.gamificationProgress}>{getBuddyRewardProgressText(currentJob)}</Text>

      {isAssignedBuddy && isChatAccessibleForJob(currentJob) ? (
        <>
          <Pressable
            style={styles.buddyChatButton}
            onPress={() => router.push({
              pathname: '/chat',
              params: {
                jobId: currentJob.id,
                problem: currentJob.problem ?? '',
                price: currentJob.price ?? '',
                time: currentJob.time ?? '',
                timeMode: currentJob.timeMode ?? 'sofort',
                creatorName: currentJob.creatorName ?? '',
                currentUserRole: 'buddy',
              },
            })}
          >
            <Text style={styles.buddyChatButtonText}>
              {isEnglish ? 'Open Chat' : 'Chat öffnen'}
            </Text>
          </Pressable>
          <Text style={[styles.acceptHelperText, styles.acceptHelperTextAccepted]}>
            {getAcceptHelperText()}
          </Text>
        </>
      ) : (
        <>
          <Pressable
            style={[
              styles.acceptButton,
              (isAccepting || !isJobOpenForApplications(currentJob.status)) && styles.acceptButtonDisabled,
              localApplication?.requesterDecision === 'pending' && styles.acceptButtonPending,
              localApplication?.requesterDecision === 'accepted' && styles.acceptButtonAccepted,
              localApplication?.requesterDecision === 'declined' && styles.acceptButtonDeclined,
            ]}
            onPress={acceptJob}
            disabled={isAccepting || !!localApplication || isApplicationFinalized || !isJobOpenForApplications(currentJob.status)}
          >
            <Text style={[
              styles.acceptButtonText,
              localApplication?.requesterDecision === 'pending' && styles.acceptButtonTextMuted,
              localApplication?.requesterDecision === 'declined' && styles.acceptButtonTextMuted,
            ]}>
              {isAccepting ? i18n.t('job.accepting') : getAcceptCtaText()}
            </Text>
          </Pressable>
          <Text style={[
            styles.acceptHelperText,
            localApplication?.requesterDecision === 'pending' && styles.acceptHelperTextPending,
            localApplication?.requesterDecision === 'accepted' && styles.acceptHelperTextAccepted,
          ]}>
            {getAcceptHelperText()}
          </Text>
        </>
      )}
      {renderReportLink(currentJob)}
    </ScrollView>
  );

  // ─── Inline rating card ───────────────────────────────────────────────────

  const submitRating = async (raterRole: 'auftraggeber' | 'buddy') => {
    if (!job || ratingValue === 0 || isSubmittingRating) return;
    setIsSubmittingRating(true);
    try {
      const { updatedJob } = await submitJobRating({
        jobId: job.id,
        raterRole,
        rating: ratingValue as 1 | 2 | 3 | 4 | 5,
        reviewText: ratingText,
      });
      setJob(updatedJob);
      setRatingSuccess(true);
    } catch {
      showToast(isEnglish ? 'Could not save rating.' : 'Bewertung konnte nicht gespeichert werden.', 'error');
    } finally {
      setIsSubmittingRating(false);
    }
  };

  const renderRatingCard = (currentJob: Job, raterRole: 'auftraggeber' | 'buddy') => {
    if (currentJob.status !== 'completed') return null;

    const existingReviews = getNormalizedJobReviews(currentJob);
    const alreadyRated = existingReviews.some((r) => r.reviewerRole === raterRole);
    const displayRating = raterRole === 'auftraggeber'
      ? currentJob.ownerRatingForBuddy
      : currentJob.buddyRatingForOwner;

    const title = raterRole === 'auftraggeber'
      ? (isEnglish ? 'Rate your Buddy' : 'Bewerte deinen Buddy')
      : (isEnglish ? 'Rate the requester' : 'Bewerte den Auftraggeber');

    if (alreadyRated || ratingSuccess) {
      return (
        <View style={styles.ratingCard}>
          <Text style={styles.ratingCardTitle}>
            {isEnglish ? 'Thank you for your rating' : 'Danke für deine Bewertung'}
          </Text>
          {(displayRating ?? ratingValue) > 0 && (
            <Text style={styles.ratingCardStarsDone}>
              {'★'.repeat(displayRating ?? ratingValue)}{'☆'.repeat(5 - (displayRating ?? ratingValue))}
            </Text>
          )}
        </View>
      );
    }

    return (
      <View style={styles.ratingCard}>
        <Text style={styles.ratingCardTitle}>{title}</Text>
        <View style={styles.ratingStarRow}>
          {([1, 2, 3, 4, 5] as const).map((v) => (
            <Pressable key={v} onPress={() => setRatingValue(v)} style={styles.ratingStarBtn} hitSlop={6}>
              <Text style={styles.ratingStarText}>{ratingValue >= v ? '★' : '☆'}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          style={styles.ratingTextInput}
          placeholder={isEnglish ? 'Optional comment...' : 'Optionaler Kommentar...'}
          placeholderTextColor={colors.placeholder}
          value={ratingText}
          onChangeText={setRatingText}
          multiline
        />
        <Pressable
          style={[styles.ratingSubmitBtn, (ratingValue === 0 || isSubmittingRating) && styles.ratingSubmitBtnDisabled]}
          onPress={() => submitRating(raterRole)}
          disabled={ratingValue === 0 || isSubmittingRating}
        >
          <Text style={styles.ratingSubmitBtnText}>
            {isEnglish ? 'Submit rating' : 'Bewertung senden'}
          </Text>
        </Pressable>
      </View>
    );
  };

  // ─── Main render dispatch ─────────────────────────────────────────────────

  const isOwnerView = job.requesterId === activeUserId;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      {isOwnerView ? renderOwnerDetail(job) : renderMarketplaceDetail(job)}
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
    </View>
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
  reportJobLink: {
    alignSelf: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  reportJobLinkPressed: { opacity: 0.6 },
  reportJobLinkText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    textDecorationLine: 'underline',
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
  paymentSubHint: {
    ...typography.meta,
    color: colors.placeholder,
    marginTop: 2,
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
  acceptButtonPending: {
    backgroundColor: colors.veryLightGrey,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    shadowOpacity: 0,
  },
  acceptButtonAccepted: {
    backgroundColor: colors.lightGreen,
    borderWidth: 1,
    borderColor: '#C6F0CC',
    shadowOpacity: 0,
  },
  acceptButtonDeclined: {
    backgroundColor: colors.lightGrey,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    shadowOpacity: 0,
  },
  acceptButtonText: {
    color: colors.card,
    ...typography.button,
  },
  acceptButtonTextMuted: {
    color: colors.textSecondary,
  },
  acceptHelperText: {
    ...typography.meta,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  acceptHelperTextPending: {
    color: colors.secondary,
    fontWeight: '600',
  },
  acceptHelperTextAccepted: {
    color: colors.green,
    fontWeight: '600',
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
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: colors.primary,
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
    borderLeftWidth: 3,
    borderLeftColor: colors.green,
    paddingLeft: spacing.sm,
  },
  applicantCardDeclined: {
    opacity: 0.45,
  },
  applicantDeclinedLabel: {
    ...typography.meta,
    color: colors.placeholder,
    marginLeft: spacing.xs,
  },
  applicantIntentLabel: {
    ...typography.meta,
    color: colors.secondary,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  applicantAvatarSelected: {
    backgroundColor: colors.lightGreen,
    borderColor: '#C6F0CC',
  },
  applicantAvatarTextSelected: {
    color: colors.green,
  },
  applicantDeclinedBadge: {
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.lightGrey,
    borderWidth: 1,
    borderColor: colors.lightBorder,
  },
  applicantDeclinedBadgeText: {
    fontSize: 10,
    fontWeight: '500' as const,
    lineHeight: 14,
    color: colors.placeholder,
  },
  applicationCountBadge: {
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.veryLightPurple,
    borderWidth: 1,
    borderColor: colors.overlayLightPurple,
  },
  applicationCountBadgeText: {
    fontSize: 11,
    fontWeight: '600' as const,
    lineHeight: 15,
    color: colors.secondary,
  },
  issueBanner: {
    backgroundColor: colors.lightOrange,
    borderRadius: layout.borderRadiusMedium,
    borderWidth: 1,
    borderColor: 'rgba(255, 64, 0, 0.25)',
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  issueBannerTitle: {
    ...typography.bodyStrong,
    color: colors.red,
    marginBottom: spacing.xs,
  },
  issueBannerSubtitle: {
    ...typography.meta,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  issueBannerReason: {
    ...typography.meta,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  reliabilityTrusted: {
    color: colors.green,
    fontWeight: '600',
  },
  reliabilityNew: {
    color: colors.placeholder,
  },
  ownerMgmtRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginHorizontal: layout.screenPaddingX,
    marginBottom: spacing.sm,
  },
  ownerMgmtBtn: {
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.overlayLightPurple,
    backgroundColor: colors.veryLightPurple,
  },
  ownerMgmtBtnPrimary: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary,
  },
  ownerMgmtBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    lineHeight: 17,
    color: colors.secondary,
  },
  ownerMgmtBtnTextPrimary: {
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
  ratingCard: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    padding: layout.cardPadding,
    marginBottom: spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    borderWidth: 1,
    borderColor: colors.lightBorder,
  },
  ratingCardTitle: {
    ...typography.metaStrong,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  ratingStarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  ratingStarBtn: {
    flex: 1,
    alignItems: 'center',
  },
  ratingStarText: {
    fontSize: 34,
    color: colors.yellow,
  },
  ratingCardStarsDone: {
    fontSize: 28,
    color: colors.yellow,
    marginTop: spacing.sm,
  },
  ratingTextInput: {
    minHeight: 80,
    backgroundColor: colors.veryLightPurple,
    borderRadius: layout.borderRadiusMedium,
    padding: spacing.md,
    ...typography.body,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
    textAlignVertical: 'top',
  },
  ratingSubmitBtn: {
    backgroundColor: colors.primary,
    borderRadius: layout.borderRadiusMedium,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  ratingSubmitBtnDisabled: {
    opacity: 0.5,
  },
  ratingSubmitBtnText: {
    ...typography.buttonSecondary,
    color: colors.card,
  },
  buddyChatButton: {
    backgroundColor: colors.secondary,
    borderRadius: layout.borderRadiusMedium,
    paddingVertical: spacing.lg,
    alignItems: 'center' as const,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  buddyChatButtonText: {
    ...typography.button,
    color: colors.card,
  },
});
