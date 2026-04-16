import {
  createEmptyWalletSnapshot,
  loadWalletSnapshot,
  recordJobCompletionEarning,
  WalletSnapshot,
} from '@/lib/wallet';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../lib/colors';
import { DEV_USERS, getActiveDevUserId, useDevSession } from '../../lib/dev-session';
import i18n, { getLanguage, setLanguage, useLanguage } from '../../lib/i18n';
import { isJobChatAccessible } from '../../lib/job-actions';
import { getActiveOwnJobs, getBuddyPointsForJob, getMatchedBuddyId, getMatchedBuddyName, isActiveJobStatus, isEligibleForRebooking, Job } from '../../lib/jobs';
import { getLevelInfo } from '../../lib/levels';
import { applyPaymentStateForJobStatus, ensureJobPaymentState } from '../../lib/payments';
import {
  loadUserPreferences,
  UserPreferences,
} from '../../lib/preferences';
import { loadPreferredBuddies, PreferredBuddy } from '../../lib/preferred-buddies';
import { getNormalizedJobReviews, getReviewEligibility, toLegacyJobReview } from '../../lib/reviews';
import { layout, spacing } from '../../lib/spacing';
import { getTrustStarFillRatio } from '../../lib/trust';
import { typography } from '../../lib/typography';
import { loadUserProfile, updateUserProfile } from '../../lib/user-profile';

type ProfileSnapshot = {
  allJobs: Job[];
  acceptedJobs: Job[];
  completedJobs: Job[];
  ownPostedJobs: Job[];
  score: number;
  preferences: UserPreferences | null;
  preferredBuddies: PreferredBuddy[];
  profileImageUri: string | null;
  bio: string;
  wallet: WalletSnapshot;
};

const loadProfileSnapshot = async (): Promise<ProfileSnapshot> => {
  const [jobsRaw, scoreRaw, userProfile, loadedPreferences, loadedPreferredBuddies] =
    await Promise.all([
      AsyncStorage.getItem('jobs'),
      AsyncStorage.getItem('buddyScore'),
      loadUserProfile(),
      loadUserPreferences(),
      loadPreferredBuddies(),
    ]);

  const parsedJobs = jobsRaw ? JSON.parse(jobsRaw) : [];
  const safeJobs: Job[] = Array.isArray(parsedJobs) ? parsedJobs : [];
  const acceptedJobs = safeJobs.filter((job: Job) => isActiveJobStatus(job.status));
  const completedJobs = safeJobs.filter((job: Job) => job.status === 'completed');
  const ownPostedJobs = getActiveOwnJobs(safeJobs, getActiveDevUserId());
  const parsedScore = scoreRaw ? Number(scoreRaw) : 0;
  const wallet = await loadWalletSnapshot(completedJobs);

  return {
    allJobs: safeJobs,
    acceptedJobs,
    completedJobs,
    ownPostedJobs,
    score: Number.isFinite(parsedScore) ? parsedScore : 0,
    preferences: loadedPreferences,
    preferredBuddies: loadedPreferredBuddies,
    profileImageUri: userProfile.profileImageUri,
    bio: userProfile.bio,
    wallet,
  };
};

