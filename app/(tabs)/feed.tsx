import Ionicons from '@expo/vector-icons/Ionicons';
import Slider from '@react-native-community/slider';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import RecommendationModal from '../../components/recommendation-modal';
import { colors } from '../../lib/colors';
import { debugLog } from '../../lib/config/debug';
import i18n, { useLanguage } from '../../lib/i18n';
import { completeJob as completeJobAction, isJobChatAccessible } from '../../lib/job-actions';
import { loadJobs as loadJobsService, saveJobs as saveJobsService } from '../../services/jobs.service';
import { fetchNearbyOpenJobs } from '../../services/geo.service';
import { getBuddyScore, setBuddyScore } from '../../services/user.service';
import { getActiveUserId } from '../../lib/auth';
import {
    applyJobExpiry,
    getActiveOwnJobs,
    getBuddyPointsForJob,
    isActiveJobStatus,
    Job,
    JobCategory,
} from '../../lib/jobs';
import { getLevelInfo, getStatusFromLevel } from '../../lib/levels';
import {
    inferJobCategory,
    loadUserPreferences,
    saveUserPreferences,
    UserPreferences,
} from '../../lib/preferences';
import { getInterestedBuddyCount, getJobViewsCount, getRequesterReliability } from '../../lib/signals';
import { incrementReliabilityStats } from '../../services/user.service';
import { addNotification as addNotif } from '../../services/notifications.service';
import { layout, spacing } from '../../lib/spacing';
import { typography } from '../../lib/typography';
import { recordJobCompletionEarning } from '../../lib/wallet';

type TabType = 'offen' | 'angenommen' | 'archiv';
type SmartBadgeVariant = 'match' | 'hot' | 'now' | 'flexible' | 'scheduled';

type SmartBadge = {
  key: string;
  label: string;
  variant: SmartBadgeVariant;
};

type EmptyStateConfig = {
  iconName: 'location-outline' | 'sparkles-outline' | 'briefcase-outline' | 'archive-outline';
  title: string;
  hint: string;
  actionLabel?: string;
  onAction?: () => void;
  supportsRadiusExpansion?: boolean;
};

// Geo-Matching: proximity is now computed server-side by the nearby_open_jobs
// RPC. The old hardcoded USER_LOCATION + client-side haversine over
// payload.location have been removed — open jobs carry a server-provided
// job.distanceKm instead.

// ─── FeedMediaImage ────────────────────────────────────────────────────────────
// Wraps the job-card media thumbnail with onLoad/onError diagnostics and a
// visible fallback so a broken upload never leaves an empty grey frame.

// Module-scope so the warning fires once per URL per app session and broken
// URLs stay hidden across re-renders / tab switches.
const brokenFeedImageUrls = new Set<string>();

const FeedMediaImage = memo(({ uri }: { uri: string }) => {
  const [failed, setFailed] = useState(brokenFeedImageUrls.has(uri));
  const [bustedUri, setBustedUri] = useState<string | null>(null);
  const triedRetryRef = useRef(false);

  if (failed) {
    return (
      <View style={feedMediaStyles.broken}>
        <Text style={feedMediaStyles.brokenText}>Bild konnte nicht geladen werden</Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri: bustedUri ?? uri }}
      style={feedMediaStyles.preview}
      onError={() => {
        // One cache-bust retry, then mark broken permanently to silence the log.
        if (!triedRetryRef.current && uri.startsWith('http')) {
          triedRetryRef.current = true;
          setBustedUri(`${uri}${uri.includes('?') ? '&' : '?'}t=${Date.now()}`);
          return;
        }
        if (!brokenFeedImageUrls.has(uri)) {
          brokenFeedImageUrls.add(uri);
          console.warn(`[feed] image broken url=${uri.slice(-80)}`);
        }
        setFailed(true);
      }}
    />
  );
});

const feedMediaStyles = StyleSheet.create({
  preview: {
    width: '100%',
    height: 172,
    borderRadius: layout.borderRadiusSmall,
    marginBottom: spacing.lg,
    backgroundColor: colors.lightGreyVariant,
  },
  broken: {
    width: '100%',
    height: 172,
    borderRadius: layout.borderRadiusSmall,
    marginBottom: spacing.lg,
    backgroundColor: colors.veryLightGrey,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brokenText: {
    fontSize: 12,
    color: colors.placeholder,
  },
});

// ───────────────────────────────────────────────────────────────────────────────

export default function FeedScreen() {
  useLanguage();
  const insets = useSafeAreaInsets();
  const isEnglish = String(i18n.locale).toLowerCase().startsWith('en');

  const { showRecommendations } = useLocalSearchParams<{
    showRecommendations?: string;
  }>();

  const [openJobs, setOpenJobs] = useState<Job[]>([]);
  const [acceptedJobs, setAcceptedJobs] = useState<Job[]>([]);
  const [pendingApplicationJobs, setPendingApplicationJobs] = useState<Job[]>([]);
  const [archivedJobs, setArchivedJobs] = useState<Job[]>([]);
  const [allJobs, setAllJobs] = useState<Job[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('offen');
  const [buddyRadius, setBuddyRadius] = useState(20);
  const [showRecommendationsModal, setShowRecommendationsModal] = useState(false);
  const [completedJobId, setCompletedJobId] = useState<string | undefined>();
  const [userPreferences, setUserPreferences] = useState<UserPreferences | null>(null);
  const [showRadiusSlider, setShowRadiusSlider] = useState(false);
  const [tempRadius, setTempRadius] = useState(buddyRadius);
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

  const getJobCategory = (job: Job): JobCategory => {
    return (job.category ?? inferJobCategory(job)) as JobCategory;
  };

  // Distance now comes from the nearby_open_jobs RPC (open jobs only). Jobs
  // without a server-provided distance (e.g. accepted/archived tabs) sort last.
  const getDistanceValue = (job: Job): number =>
    job.distanceKm ?? Number.POSITIVE_INFINITY;

  const getCategoryMatchScore = (
    job: Job,
    preferencesOverride?: UserPreferences | null
  ): number => {
    const prefs = preferencesOverride ?? userPreferences;
    if (!prefs) return 0;

    const category = getJobCategory(job);
    let score = 0;

    if (prefs.preferredCategories.includes(category)) score += 2;
    if (prefs.skills.includes(category)) score += 1;

    return score;
  };

  const loadJobs = async () => {
    const t0 = Date.now();
    try {
      const rawJobs = await loadJobsService();
      const loadedUserPreferences = await loadUserPreferences(getActiveUserId() || undefined);

      // applyJobExpiry returns `changed=true` whenever *any* job's status was
      // bumped to 'expired', including other users' open-past-expiry jobs that
      // we have no write permission for. Persisting those would write to local
      // AsyncStorage only — the next loadJobsService() merge re-imports them as
      // 'open' (the remote owner never expired them server-side) and we'd flip
      // them again, producing the "expiry changed → no syncable jobs" cycle
      // on every focus. We only need to persist when at least one OWNED job
      // actually transitioned; foreign expiries are kept in-memory for display.
      const { jobs: safeJobs } = applyJobExpiry(rawJobs);
      const ownerUserId = getActiveUserId();
      const ownedFlippedToExpired = safeJobs.some((j, i) => {
        const before = rawJobs[i];
        return (
          before &&
          before.status !== 'expired' &&
          j.status === 'expired' &&
          j.requesterId === ownerUserId
        );
      });
      if (ownedFlippedToExpired) {
        await saveJobsService(safeJobs);
      }

      const parsedRadius = loadedUserPreferences.radius;

      // Open feed: server-side proximity via the nearby_open_jobs RPC. The RPC
      // already filters to open jobs, excludes the caller's own + already-applied
      // jobs, and bounds the radius — so no client-side haversine/payload.location.
      // TODO(geo-2c/4): replace this hardcoded Rosenheim origin with a real
      // device GPS fix or the user's saved profile location.
      const nearbyOutcome = await fetchNearbyOpenJobs({
        lat: 47.8560,
        lng: 12.1280,
        radiusKm: parsedRadius,
      });
      let nearbyOpenJobs: Job[] = [];
      if (nearbyOutcome.ok) {
        nearbyOpenJobs = nearbyOutcome.jobs;
      } else {
        console.warn(`[feed] nearby_open_jobs failed: code=${nearbyOutcome.code}`);
        setToast({
          message: isEnglish
            ? 'Could not load nearby jobs. Pull to refresh.'
            : 'Jobs in der Nähe konnten nicht geladen werden. Zum Aktualisieren ziehen.',
          variant: 'error',
        });
      }

      // Keep the existing relevance ordering (category match → price → distance)
      // on top of the RPC's distance-sorted result.
      const sortedOpenJobs = [...nearbyOpenJobs].sort((a, b) => {
        const prefA = getCategoryMatchScore(a, loadedUserPreferences);
        const prefB = getCategoryMatchScore(b, loadedUserPreferences);
        if (prefA !== prefB) return prefB - prefA;

        const priceA = parseFloat(a.price) || 0;
        const priceB = parseFloat(b.price) || 0;
        if (priceA !== priceB) return priceB - priceA;

        const distA = getDistanceValue(a);
        const distB = getDistanceValue(b);
        if (distA !== distB) return distA - distB;

        return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
      });

      // Accepted tab: only jobs the local buddy is the selected applicant on,
      // or jobs the local user owns that are now active (owner active flow is
      // primarily in my-posted-jobs but we preserve it here for the buddy view).
      const accepted = safeJobs.filter(
        (job: Job) =>
          isActiveJobStatus(job.status) &&
          (job.requesterId === getActiveUserId() ||
            job.match?.selectedApplicationId === getActiveUserId() ||
            job.assignedBuddyId === getActiveUserId())
      );

      // Pending tab: jobs the buddy applied to but hasn't been accepted/declined yet
      const pending = safeJobs.filter(
        (job: Job) =>
          job.status === 'open' &&
          job.requesterId !== getActiveUserId() &&
          (job.match?.applications ?? []).some(
            (a) => a.buddyId === getActiveUserId() && a.requesterDecision === 'pending'
          )
      );
      const archived = safeJobs.filter(
        (job: Job) =>
          (job.status === 'completed' || job.status === 'expired') &&
          (job.requesterId === getActiveUserId() ||
            job.match?.selectedApplicationId === getActiveUserId() ||
            job.assignedBuddyId === getActiveUserId())
      );

      setBuddyRadius(parsedRadius);
      setOpenJobs(sortedOpenJobs);
      setAcceptedJobs(accepted);
      setPendingApplicationJobs(pending);
      setArchivedJobs(archived);
      setAllJobs(safeJobs);
      setUserPreferences(loadedUserPreferences);
      debugLog(`[feed] loadJobs total ${Date.now() - t0}ms (open=${sortedOpenJobs.length} accepted=${accepted.length})`);
    } catch (error) {
      console.error('Fehler beim Laden der Jobs:', error);
      setOpenJobs([]);
      setAcceptedJobs([]);
      setArchivedJobs([]);
      setAllJobs([]);
    }
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

      await addNotif(
        'jobCompleted',
        i18n.t('notifications.job_completed'),
        `${i18n.t('notifications.job_completed')}: ${job.problem}`,
        job.id
      );

      await loadJobs();
      setActiveTab('archiv');

      router.push({
        pathname: '/review/[jobId]',
        params: {
          jobId: job.id,
          currentUserRole: 'buddy',
        },
      });
    } catch (error) {
      console.error('Fehler beim Abschließen des Jobs:', error);
      setToast({ message: isEnglish ? 'Could not complete job. Please try again.' : 'Abschluss fehlgeschlagen. Bitte erneut versuchen.', variant: 'error' });
    }
  };

  const updateRadius = async (newRadius: number) => {
    const rounded = Math.round(newRadius);
    setBuddyRadius(rounded);
    const prefs = await loadUserPreferences(getActiveUserId() || undefined);
    await saveUserPreferences({ ...prefs, radius: rounded }, getActiveUserId() || undefined);
    await loadJobs();
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
        currentUserRole:
          job.requesterId === getActiveUserId() ? 'auftraggeber' : 'buddy',
      },
    });
  };

  const openDetails = (job: Job) => {
    router.push({
      pathname: '/job/[id]',
      params: { id: job.id },
    });
  };

  useFocusEffect(
    useCallback(() => {
      loadJobs();

      if (showRecommendations) {
        setCompletedJobId(showRecommendations);
        setActiveTab('offen');
        setShowRecommendationsModal(true);
      }
    }, [showRecommendations])
  );

  useEffect(() => {
    if (showRadiusSlider) {
      setTempRadius(buddyRadius);
    }
  }, [buddyRadius, showRadiusSlider]);

  const currentJobs =
    activeTab === 'offen'
      ? openJobs
      : activeTab === 'angenommen'
      ? acceptedJobs
      : archivedJobs;

  // The nearby RPC only returns jobs WITHIN the radius, so the client can no
  // longer tell whether open jobs exist beyond it. Disabled until a coarse
  // server-side count is added (geo phase 4); the empty state falls back to its
  // generic copy.
  // TODO(geo-4): surface an out-of-radius hint via a server count.
  const hasOpenJobsOutsideRadius = false;

  const getEmptyStateConfig = (): EmptyStateConfig => {
    if (activeTab === 'offen') {
      if (hasOpenJobsOutsideRadius) {
        return {
          iconName: 'location-outline',
          title: i18n.t('job.no_jobs_in_radius'),
          hint: i18n.t('job.no_jobs_in_radius_hint'),
          actionLabel: i18n.t('job.expand_radius'),
          onAction: () => setShowRadiusSlider(true),
          supportsRadiusExpansion: true,
        };
      }

      return {
        iconName: 'sparkles-outline',
        title: i18n.t('job.no_jobs_available'),
        hint: i18n.t('job.no_jobs_available_hint'),
        actionLabel: i18n.t('job.no_jobs_available_action'),
        onAction: () => router.push('/(tabs)/create'),
      };
    }

    if (activeTab === 'angenommen') {
      return {
        iconName: 'briefcase-outline',
        title: i18n.t('job.no_accepted_jobs'),
        hint: i18n.t('job.accepted_jobs_hint'),
        actionLabel: i18n.t('job.accepted_jobs_next_action'),
        onAction: () => setActiveTab('offen'),
      };
    }

    return {
      iconName: 'archive-outline',
      title: i18n.t('job.no_archived_jobs'),
      hint: i18n.t('job.archived_jobs_hint'),
      actionLabel: i18n.t('job.archived_jobs_next_action'),
      onAction: () => setActiveTab('angenommen'),
    };
  };

  const emptyState = getEmptyStateConfig();

  const getCategoryIcon = (category: JobCategory): string => {
    if (category === 'transport') return '🚗';
    if (category === 'handyman') return '🔧';
    if (category === 'household') return '🧹';
    if (category === 'tech') return '💻';
    if (category === 'errands') return '🛒';
    return '🧩';
  };

  const getJobTitle = (job: Job) => {
    const safeName = String(job.creatorName || i18n.t('common.default_user_name'));
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

  const getCreatorStatus = (job: Job) => {
    if (typeof job.creatorScore !== 'number') return null;
    const levelInfo = getLevelInfo(job.creatorScore);
    return getStatusFromLevel(levelInfo.level);
  };

  const getCreatorLevel = (job: Job): number | null => {
    if (typeof job.creatorScore !== 'number') return null;
    const levelInfo = getLevelInfo(job.creatorScore);
    return levelInfo.level;
  };

  const getCreatorStatusLabel = (status: string): string => {
    const statusKey = `profile.status_${status}`;
    return i18n.t(statusKey);
  };

  const getCreatorAverageRating = (job: Job): number | null => {
    if (!job.creatorReviews || job.creatorReviews.length === 0) return null;
    return (
      job.creatorReviews.reduce((sum, rev) => sum + rev.rating, 0) /
      job.creatorReviews.length
    );
  };

  const getCreatorReviewCount = (job: Job): number => {
    return job.creatorReviews?.length ?? 0;
  };

  const isTopBuddy = (rating: number | null, reviewCount: number): boolean => {
    return rating !== null && rating >= 4.7 && reviewCount >= 5;
  };

  const estimateTravelTime = (distanceKm: number): number => {
    if (distanceKm <= 1) return 2;
    if (distanceKm <= 3) return Math.round(distanceKm * 1.5);
    if (distanceKm <= 10) return Math.round(distanceKm + 2);
    return Math.round(distanceKm / 2);
  };

  const getCombinedDistanceDisplay = (job: Job): string => {
    if (job.distanceKm == null) return i18n.t('common.nearby');

    const distanceKm = job.distanceKm;

    if (distanceKm < 1) {
      return '<1 km';
    }

    const travelTimeMin = estimateTravelTime(distanceKm);
    return `${travelTimeMin} min · ${distanceKm.toFixed(1)} km`;
  };

  const getFileCountText = (count: number): string => {
    if (count === 1) {
      return i18n.t('common.files_count_singular');
    }
    return i18n.t('common.files_count_plural');
  };

  const getFeedSignalLabel = (job: Job): string | null => {
    const views = getJobViewsCount(job);
    if (typeof views === 'number' && views > 0) {
      return i18n.t('job.signal_views', { count: views });
    }

    const interested = getInterestedBuddyCount(job);
    if (typeof interested === 'number' && interested > 0) {
      return i18n.t('job.signal_interest', { count: interested });
    }

    return null;
  };

  const isHighPrice = (job: Job) => {
    const price = parseFloat(job.price) || 0;
    return price >= 100;
  };

  const isHotPriceJob = (job: Job): boolean => {
    const price = parseFloat(job.price) || 0;
    return price >= 75;
  };

  const getTimeModeBadge = (job: Job): SmartBadge | null => {
    if (job.timeMode === 'sofort') {
      return {
        key: 'now',
        label: `⚡ ${i18n.t('feed.badges.now')}`,
        variant: 'now',
      };
    }

    if (job.timeMode === 'flexibel') {
      return {
        key: 'flexible',
        label: i18n.t('feed.badges.flexible'),
        variant: 'flexible',
      };
    }

    if (job.timeMode === 'termin') {
      return {
        key: 'scheduled',
        label: i18n.t('feed.badges.scheduled'),
        variant: 'scheduled',
      };
    }

    return null;
  };

  const getSmartBadges = (job: Job): SmartBadge[] => {
    const badges: SmartBadge[] = [];
    const isPerfectMatch = getCategoryMatchScore(job) > 0;
    const isHot = isHotPriceJob(job);
    const timeModeBadge = getTimeModeBadge(job);

    if (isPerfectMatch) {
      badges.push({
        key: 'perfect',
        label: i18n.t('feed.badges.perfect_for_you'),
        variant: 'match',
      });
    }

    if (timeModeBadge) {
      badges.push(timeModeBadge);
    }

    if (isHot) {
      badges.push({
        key: 'hot',
        label: `🔥 ${i18n.t('feed.badges.in_demand')}`,
        variant: 'hot',
      });
    }

    return badges.slice(0, 3);
  };

  const myActivePostedJobs = useMemo(
    () => getActiveOwnJobs(allJobs, getActiveUserId()),
    [allJobs]
  );

  const sectionedOpenFeed = useMemo(() => {
    const forYou = openJobs
      .filter((job) => getCategoryMatchScore(job) > 0)
      .sort((a, b) => {
        const match = getCategoryMatchScore(b) - getCategoryMatchScore(a);
        if (match !== 0) return match;

        const price = (parseFloat(b.price) || 0) - (parseFloat(a.price) || 0);
        if (price !== 0) return price;

        return getDistanceValue(a) - getDistanceValue(b);
      });

    const used = new Set<string>();
    for (const job of forYou) used.add(job.id);

    const hotJobs = openJobs
      .filter((job) => !used.has(job.id))
      .filter((job) => (parseFloat(job.price) || 0) >= 75 || job.timeMode === 'sofort')
      .sort((a, b) => {
        const aSofort = a.timeMode === 'sofort';
        const bSofort = b.timeMode === 'sofort';
        if (aSofort !== bSofort) return aSofort ? -1 : 1;

        const price = (parseFloat(b.price) || 0) - (parseFloat(a.price) || 0);
        if (price !== 0) return price;

        return getDistanceValue(a) - getDistanceValue(b);
      });

    for (const job of hotJobs) used.add(job.id);

    const nearby = openJobs
      .filter((job) => !used.has(job.id))
      .sort((a, b) => {
        const distance = getDistanceValue(a) - getDistanceValue(b);
        if (distance !== 0) return distance;
        return (parseFloat(b.price) || 0) - (parseFloat(a.price) || 0);
      });

    return {
      forYou,
      hotJobs,
      nearby,
    };
  }, [openJobs, userPreferences]);

  const renderCardContent = (job: Job) => {
    const category = getJobCategory(job);
    const categoryLabel = i18n.t(`preferences.categories.${category}`);
    const creatorStatus = getCreatorStatus(job);
    const creatorLevel = getCreatorLevel(job);
    const creatorRating = getCreatorAverageRating(job);
    const creatorReviewCount = getCreatorReviewCount(job);
    const showTopBuddy = isTopBuddy(creatorRating, creatorReviewCount);
    const creatorReliability = getRequesterReliability(job);
    const smartBadges = activeTab === 'offen' ? getSmartBadges(job) : [];
    const fileCount = job.media?.length ?? 0;
    const feedSignalLabel = getFeedSignalLabel(job);

    return (
      <>
        <View style={styles.categoryTopRow}>
          <View style={styles.categoryChip}>
            <Text style={styles.categoryChipText}>
              {getCategoryIcon(category)} {categoryLabel}
            </Text>
          </View>
        </View>

        {job.media && job.media.length > 0 && (
          <FeedMediaImage uri={job.media[0]} />
        )}

        <View style={styles.cardHeaderRow}>
          <View style={styles.problemBlock}>
            <Text style={styles.problemText} numberOfLines={2}>
              {job.problem}
            </Text>
            <Text style={styles.creatorTitle} numberOfLines={1}>
              {getJobTitle(job)}
            </Text>
          </View>

          <View style={styles.pricePill}>
            <Text style={[styles.priceText, isHighPrice(job) && styles.highPriceText]}>
              {job.price}€
            </Text>
          </View>
        </View>

        {smartBadges.length > 0 && (
          <View style={styles.smartBadgesRow}>
            {smartBadges.map((badge) => (
              <View
                key={`${job.id}-${badge.key}`}
                style={[
                  styles.smartBadge,
                  badge.variant === 'match' && styles.smartBadgeMatch,
                  badge.variant === 'now' && styles.smartBadgeNow,
                  badge.variant === 'flexible' && styles.smartBadgeFlexible,
                  badge.variant === 'scheduled' && styles.smartBadgeScheduled,
                  badge.variant === 'hot' && styles.smartBadgeHot,
                ]}
              >
                <Text
                  style={[
                    styles.smartBadgeText,
                    badge.variant === 'match' && styles.smartBadgeTextMatch,
                    badge.variant === 'now' && styles.smartBadgeTextNow,
                    badge.variant === 'flexible' && styles.smartBadgeTextFlexible,
                    badge.variant === 'scheduled' && styles.smartBadgeTextScheduled,
                    badge.variant === 'hot' && styles.smartBadgeTextHot,
                  ]}
                >
                  {badge.label}
                </Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.metaChipsRow}>
          {job.distanceKm != null && (
            <View style={styles.metaChip}>
              <Text style={styles.metaChipText}>
                📍 {getCombinedDistanceDisplay(job)}
              </Text>
            </View>
          )}

          {fileCount > 0 && (
            <View style={styles.metaChip}>
              <Text style={styles.metaChipText}>
                📷 {fileCount} {getFileCountText(fileCount)}
              </Text>
            </View>
          )}

          {activeTab === 'offen' && feedSignalLabel && (
            <View style={styles.metaChip}>
              <Text style={styles.metaChipText}>{feedSignalLabel}</Text>
            </View>
          )}
        </View>

        {(creatorStatus || creatorRating !== null) && (
          <View style={styles.creatorTrustRow}>
            {creatorLevel !== null && (
              <View style={styles.creatorLevelBadge}>
                <Text style={styles.creatorLevelBadgeText}>
                  {i18n.t('profile.level_label')} {creatorLevel}
                </Text>
              </View>
            )}

            {creatorStatus && (
              <View style={styles.statusBadge}>
                <Text style={styles.statusBadgeText}>
                  {getCreatorStatusLabel(creatorStatus)}
                </Text>
              </View>
            )}

            {creatorRating !== null && creatorReviewCount > 0 && (
              <Text style={styles.ratingText}>
                {i18n.t('feed.rating_compact', {
                  rating: creatorRating.toFixed(1),
                  count: creatorReviewCount,
                })}
              </Text>
            )}

            {showTopBuddy && (
              <View style={styles.topBuddyBadge}>
                <Text style={styles.topBuddyBadgeText}>
                  {i18n.t('feed.top_buddy_badge')}
                </Text>
              </View>
            )}

            {creatorReliability === 'trusted' && (
              <View style={styles.reliabilityTrustedBadge}>
                <Text style={styles.reliabilityTrustedBadgeText}>
                  {i18n.t('job.signal_reliability_trusted')}
                </Text>
              </View>
            )}
            {creatorReliability === 'new' && (
              <View style={styles.reliabilityNewBadge}>
                <Text style={styles.reliabilityNewBadgeText}>
                  {i18n.t('job.signal_reliability_new')}
                </Text>
              </View>
            )}
          </View>
        )}

        {activeTab === 'angenommen' ? (
          job.status === 'open' ? (
            // Pending application — buddy waiting for owner confirmation
            <View style={styles.pendingBanner}>
              <Text style={styles.pendingBannerText}>
                {isEnglish ? 'Awaiting confirmation' : 'Anfrage ausstehend'}
              </Text>
            </View>
          ) : (
            <>
              {job.status === 'issue_reported' && (
                <View style={styles.issueStatusRow}>
                  <View style={styles.issueChip}>
                    <Text style={styles.issueChipText}>
                      {i18n.t('job.status_issue', { defaultValue: 'Problem gemeldet' })}
                    </Text>
                  </View>
                </View>
              )}
              <View style={styles.actionGroup}>
                <Pressable
                  style={styles.secondaryActionButton}
                  onPress={() => openChat(job)}
                >
                  <Text style={styles.secondaryActionButtonText}>
                    {i18n.t('common.chat')}
                  </Text>
                </Pressable>

                {job.status !== 'issue_reported' && (
                  <Pressable
                    style={styles.primaryActionButton}
                    onPress={() => completeJob(job)}
                  >
                    <Text style={styles.primaryActionButtonText}>
                      {i18n.t('common.done')}
                    </Text>
                  </Pressable>
                )}
              </View>
            </>
          )
        ) : null}
      </>
    );
  };

  const renderJobCard = (job: Job) => {
    const isPendingApplication =
      activeTab === 'angenommen' &&
      job.status === 'open' &&
      (job.match?.applications ?? []).some(
        (a) => a.buddyId === getActiveUserId() && a.requesterDecision === 'pending'
      );

    if (activeTab === 'offen' || isPendingApplication) {
      return (
        <Pressable
          key={job.id}
          style={({ pressed }) => [
            styles.card,
            styles.cardInteractive,
            pressed && styles.cardPressed,
          ]}
          onPress={() => openDetails(job)}
        >
          {renderCardContent(job)}
        </Pressable>
      );
    }

    return (
      <View key={job.id} style={styles.card}>
        {renderCardContent(job)}
      </View>
    );
  };

  return (
    <View style={styles.screenContainer}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>{i18n.t('job.jobs')}</Text>
        <Text style={styles.subtitle}>
          {i18n.t('job.radius_label')}: {buddyRadius} km
        </Text>

        <View style={styles.tabs}>
          <Pressable
            style={[styles.tab, styles.tabSide, activeTab === 'offen' && styles.activeTab]}
            onPress={() => setActiveTab('offen')}
          >
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[
                styles.tabText,
                activeTab === 'offen' && styles.activeTabText,
              ]}
            >
              {i18n.t('job.open')}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.tab, styles.tabMiddle, activeTab === 'angenommen' && styles.activeTab]}
            onPress={() => setActiveTab('angenommen')}
          >
            <View style={styles.tabContentRow}>
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={[
                  styles.tabText,
                  activeTab === 'angenommen' && styles.activeTabText,
                ]}
              >
                {i18n.t('job.accepted')}
              </Text>
              {(acceptedJobs.length + pendingApplicationJobs.length) > 0 && (
                <View
                  style={[
                    styles.tabCountBadge,
                    activeTab === 'angenommen' && styles.tabCountBadgeActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.tabCountText,
                      activeTab === 'angenommen' && styles.tabCountTextActive,
                    ]}
                  >
                    {acceptedJobs.length + pendingApplicationJobs.length}
                  </Text>
                </View>
              )}
            </View>
          </Pressable>

          <Pressable
            style={[styles.tab, styles.tabSide, activeTab === 'archiv' && styles.activeTab]}
            onPress={() => setActiveTab('archiv')}
          >
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[
                styles.tabText,
                activeTab === 'archiv' && styles.activeTabText,
              ]}
            >
              {i18n.t('job.archive')}
            </Text>
          </Pressable>
        </View>

        {activeTab === 'angenommen' ? (
          pendingApplicationJobs.length === 0 && acceptedJobs.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name={emptyState.iconName} size={36} color={colors.secondary} style={styles.emptyIcon} />
              <Text style={styles.emptyTitle}>{emptyState.title}</Text>
              <Text style={styles.emptyText}>{emptyState.hint}</Text>
              {emptyState.actionLabel && emptyState.onAction && (
                <Pressable
                  style={({ pressed }) => [styles.expandButton, pressed && styles.buttonPressed]}
                  onPress={emptyState.onAction}
                >
                  <Text style={styles.expandButtonText}>{emptyState.actionLabel}</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <>
              {pendingApplicationJobs.length > 0 && (
                <View style={styles.sectionWrap}>
                  <Text style={styles.sectionHeader}>
                    {isEnglish ? 'Waiting for confirmation' : 'Warten auf Bestätigung'}
                  </Text>
                  {pendingApplicationJobs.map((job) => renderJobCard(job))}
                </View>
              )}
              {acceptedJobs.length > 0 && (
                <View style={styles.sectionWrap}>
                  <Text style={styles.sectionHeader}>
                    {isEnglish ? 'Active' : 'Aktiv'}
                  </Text>
                  {acceptedJobs.map((job) => renderJobCard(job))}
                </View>
              )}
            </>
          )
        ) : currentJobs.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name={emptyState.iconName} size={36} color={colors.secondary} style={styles.emptyIcon} />
            <Text style={styles.emptyTitle}>{emptyState.title}</Text>
            <Text style={styles.emptyText}>{emptyState.hint}</Text>

            {emptyState.actionLabel && emptyState.onAction && !showRadiusSlider && (
              <Pressable
                style={({ pressed }) => [
                  styles.expandButton,
                  pressed && styles.buttonPressed,
                ]}
                onPress={emptyState.onAction}
              >
                <Text style={styles.expandButtonText}>{emptyState.actionLabel}</Text>
              </Pressable>
            )}

            {emptyState.supportsRadiusExpansion && showRadiusSlider && (
              <View style={styles.sliderContainer}>
                <Text style={styles.sliderLabel}>{tempRadius} km</Text>
                <Slider
                  minimumValue={1}
                  maximumValue={50}
                  step={1}
                  value={tempRadius}
                  onValueChange={setTempRadius}
                  style={styles.slider}
                  minimumTrackTintColor="#6761A8"
                  maximumTrackTintColor="#F2F2F2"
                  thumbTintColor="#6761A8"
                />
                <Pressable
                  style={({ pressed }) => [
                    styles.applyButton,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={() => {
                    updateRadius(tempRadius);
                    setShowRadiusSlider(false);
                  }}
                >
                  <Text style={styles.applyButtonText}>
                    {i18n.t('job.apply')}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        ) : activeTab === 'offen' ? (
          <>
            {sectionedOpenFeed.forYou.length > 0 && (
              <View style={styles.sectionWrap}>
                <Text style={styles.sectionHeader}>{i18n.t('feed.for_you')}</Text>
                {sectionedOpenFeed.forYou.map((job) => renderJobCard(job))}
              </View>
            )}

            {sectionedOpenFeed.hotJobs.length > 0 && (
              <View style={styles.sectionWrap}>
                <Text style={styles.sectionHeader}>{i18n.t('feed.hot_jobs')}</Text>
                {sectionedOpenFeed.hotJobs.map((job) => renderJobCard(job))}
              </View>
            )}

            {sectionedOpenFeed.nearby.length > 0 && (
              <View style={styles.sectionWrap}>
                <Text style={styles.sectionHeader}>{i18n.t('feed.nearby')}</Text>
                {sectionedOpenFeed.nearby.map((job) => renderJobCard(job))}
              </View>
            )}
          </>
        ) : (
          currentJobs.map((job) => renderJobCard(job))
        )}
      </ScrollView>

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

      <RecommendationModal
        visible={showRecommendationsModal}
        jobs={allJobs}
        onDismiss={() => setShowRecommendationsModal(false)}
        excludeJobId={completedJobId}
        buddyRadius={buddyRadius}
      />

      <Pressable
        style={({ pressed }) => [
          styles.myJobsFab,
          { bottom: insets.bottom + spacing.xxl },
          myActivePostedJobs.length > 0 && styles.myJobsFabActive,
          pressed && styles.myJobsFabPressed,
        ]}
        onPress={() => router.push('/my-posted-jobs')}
      >
        <Text style={[
          styles.myJobsFabIcon,
          myActivePostedJobs.length > 0 && styles.myJobsFabIconActive,
        ]}>
          📋
        </Text>
        {myActivePostedJobs.length > 0 && (
          <View style={styles.myJobsFabBadge}>
            <Text style={styles.myJobsFabBadgeText}>
              {myActivePostedJobs.length}
            </Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: layout.screenPaddingX,
    paddingBottom: layout.screenPaddingY,
  },
  title: {
    ...typography.screenTitle,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.bodyStrong,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  tabs: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  sectionWrap: {
    marginBottom: spacing.xl,
  },
  sectionHeader: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  tab: {
    minHeight: 48,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: layout.borderRadiusSmall,
    backgroundColor: colors.lightGrey,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabSide: {
    flex: 1,
  },
  tabMiddle: {
    flex: 1.16,
    paddingHorizontal: spacing.md,
  },
  tabContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minWidth: 0,
  },
  activeTab: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary,
  },
  tabText: {
    ...typography.buttonSecondary,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  activeTabText: {
    color: colors.card,
  },
  tabCountBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 999,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.veryLightPurple,
    borderWidth: 1,
    borderColor: colors.overlayLightPurple,
  },
  tabCountBadgeActive: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderColor: 'rgba(255,255,255,0.3)',
  },
  tabCountText: {
    ...typography.metaStrong,
    color: colors.secondary,
    lineHeight: 14,
  },
  tabCountTextActive: {
    color: colors.card,
  },
  emptyState: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    paddingHorizontal: layout.cardPadding,
    paddingVertical: spacing.xxxl,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  emptyTitle: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
    textAlign: 'center',
  },
  emptyIcon: {
    marginBottom: spacing.md,
  },
  sliderContainer: {
    marginTop: spacing.xl,
    alignItems: 'center',
  },
  sliderLabel: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  slider: {
    width: '80%',
  },
  expandButton: {
    backgroundColor: colors.secondary,
    borderRadius: 10,
    paddingVertical: spacing.md,
    paddingHorizontal: layout.cardPadding,
    alignItems: 'center',
    marginTop: spacing.lg,
    minWidth: 180,
  },
  expandButtonText: {
    color: colors.card,
    ...typography.button,
  },
  applyButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: spacing.md,
    paddingHorizontal: layout.cardPadding,
    alignItems: 'center',
    marginTop: spacing.lg,
    minWidth: 160,
  },
  buttonPressed: {
    opacity: 0.94,
    transform: [{ scale: 0.992 }],
  },
  applyButtonText: {
    color: colors.card,
    ...typography.button,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    padding: spacing.lg,
    marginBottom: layout.cardMarginBottom,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardInteractive: {
    marginBottom: spacing.xl,
  },
  cardPressed: {
    opacity: 0.98,
    transform: [{ scale: 0.992 }],
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
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  problemBlock: {
    flex: 1,
    gap: spacing.sm,
  },
  creatorTitle: {
    color: colors.textSecondary,
    ...typography.meta,
  },
  pricePill: {
    backgroundColor: colors.lightOrange,
    borderRadius: 999,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FFD4C7',
    minWidth: 94,
  },
  creatorTrustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    flexWrap: 'wrap',
  },
  statusBadge: {
    backgroundColor: colors.veryLightGrey,
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.lightBorder,
  },
  statusBadgeText: {
    color: colors.textPrimary,
    ...typography.meta,
    fontWeight: '600',
  },
  creatorLevelBadge: {
    backgroundColor: colors.lightOrange,
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  creatorLevelBadgeText: {
    color: colors.primary,
    ...typography.meta,
    fontWeight: '700',
  },
  ratingText: {
    color: colors.textSecondary,
    ...typography.meta,
  },
  topBuddyBadge: {
    backgroundColor: colors.lightOrange,
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  topBuddyBadgeText: {
    color: colors.primary,
    ...typography.meta,
    fontWeight: '700',
  },
  problemText: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 24,
  },
  priceText: {
    color: colors.primary,
    fontSize: 22,
    fontWeight: '800',
  },
  highPriceText: {
    fontSize: 24,
  },
  metaChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  smartBadgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  smartBadge: {
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  smartBadgeMatch: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary,
  },
  smartBadgeNow: {
    backgroundColor: colors.lightOrange,
    borderColor: '#FFD4C7',
  },
  smartBadgeFlexible: {
    backgroundColor: colors.veryLightPurple,
    borderColor: colors.overlayLightPurple,
  },
  smartBadgeScheduled: {
    backgroundColor: colors.veryLightGrey,
    borderColor: colors.lightBorder,
  },
  smartBadgeHot: {
    backgroundColor: colors.purpleBadge,
    borderColor: colors.overlayLightPurple,
  },
  smartBadgeText: {
    ...typography.meta,
    fontWeight: '700',
  },
  smartBadgeTextMatch: {
    color: colors.card,
  },
  smartBadgeTextNow: {
    color: colors.primary,
  },
  smartBadgeTextFlexible: {
    color: colors.secondary,
  },
  smartBadgeTextScheduled: {
    color: colors.textSecondary,
  },
  smartBadgeTextHot: {
    color: colors.secondary,
  },
  metaChip: {
    backgroundColor: colors.veryLightGrey,
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metaChipText: {
    color: colors.textSecondary,
    ...typography.meta,
  },
  actionGroup: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  secondaryActionButton: {
    flex: 1,
    backgroundColor: colors.secondary,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  secondaryActionButtonText: {
    color: colors.card,
    ...typography.buttonSecondary,
  },
  primaryActionButton: {
    flex: 1,
    backgroundColor: colors.alternateGreen,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  primaryActionButtonText: {
    color: colors.card,
    ...typography.buttonSecondary,
  },
  myJobsFab: {
    position: 'absolute',
    right: layout.screenPaddingX,
    width: 48,
    height: 48,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
    zIndex: 20,
    opacity: 0.8,
  },
  myJobsFabActive: {
    opacity: 1,
    borderColor: colors.secondary,
    borderWidth: 1.5,
    shadowOpacity: 0.16,
    shadowRadius: 12,
  },
  myJobsFabPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.94 }],
  },
  myJobsFabIcon: {
    fontSize: 20,
  },
  myJobsFabIconActive: {
    fontSize: 22,
  },
  myJobsFabBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: colors.background,
  },
  myJobsFabBadgeText: {
    color: colors.card,
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 13,
  },
  issueStatusRow: {
    marginBottom: spacing.sm,
    alignItems: 'flex-start',
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
  reliabilityTrustedBadge: {
    backgroundColor: '#F0FFF4',
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  reliabilityTrustedBadgeText: {
    color: colors.green,
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 14,
  },
  reliabilityNewBadge: {
    backgroundColor: colors.veryLightGrey,
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reliabilityNewBadgeText: {
    color: colors.placeholder,
    fontSize: 10,
    fontWeight: '500',
    lineHeight: 14,
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
  pendingBanner: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.veryLightPurple,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.overlayLightPurple,
    alignSelf: 'flex-start',
  },
  pendingBannerText: {
    ...typography.meta,
    color: colors.secondary,
    fontWeight: '600',
  },
});