export default function ProfileScreen() {
  useLanguage();
  const insets = useSafeAreaInsets();
  const currentLanguage = getLanguage();
  const { activeUser, switchUser } = useDevSession();
  const [allJobs, setAllJobs] = useState<Job[]>([]);
  const [acceptedJobs, setAcceptedJobs] = useState<Job[]>([]);
  const [completedJobs, setCompletedJobs] = useState<Job[]>([]);
  const [ownPostedJobs, setOwnPostedJobs] = useState<Job[]>([]);
  const [score, setScore] = useState(0);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [preferredBuddies, setPreferredBuddies] = useState<PreferredBuddy[]>([]);
  const [profileImageUri, setProfileImageUri] = useState<string | null>(null);
  const [bio, setBio] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isCompletedJobsExpanded, setIsCompletedJobsExpanded] = useState(false);
  const [wallet, setWallet] = useState<WalletSnapshot>(createEmptyWalletSnapshot());

  const loadProfileData = async () => {
    try {
      setIsLoading(true);
      const snapshot = await loadProfileSnapshot();

      setAllJobs(snapshot.allJobs);
      setAcceptedJobs(snapshot.acceptedJobs);
      setCompletedJobs(snapshot.completedJobs);
      setOwnPostedJobs(snapshot.ownPostedJobs);
      setScore(snapshot.score);
      setPreferences(snapshot.preferences);
      setPreferredBuddies(snapshot.preferredBuddies);
      setProfileImageUri(snapshot.profileImageUri);
      setBio(snapshot.bio);
      setWallet(snapshot.wallet);
    } catch (error) {
      console.error('Fehler beim Laden des Profils:', error);
      setAcceptedJobs([]);
      setCompletedJobs([]);
      setOwnPostedJobs([]);
      setScore(0);
      setPreferences(null);
      setPreferredBuddies([]);
      setProfileImageUri(null);
      setBio('');
      setWallet(createEmptyWalletSnapshot());
    } finally {
      setIsLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadProfileData();
    }, [])
  );

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
      const parsedJobs = jobsRaw ? JSON.parse(jobsRaw) : [];
      const safeJobs: Job[] = Array.isArray(parsedJobs) ? parsedJobs : [];

      const updatedJobs = safeJobs.map((j) =>
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
      const updatedScore = currentScore + getBuddyPointsForJob(job);

      await AsyncStorage.setItem('jobs', JSON.stringify(updatedJobs));
      await AsyncStorage.setItem('buddyScore', updatedScore.toString());
      await recordJobCompletionEarning(job);

      loadProfileData(); // Reload to update the lists
      router.push({
        pathname: '/review/[jobId]',
        params: {
          jobId: job.id,
          currentUserRole: 'buddy',
        },
      });
    } catch (error) {
      console.error('Error completing job:', error);
      alert(i18n.t('job.job_complete_error'));
    }
  };

  const switchLanguage = async (lang: 'de' | 'en') => {
    setLanguage(lang);
    await AsyncStorage.setItem('appLanguage', lang);
    router.replace('/(tabs)/profile');
  };

  const pickProfileImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        alert(i18n.t('profile.avatar_permission_denied'));
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled || !result.assets?.[0]?.uri) return;

      const uri = result.assets[0].uri;
      setProfileImageUri(uri);
      await updateUserProfile({ profileImageUri: uri });
    } catch (error) {
      console.error('Error picking profile image:', error);
      alert(i18n.t('profile.avatar_update_error'));
    }
  };

  const getStatusLabel = (status: string): string => {
    const statusKey = `profile.status_${status}`;
    return i18n.t(statusKey);
  };

  const getStatusExplainer = (status: string): string => {
    const statusKey = `profile.status_explainer_${status}`;
    return i18n.t(statusKey);
  };

  const getReviewReceivedForBuddy = (job: Job) => {
    const byRole = getNormalizedJobReviews(job).find(
      (entry) => entry.revieweeRole === 'buddy'
    );
    return toLegacyJobReview(byRole) ?? job.review;
  };

  const getReviewSentByBuddy = (job: Job) => {
    return getNormalizedJobReviews(job).find(
      (entry) => entry.reviewerRole === 'buddy' && entry.revieweeRole === 'auftraggeber'
    );
  };

  const reviewJobs = completedJobs
    .map((job) => ({
      job,
      review: getReviewReceivedForBuddy(job),
    }))
    .filter((entry) => Boolean(entry.review));
  const reviewCount = reviewJobs.length;
  const averageRating =
    reviewCount > 0
      ? reviewJobs.reduce((sum, entry) => sum + (entry.review?.rating ?? 0), 0) / reviewCount
      : 0;
  const recentReviews = reviewJobs
    .slice()
    .sort(
      (a, b) =>
        new Date(b.review?.reviewedAt ?? 0).getTime() -
        new Date(a.review?.reviewedAt ?? 0).getTime()
    )
    .slice(0, 2);

  const levelInfo = getLevelInfo(score);
  const pointsToNextLevel =
    levelInfo.nextLevelThreshold !== null
      ? Math.max(0, levelInfo.nextLevelThreshold - score)
      : null;
  const trustSummaryLabel =
    reviewCount > 0
      ? i18n.t('profile.rating_with_count_compact', {
          rating: averageRating.toFixed(1),
          count: reviewCount,
        })
      : i18n.t('profile.no_reviews_hint');
  const trustStarFillRatio = getTrustStarFillRatio(averageRating, reviewCount);
  const completedJobsSummary =
    reviewCount > 0
      ? i18n.t('profile.completed_jobs_summary_with_reviews', {
          count: completedJobs.length,
          reviews: reviewCount,
        })
      : i18n.t('profile.completed_jobs_summary', {
          count: completedJobs.length,
        });

  const formatMoney = (amount: number) => {
    return new Intl.NumberFormat(currentLanguage === 'en' ? 'en-US' : 'de-DE', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const formatReviewDate = (date: string) =>
    new Date(date).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

  const getCreatorAverageRating = (job: Job): number | null => {
    if (!job.creatorReviews || job.creatorReviews.length === 0) return null;
    return job.creatorReviews.reduce((sum, rev) => sum + rev.rating, 0) / job.creatorReviews.length;
  };

  const getCreatorReviewCount = (job: Job): number => {
    return job.creatorReviews?.length ?? 0;
  };

  const isTopBuddy = (rating: number | null, reviewCount: number): boolean => {
    return rating !== null && rating >= 4.7 && reviewCount >= 5;
  };

  const hasBio = bio.trim().length > 0;
  const visibleSkills = preferences?.skills ?? [];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + spacing.md,
          paddingBottom: Math.max(insets.bottom + spacing.xl, layout.screenPaddingY),
        },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>{i18n.t('profile.profile')}</Text>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>{i18n.t('common.loading_job')}</Text>
        </View>
      ) : (<>

      <View style={styles.identityCard}>
        <View style={styles.identityMainRow}>
          <Pressable style={styles.avatarWrap} onPress={pickProfileImage}>
            <View style={styles.avatar}>
              {profileImageUri ? (
                <Image source={{ uri: profileImageUri }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarText}>V</Text>
              )}
            </View>
            <View style={styles.avatarEditBadge}>
              <Text style={styles.avatarEditBadgeText}>✎</Text>
            </View>
          </Pressable>

          <View style={styles.identityMeta}>
            <Text style={styles.name} numberOfLines={1}>
              Vincent
            </Text>
            <Text style={styles.identitySubtitle} numberOfLines={2}>
              {i18n.t('profile.identity_subtitle')}
            </Text>
            <View style={styles.identityLevelRow}>
              <View style={styles.identityStatusPill}>
                <Text style={styles.identityStatusPillText}>{getStatusLabel(levelInfo.status)}</Text>
              </View>
              <View style={styles.identityLevelPill}>
                <Text style={styles.identityLevelPillText}>
                  {i18n.t('profile.level_label')} {levelInfo.level}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.scorePill}>
            <Text style={styles.scorePillLabel}>{i18n.t('profile.buddy_score')}</Text>
            <Text style={styles.scorePillValue}>{score}</Text>
          </View>
        </View>

        <View style={styles.identitySupportBlock}>
          {pointsToNextLevel !== null && (
            <Text style={styles.identityProgressHint}>
              {i18n.t('profile.points_to_next_level', {
                points: pointsToNextLevel,
                nextLevel: levelInfo.level + 1,
              })}
            </Text>
          )}
          <View style={styles.identityTrustRow}>
            <View style={styles.trustStarWrap}>
              <Text style={styles.trustStarBase}>★</Text>
              <View
                style={[
                  styles.trustStarFillClip,
                  { width: `${Math.max(0, Math.min(1, trustStarFillRatio)) * 100}%` },
                ]}
              >
                <Text style={styles.trustStarFill}>★</Text>
              </View>
            </View>
            <Text
              style={styles.identityRatingText}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {trustSummaryLabel}
            </Text>
            {isTopBuddy(averageRating, reviewCount) && (
              <View style={styles.topBuddyBadge}>
                <Text style={styles.topBuddyBadgeText}>{i18n.t('feed.top_buddy_badge')}</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      <View style={styles.levelCard}>
        <View style={styles.levelHeader}>
          <View>
            <Text style={styles.levelValue}>
              {i18n.t('profile.level_label')} {levelInfo.level}
            </Text>
            <Text style={styles.statusValue}>
              {getStatusLabel(levelInfo.status)}
            </Text>
          </View>
          <View style={styles.levelBadge}>
            <Text style={styles.levelBadgeText}>{levelInfo.level}</Text>
          </View>
        </View>

        <View style={styles.progressSummaryRow}>
          <Text style={styles.progressSummaryText}>
            {i18n.t('profile.progress_points_now', { points: score })}
          </Text>
          {levelInfo.nextLevelThreshold !== null && (
            <Text style={styles.progressSummaryText}>
              {i18n.t('profile.progress_next_level_label', {
                nextLevel: levelInfo.level + 1,
              })}
            </Text>
          )}
        </View>
        <Text style={styles.statusExplainerText}>{getStatusExplainer(levelInfo.status)}</Text>

        {levelInfo.nextLevelThreshold !== null && (
          <View style={styles.progressSection}>
            <Text style={styles.progressLabel}>
              {i18n.t('profile.progress_to_next')}
            </Text>
            <View style={styles.progressBarContainer}>
              <View
                style={[
                  styles.progressBar,
                  { width: `${levelInfo.progressPercentage}%` },
                ]}
              />
            </View>
            <Text style={styles.progressText}>
              {i18n.t('profile.points_to_next_level', {
                points: levelInfo.nextLevelThreshold - score,
                nextLevel: levelInfo.level + 1,
              })}
            </Text>
          </View>
        )}

        {levelInfo.nextLevelThreshold === null && (
          <View style={styles.progressSection}>
            <Text style={styles.maxLevelText}>
              {i18n.t('profile.max_level')}
            </Text>
          </View>
        )}
      </View>

      {hasBio && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{i18n.t('profile.about_me')}</Text>
          <View style={styles.bioBlock}>
            <Text style={styles.bioText}>{bio}</Text>
          </View>
          <Pressable
            style={styles.bioEditButton}
            onPress={() => router.push('/edit-bio')}
          >
            <Text style={styles.bioEditButtonText}>{i18n.t('profile.edit_about_me')}</Text>
          </Pressable>
        </View>
      )}

      {!hasBio && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{i18n.t('profile.profile_richness_title')}</Text>
          <View style={styles.emptyStateCard}>
            <Text style={styles.emptyText}>{i18n.t('profile.profile_richness_hint')}</Text>
          </View>
          <Pressable
            style={styles.bioEditButton}
            onPress={() => router.push('/edit-bio')}
          >
            <Text style={styles.bioEditButtonText}>{i18n.t('profile.edit_about_me')}</Text>
          </Pressable>
        </View>
      )}

      {visibleSkills.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{i18n.t('profile.strengths')}</Text>
          <View style={styles.strengthsWrap}>
            {visibleSkills.map((skill) => (
              <View key={skill} style={styles.strengthChip}>
                <Text style={styles.strengthChipText}>
                  {i18n.t(`preferences.categories.${skill}`)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{i18n.t('profile.your_stats')}</Text>

        <View style={styles.statsGrid}>
          <Pressable
            style={styles.statTile}
            onPress={() => router.push('/active-jobs')}
          >
            <Text style={styles.statValue}>{acceptedJobs.length}</Text>
            <Text
              style={styles.statLabel}
              numberOfLines={1}
              ellipsizeMode="tail"
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {i18n.t('profile.jobs_accepted')}
            </Text>
          </Pressable>

          <View style={styles.statTile}>
            <Text style={styles.statValue}>{completedJobs.length}</Text>
            <Text
              style={styles.statLabel}
              numberOfLines={1}
              ellipsizeMode="tail"
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {i18n.t('profile.jobs_completed')}
            </Text>
          </View>

          <View style={styles.statTile}>
            <Text style={styles.statValue}>{score}</Text>
            <Text
              style={styles.statLabel}
              numberOfLines={1}
              ellipsizeMode="tail"
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {i18n.t('profile.points')}
            </Text>
          </View>
        </View>
      </View>

      <Pressable
        style={styles.activeJobsHeader}
        onPress={() => router.push('/my-posted-jobs')}
      >
        <View style={styles.activeJobsHeaderLeft}>
          <Text style={styles.activeJobsTitle}>Meine Aufträge</Text>
          {ownPostedJobs.length > 0 && (
            <View style={styles.activeJobsCountBadge}>
              <Text style={styles.activeJobsCountText}>{ownPostedJobs.length}</Text>
            </View>
          )}
        </View>
        <Text style={styles.activeJobsChevron}>›</Text>
      </Pressable>

      <Pressable
        style={styles.walletEntryCard}
        onPress={() => router.push('/wallet')}
      >
        <View style={styles.walletEntryMain}>
          <Text style={styles.walletEntryTitle}>{i18n.t('wallet.title')}</Text>
          <Text style={styles.walletEntryHint}>{i18n.t('wallet.compact_hint')}</Text>
        </View>
        <View style={styles.walletEntryAmountWrap}>
          <Text style={styles.walletEntryAmount}>{formatMoney(wallet.availableBalance)}</Text>
          <Text style={styles.walletEntryChevron}>›</Text>
        </View>
      </Pressable>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{i18n.t('profile.review_summary')}</Text>
        {reviewCount > 0 ? (
          <>
            <Text style={styles.info}>
              {i18n.t('profile.average_rating', {
                rating: averageRating.toFixed(1),
              })}
            </Text>
            <Text style={styles.info}>
              {i18n.t('profile.total_reviews', { count: reviewCount })}
            </Text>
            {recentReviews.length > 0 && (
              <View style={styles.recentReviews}>
                <Text style={styles.recentReviewsTitle}>
                  {i18n.t('profile.recent_reviews')}
                </Text>
                {recentReviews.map((entry) => (
                  <View key={entry.job.id} style={styles.reviewRow}>
                    <Text style={styles.reviewStars}>
                      {'★'.repeat(entry.review?.rating ?? 0)}{'☆'.repeat(5 - (entry.review?.rating ?? 0))}
                    </Text>
                    <Text style={styles.reviewMeta}>
                      {i18n.t('profile.review_by', {
                        name: entry.review?.reviewerName ?? i18n.t('common.default_user_name'),
                      })}{' '}
                      {i18n.t('profile.reviewed_on', {
                        date: formatReviewDate(entry.review?.reviewedAt ?? new Date().toISOString()),
                      })}
                    </Text>
                    {entry.review?.reviewText ? (
                      <Text style={styles.reviewText}>{entry.review.reviewText}</Text>
                    ) : null}
                  </View>
                ))}
              </View>
            )}
          </>
        ) : (
          <View style={styles.emptyStateCard}>
            <Text style={styles.emptyStateTitle}>{i18n.t('profile.no_reviews_title')}</Text>
            <Text style={styles.emptyText}>{i18n.t('profile.no_reviews_hint')}</Text>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{i18n.t('profile.your_buddies')}</Text>

        {preferredBuddies.length === 0 ? (
          <View style={styles.emptyStateCard}>
            <Text style={styles.emptyText}>{i18n.t('profile.no_buddies')}</Text>
          </View>
        ) : (
          preferredBuddies.map((buddy) => (
            <View key={buddy.id} style={styles.buddyRow}>
              <View style={styles.buddyAvatar}>
                <Text style={styles.buddyAvatarText}>
                  {buddy.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={styles.buddyMeta}>
                <Text style={styles.buddyName}>{buddy.name}</Text>
                <Text style={styles.buddySubline}>
                  {i18n.t('profile.jobs_together', { count: buddy.jobsWorked })}
                </Text>
              </View>
              <Pressable
                style={styles.rebookButton}
                onPress={() =>
                  router.push({
                    pathname: '/(tabs)/create',
                    params: {
                      rebookBuddyId: buddy.id,
                      rebookBuddyName: buddy.name,
                      rebookJobsWorked: String(buddy.jobsWorked),
                    },
                  })
                }
              >
                <Text style={styles.rebookButtonText}>
                  {i18n.t('rebooking.rebook_buddy')}
                </Text>
              </Pressable>
            </View>
          ))
        )}
      </View>

      <Pressable
        style={styles.activeJobsHeader}
        onPress={() => router.push('/active-jobs')}
      >
        <View style={styles.activeJobsHeaderLeft}>
          <Text style={styles.activeJobsTitle}>{i18n.t('profile.active_jobs_section')}</Text>
          {acceptedJobs.length > 0 && (
            <View style={styles.activeJobsCountBadge}>
              <Text style={styles.activeJobsCountText}>{acceptedJobs.length}</Text>
            </View>
          )}
        </View>
        <Text style={styles.activeJobsChevron}>›</Text>
      </Pressable>

      {completedJobs.length > 0 && (
        <View style={styles.card}>
          <Pressable
            style={styles.completedJobsHeader}
            onPress={() => setIsCompletedJobsExpanded((current) => !current)}
          >
            <View style={styles.completedJobsHeaderMain}>
              <View style={styles.completedJobsHeaderTopRow}>
                <Text style={styles.sectionTitle}>{i18n.t('profile.completed_jobs')}</Text>
                <View style={styles.completedJobsCountBadge}>
                  <Text style={styles.completedJobsCountText}>{completedJobs.length}</Text>
                </View>
              </View>
              <Text style={styles.completedJobsSummary}>{completedJobsSummary}</Text>
            </View>
            <Text style={styles.completedJobsChevron}>
              {isCompletedJobsExpanded ? '⌃' : '⌄'}
            </Text>
          </Pressable>

          {isCompletedJobsExpanded && (
            <View style={styles.completedJobsList}>
              {completedJobs.map((job) => (
                <View key={job.id} style={styles.jobRow}>
                  <View style={styles.jobTextWrap}>
                    <Text style={styles.jobProblem}>{job.problem}</Text>
                    <Text style={styles.jobMeta}>
                      {job.price}€ • {job.time}
                    </Text>
                    {getCreatorAverageRating(job) !== null && getCreatorReviewCount(job) > 0 && (
                      <View style={styles.completedTrustRow}>
                        <Text style={styles.completedTrustText}>
                          {i18n.t('feed.rating_compact', {
                            rating: getCreatorAverageRating(job)!.toFixed(1),
                            count: getCreatorReviewCount(job),
                          })}
                        </Text>
                        {isTopBuddy(getCreatorAverageRating(job), getCreatorReviewCount(job)) && (
                          <View style={styles.topBuddyBadgeSmall}>
                            <Text style={styles.topBuddyBadgeSmallText}>{i18n.t('feed.top_buddy_badge')}</Text>
                          </View>
                        )}
                      </View>
                    )}
                    {getReviewEligibility(job, 'buddy').state === 'already_reviewed' ? (
                      <View style={styles.reviewSummaryRow}>
                        <Text style={styles.reviewStars}>
                          {'★'.repeat(getReviewSentByBuddy(job)?.rating ?? 0)}{'☆'.repeat(5 - (getReviewSentByBuddy(job)?.rating ?? 0))}
                        </Text>
                        <Text style={styles.reviewMeta}>
                          {i18n.t('profile.reviewed_on', {
                            date: formatReviewDate(
                              getReviewSentByBuddy(job)?.reviewedAt ?? new Date().toISOString()
                            ),
                          })}
                        </Text>
                      </View>
                    ) : getReviewEligibility(job, 'buddy').state === 'available' ? (
                      <Pressable
                        style={styles.reviewButton}
                        onPress={() =>
                          router.push({
                            pathname: '/review/[jobId]',
                            params: {
                              jobId: job.id,
                              currentUserRole: 'buddy',
                            },
                          })
                        }
                      >
                        <Text style={styles.reviewButtonText}>{i18n.t('profile.leave_review')}</Text>
                      </Pressable>
                    ) : null}
                    {isEligibleForRebooking(job) && (
                      <>
                        <View style={styles.rebookBuddyChip}>
                          <View style={styles.rebookBuddyChipDot} />
                          <Text style={styles.rebookBuddyChipText}>
                            {i18n.t('rebooking.context_verified')} · {getMatchedBuddyName(job)}
                          </Text>
                        </View>
                        <Pressable
                          style={styles.rebookJobButton}
                          onPress={() =>
                            router.push({
                              pathname: '/(tabs)/create',
                              params: {
                                rebookBuddyId: getMatchedBuddyId(job) ?? '',
                                rebookBuddyName: getMatchedBuddyName(job) ?? '',
                                rebookSourceJobId: job.id,
                              },
                            })
                          }
                        >
                          <Text style={styles.rebookJobButtonText}>
                            {i18n.t('rebooking.rebook_buddy')}
                          </Text>
                        </Pressable>
                      </>
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{i18n.t('preferences.title')}</Text>
        <Text style={styles.preferenceSummary}>
          {preferences && preferences.onboardingCompleted
            ? i18n.t('profile.preferences_ready')
            : i18n.t('profile.preferences_not_set')}
        </Text>

        <Pressable
          style={styles.preferencesButton}
          onPress={() =>
            router.push({ pathname: '/preferences', params: { mode: 'settings' } })
          }
        >
          <Text style={styles.preferencesButtonText}>
            {preferences && preferences.onboardingCompleted
              ? i18n.t('profile.edit_preferences')
              : i18n.t('profile.setup_preferences')}
          </Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{i18n.t('profile.settings')}</Text>

        <Pressable
          style={styles.settingRow}
          onPress={() =>
            router.push({ pathname: '/preferences', params: { mode: 'settings' } })
          }
        >
          <Text style={styles.settingText}>
            {i18n.t('profile.personality_settings')}
          </Text>
          <Text style={styles.settingChevron}>›</Text>
        </Pressable>

        <Pressable
          style={styles.settingRow}
          onPress={() => router.push('/edit-bio')}
        >
          <Text style={styles.settingText}>{i18n.t('profile.edit_about_me')}</Text>
          <Text style={styles.settingChevron}>›</Text>
        </Pressable>

        <Pressable
          style={styles.settingRow}
          onPress={() => router.push('/notifications-settings')}
        >
          <Text style={styles.settingText}>{i18n.t('profile.notifications')}</Text>
          <Text style={styles.settingChevron}>›</Text>
        </Pressable>

        <Pressable
          style={styles.settingRow}
          onPress={() => router.push('/location-settings')}
        >
          <Text style={styles.settingText}>{i18n.t('profile.location')}</Text>
          <Text style={styles.settingChevron}>›</Text>
        </Pressable>

        <Pressable style={styles.settingRow}>
          <Text style={styles.settingText}>{i18n.t('profile.support')}</Text>
          <Text style={styles.settingChevron}>›</Text>
        </Pressable>

        <View style={styles.languageWrap}>
          <Text style={styles.languageTitle}>{i18n.t('profile.language')}</Text>

          <View style={styles.languageButtons}>
            <Pressable
              style={[
                styles.languageButton,
                currentLanguage === 'de' && styles.languageButtonActive,
              ]}
              onPress={() => switchLanguage('de')}
            >
              <Text
                style={[
                  styles.languageButtonText,
                  currentLanguage === 'de' && styles.languageButtonTextActive,
                ]}
              >
                DE
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.languageButton,
                currentLanguage === 'en' && styles.languageButtonActive,
              ]}
              onPress={() => switchLanguage('en')}
            >
              <Text
                style={[
                  styles.languageButtonText,
                  currentLanguage === 'en' && styles.languageButtonTextActive,
                ]}
              >
                EN
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      <View style={styles.devCard}>
        <Text style={styles.devSectionTitle}>Dev — Active User</Text>
        <View style={styles.devUserRow}>
          {DEV_USERS.map((u) => (
            <Pressable
              key={u.id}
              style={[styles.devUserButton, activeUser.id === u.id && styles.devUserButtonActive]}
              onPress={async () => { await switchUser(u.id); loadProfileData(); }}
            >
              <Text style={[styles.devUserButtonText, activeUser.id === u.id && styles.devUserButtonTextActive]}>
                {u.label}
              </Text>
              <Text style={styles.devUserButtonSub}>{u.name} · {u.role}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.devDebugPanel}>
          <Text style={styles.devSectionTitle}>Job State ({allJobs.length})</Text>
          {allJobs.map((job) => (
            <Text key={job.id} style={styles.devLine}>
              [{job.status}] {job.problem.slice(0, 32)}{job.requesterId === activeUser.id ? ' (owner)' : ''}
            </Text>
          ))}
          {allJobs.length === 0 && <Text style={styles.devLine}>No jobs</Text>}
        </View>
      </View>

      </>)}

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: layout.screenPaddingX,
  },
  title: {
    ...typography.screenTitle,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  loadingContainer: {
    flex: 1,
    paddingTop: spacing.xxl * 2,
    alignItems: 'center',
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  identityCard: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    padding: spacing.md,
    marginBottom: spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    borderWidth: 1,
    borderColor: colors.lightGrey,
  },
  identityMainRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  avatarWrap: {
    marginRight: spacing.sm,
    paddingTop: spacing.xs,
  },
  avatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarText: {
    color: colors.card,
    ...typography.sectionTitle,
  },
  avatarEditBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.lightGrey,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  avatarEditBadgeText: {
    ...typography.meta,
    color: colors.secondary,
    fontWeight: '700',
    lineHeight: 14,
  },
  identityMeta: {
    flex: 1,
    minWidth: 0,
    paddingTop: spacing.xs,
  },
  name: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  identitySubtitle: {
    ...typography.meta,
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 18,
  },
  sublineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  subline: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  sublineDot: {
    ...typography.meta,
    color: colors.textSecondary,
    marginHorizontal: spacing.xs,
  },
  identityLevelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  identityStatusPill: {
    backgroundColor: colors.veryLightGrey,
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.lightBorder,
  },
  identityStatusPillText: {
    ...typography.meta,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  identityLevelPill: {
    backgroundColor: colors.lightOrange,
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  identityLevelPillText: {
    ...typography.meta,
    color: colors.primary,
    fontWeight: '700',
  },
  identityProgressHint: {
    ...typography.meta,
    color: colors.textSecondary,
    marginTop: 0,
    lineHeight: 18,
  },
  identitySupportBlock: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.veryLightGrey2,
    gap: spacing.xs,
  },
  identityTrustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 0,
  },
  trustStarWrap: {
    width: 16,
    height: 16,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trustStarBase: {
    position: 'absolute',
    color: colors.border,
    fontSize: 15,
    lineHeight: 16,
  },
  trustStarFillClip: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  trustStarFill: {
    color: colors.yellow,
    fontSize: 15,
    lineHeight: 16,
  },
  identityRatingText: {
    flex: 1,
    ...typography.meta,
    color: colors.textPrimary,
  },
  avatarHint: {
    ...typography.meta,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  scorePill: {
    backgroundColor: colors.veryLightPurple,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'flex-start',
    justifyContent: 'center',
    minWidth: 92,
    marginLeft: spacing.md,
    borderWidth: 1,
    borderColor: colors.overlayLightPurple,
  },
  scorePillLabel: {
    ...typography.meta,
    color: colors.secondary,
  },
  scorePillValue: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    marginTop: 2,
  },
  levelCard: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    borderWidth: 1,
    borderColor: colors.lightGrey,
  },
  levelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  levelValue: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  statusValue: {
    ...typography.metaStrong,
    color: colors.secondary,
  },
  levelBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelBadgeText: {
    color: colors.card,
    ...typography.sectionTitle,
  },
  progressSummaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  progressSummaryText: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  statusExplainerText: {
    ...typography.body,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    lineHeight: 22,
  },
  progressSection: {
    marginTop: spacing.md,
  },
  progressLabel: {
    ...typography.meta,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  progressBarContainer: {
    height: 8,
    backgroundColor: colors.lightBorder,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  progressBar: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  progressText: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  maxLevelText: {
    ...typography.metaStrong,
    color: colors.alternateGreen,
    textAlign: 'center',
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
    borderColor: colors.lightGrey,
  },
  sectionTitle: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  bioBlock: {
    backgroundColor: colors.veryLightGrey,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    borderRadius: layout.borderRadiusSmall,
    padding: spacing.md,
  },
  bioText: {
    ...typography.body,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  bioEditButton: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
    backgroundColor: colors.secondary,
    borderRadius: layout.borderRadiusSmall,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bioEditButtonText: {
    ...typography.buttonSecondary,
    color: colors.card,
  },
  strengthsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  strengthChip: {
    backgroundColor: colors.lightPurple,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.overlayLightPurple,
  },
  strengthChipText: {
    ...typography.meta,
    color: colors.secondary,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  info: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  statTile: {
    flex: 1,
    backgroundColor: colors.lightGrey,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  statValue: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  statLabel: {
    ...typography.meta,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  walletEntryCard: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  walletEntryMain: {
    flex: 1,
  },
  walletEntryTitle: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
  },
  walletEntryHint: {
    ...typography.meta,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  walletEntryAmountWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginLeft: spacing.md,
  },
  walletEntryAmount: {
    ...typography.bodyStrong,
    color: colors.secondary,
  },
  walletEntryChevron: {
    ...typography.cardTitle,
    color: colors.textSecondary,
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  emptyStateTitle: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  emptyStateCard: {
    backgroundColor: colors.lightGrey,
    borderRadius: layout.borderRadiusSmall,
    padding: spacing.md,
  },
  buddyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.veryLightGrey2,
  },
  buddyAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  buddyAvatarText: {
    ...typography.metaStrong,
    color: colors.card,
  },
  buddyMeta: {
    flex: 1,
  },
  buddyName: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
  },
  buddySubline: {
    ...typography.meta,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  completedTrustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  completedTrustText: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  topBuddyBadge: {
    backgroundColor: colors.lightOrange,
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  topBuddyBadgeText: {
    ...typography.meta,
    color: colors.primary,
    fontWeight: '700',
  },
  topBuddyBadgeSmall: {
    backgroundColor: colors.lightOrange,
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  topBuddyBadgeSmallText: {
    ...typography.meta,
    color: colors.primary,
    fontWeight: '700',
  },
  jobRow: {
    backgroundColor: colors.lightGrey,
    borderRadius: layout.borderRadiusSmall,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.veryLightGrey2,
  },
  jobTextWrap: {
    flex: 1,
  },
  jobProblem: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  jobMeta: {
    ...typography.metaStrong,
    color: colors.textSecondary,
  },
  jobStatusBadge: {
    ...typography.meta,
    color: colors.alternateGreen,
    marginTop: spacing.md,
  },
  jobActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chatButton: {
    backgroundColor: colors.primary,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    minWidth: 92,
    alignItems: 'center',
  },
  chatButtonText: {
    color: colors.card,
    ...typography.buttonSecondary,
  },
  completeButton: {
    backgroundColor: colors.alternateGreen,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    minWidth: 88,
    alignItems: 'center',
  },
  completeButtonText: {
    color: colors.card,
    ...typography.buttonSecondary,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.veryLightGrey2,
  },
  settingText: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
  },
  settingChevron: {
    ...typography.cardTitle,
    color: colors.textSecondary,
    marginLeft: spacing.md,
  },
  languageWrap: {
    marginTop: spacing.lg,
  },
  languageTitle: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  languageButtons: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  languageButton: {
    backgroundColor: colors.lightGrey,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: layout.borderRadiusSmall,
    borderWidth: 1,
    borderColor: colors.lightBorder,
  },
  languageButtonActive: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary,
  },
  languageButtonText: {
    color: colors.secondary,
    ...typography.buttonSecondary,
  },
  languageButtonTextActive: {
    color: colors.card,
  },
  recentReviews: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.veryLightGrey2,
  },
  recentReviewsTitle: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  reviewRow: {
    marginBottom: spacing.md,
    backgroundColor: colors.lightGrey,
    borderRadius: layout.borderRadiusSmall,
    padding: spacing.md,
  },
  reviewStars: {
    ...typography.bodyStrong,
    color: colors.yellow,
    marginBottom: spacing.xs,
  },
  reviewMeta: {
    ...typography.meta,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  reviewText: {
    ...typography.body,
    color: colors.textPrimary,
  },
  reviewSummaryRow: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  reviewButton: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: layout.borderRadiusSmall,
  },
  reviewButtonText: {
    color: colors.card,
    ...typography.buttonSecondary,
  },
  preferenceSummary: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  preferencesButton: {
    backgroundColor: colors.secondary,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  preferencesButtonText: {
    ...typography.buttonSecondary,
    color: colors.card,
  },
  activeJobsHeader: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
    borderWidth: 1,
    borderColor: colors.lightGrey,
  },
  activeJobsHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  activeJobsTitle: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
  },
  activeJobsCountBadge: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    minWidth: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  activeJobsCountText: {
    ...typography.meta,
    color: colors.card,
    fontWeight: '700',
  },
  completedJobsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  completedJobsHeaderMain: {
    flex: 1,
  },
  completedJobsHeaderTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  completedJobsCountBadge: {
    minWidth: 28,
    height: 28,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.veryLightPurple,
    borderWidth: 1,
    borderColor: colors.overlayLightPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completedJobsCountText: {
    ...typography.metaStrong,
    color: colors.secondary,
  },
  completedJobsSummary: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  completedJobsChevron: {
    ...typography.cardTitle,
    color: colors.textSecondary,
    marginLeft: spacing.md,
  },
  completedJobsList: {
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.veryLightGrey2,
    gap: spacing.md,
  },
  activeJobsChevron: {
    ...typography.cardTitle,
    color: colors.textSecondary,
    marginLeft: spacing.md,
  },
  rebookButton: {
    backgroundColor: colors.lightPurple,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: colors.secondary,
  },
  rebookButtonText: {
    ...typography.metaStrong,
    color: colors.secondary,
  },
  rebookJobButton: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    backgroundColor: colors.lightPurple,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.secondary,
  },
  rebookJobButtonText: {
    ...typography.metaStrong,
    color: colors.secondary,
  },
  rebookBuddyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  rebookBuddyChipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.secondary,
  },
  rebookBuddyChipText: {
    ...typography.meta,
    color: colors.secondary,
  },
  devCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: layout.borderRadiusMedium,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: '#333366',
  },
  devSectionTitle: {
    ...typography.metaStrong,
    color: '#a0a0cc',
    marginBottom: spacing.sm,
  },
  devUserRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  devUserButton: {
    flex: 1,
    backgroundColor: '#2a2a4a',
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#444477',
  },
  devUserButtonActive: {
    backgroundColor: '#4444aa',
    borderColor: '#8888ff',
  },
  devUserButtonText: {
    ...typography.metaStrong,
    color: '#a0a0cc',
  },
  devUserButtonTextActive: {
    color: '#ffffff',
  },
  devUserButtonSub: {
    ...typography.meta,
    color: '#666699',
    marginTop: 2,
    textAlign: 'center',
  },
  devDebugPanel: {
    backgroundColor: '#111122',
    borderRadius: layout.borderRadiusSmall,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#222244',
  },
  devLine: {
    ...typography.meta,
    color: '#7777aa',
    fontFamily: 'monospace',
    lineHeight: 18,
  },
});