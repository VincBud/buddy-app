import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { colors } from '../../lib/colors';
import i18n, { useLanguage } from '../../lib/i18n';
import { getMatchedBuddyName, Job, JobParticipantRole } from '../../lib/jobs';
import { goBackOrReplace } from '../../lib/navigation';
import { ensureJobPaymentState, formatPriceLine } from '../../lib/payments';
import { addNotification } from '../../services/notifications.service';
import { loadJobs, saveJobs } from '../../services/jobs.service';
import {
    addPreferredBuddyFromJob,
    getBuddyIdFromName,
    loadPreferredBuddies,
} from '../../lib/preferred-buddies';
import {
    createRoleReview,
    getCounterpartRole,
    getNormalizedJobReviews,
    getReviewEligibility,
    toLegacyJobReview,
} from '../../lib/reviews';
import { layout, spacing } from '../../lib/spacing';
import { typography } from '../../lib/typography';

export default function ReviewJobScreen() {
  useLanguage();
  const router = useRouter();
  const params = useLocalSearchParams<{ jobId: string | string[]; currentUserRole?: string | string[] }>();
  const jobId = Array.isArray(params.jobId) ? params.jobId[0] : params.jobId;
  const [job, setJob] = useState<Job | null>(null);
  const [rating, setRating] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  const [reviewText, setReviewText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isPreferredBuddy, setIsPreferredBuddy] = useState(false);
  const [isSavingPreferredBuddy, setIsSavingPreferredBuddy] = useState(false);

  const reviewerRole: JobParticipantRole = (() => {
    const raw = Array.isArray(params.currentUserRole)
      ? params.currentUserRole[0]
      : params.currentUserRole;
    return raw === 'auftraggeber' ? 'auftraggeber' : 'buddy';
  })();
  const revieweeRole = getCounterpartRole(reviewerRole);

  useEffect(() => {
    const loadJob = async () => {
      if (!jobId) {
        setJob(null);
        return;
      }

      try {
        const safeJobs = await loadJobs();
        const foundJob = safeJobs.find((item) => item.id === jobId) || null;
        setJob(foundJob);

        if (reviewerRole === 'auftraggeber') {
          const matchedBuddyName = foundJob ? getMatchedBuddyName(foundJob) : null;
          if (matchedBuddyName) {
            const preferredBuddies = await loadPreferredBuddies();
            const buddyId = getBuddyIdFromName(matchedBuddyName);
            setIsPreferredBuddy(
              preferredBuddies.some((buddy) => buddy.id === buddyId)
            );
          }
        } else {
          setIsPreferredBuddy(false);
        }
      } catch (error) {
        console.error('Error loading job for review:', error);
      }
    };

    loadJob();
  }, [jobId, reviewerRole]);

  const submitReview = async () => {
    if (!job || rating === 0) return;
    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const safeJobs = await loadJobs();

      const updatedJobs = safeJobs.map((item) =>
        item.id !== job.id
          ? item
          : (() => {
              const eligibility = getReviewEligibility(item, reviewerRole);

              if (eligibility.state !== 'available') {
                return item;
              }

              const existing = getNormalizedJobReviews(item);
              if (existing.some((entry) => entry.reviewerRole === reviewerRole)) {
                return item;
              }

              const nextReview = createRoleReview({
                jobId: item.id,
                reviewerRole,
                revieweeRole,
                rating,
                reviewText,
                reviewerName: reviewerRole === 'buddy' ? 'Buddy' : 'Auftraggeber',
              });

              const nextRoleReviews = [nextReview, ...existing];

              const latestBuddyReview = nextRoleReviews.find(
                (entry) => entry.revieweeRole === 'buddy'
              );

              const nextCreatorReviews =
                reviewerRole === 'buddy' && revieweeRole === 'auftraggeber'
                  ? [
                      {
                        rating: nextReview.rating,
                        reviewText: nextReview.reviewText,
                        reviewerName: nextReview.reviewerName,
                        reviewedAt: nextReview.reviewedAt,
                      },
                      ...(Array.isArray(item.creatorReviews) ? item.creatorReviews : []),
                    ]
                  : item.creatorReviews;

              return {
                ...item,
                reviews: nextRoleReviews,
                review: toLegacyJobReview(latestBuddyReview) ?? item.review,
                creatorReviews: nextCreatorReviews,
              };
            })()
      );

      const refreshedJob =
        updatedJobs.find((entry) => entry.id === job.id) ?? job;
      const refreshedEligibility = getReviewEligibility(refreshedJob, reviewerRole);

      if (refreshedEligibility.state !== 'already_reviewed') {
        setErrorMessage(i18n.t('profile.review_duplicate_error'));
        setIsSubmitting(false);
        return;
      }

      await saveJobs(updatedJobs);

      await addNotification(
        'review',
        i18n.t('notifications.review'),
        `${i18n.t('notifications.review')}: ${job.problem}`,
        job.id
      );

      setSuccess(true);
      setTimeout(() => {
        router.push({
          pathname: '/(tabs)/feed',
          params: { showRecommendations: job.id },
        });
      }, 1400);
    } catch (error) {
      console.error('Error submitting review:', error);
      setErrorMessage(i18n.t('profile.review_save_error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const markBuddyAsPreferred = async () => {
    if (!job || isPreferredBuddy || reviewerRole !== 'auftraggeber') return;

    setIsSavingPreferredBuddy(true);
    try {
      await addPreferredBuddyFromJob(job);
      setIsPreferredBuddy(true);
    } catch (error) {
      console.error('Error saving preferred buddy:', error);
    } finally {
      setIsSavingPreferredBuddy(false);
    }
  };

  const creatorName =
    reviewerRole === 'auftraggeber'
      ? (job ? getMatchedBuddyName(job) : null) ?? i18n.t('common.default_user_name')
      : job?.creatorName || i18n.t('common.default_user_name');
  const reviewEligibility = job
    ? getReviewEligibility(job, reviewerRole)
    : {
        state: 'not_reviewable' as const,
        reviewerRole,
        revieweeRole,
      };
  const counterpartReviewed = job
    ? getNormalizedJobReviews(job).some((entry) => entry.reviewerRole === revieweeRole)
    : false;

  const payment = job ? ensureJobPaymentState(job) : null;
  const buddyPayout = payment?.buddyEarnings ?? 0;

  const handleBack = () => {
    goBackOrReplace(router, '/(tabs)/feed');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      <Stack.Screen
        options={{
          headerShown: true,
          title: i18n.t('profile.review_title'),
          headerBackTitle: i18n.t('common.back'),
          headerLeft: () => (
            <Pressable onPress={handleBack} hitSlop={8}>
              <Text style={styles.headerBackText}>{i18n.t('common.back')}</Text>
            </Pressable>
          ),
        }}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {reviewerRole === 'buddy' && (
          <View style={styles.payoutCard}>
            <Text style={styles.payoutCardTitle}>{i18n.t('profile.review_payout_title')}</Text>
            <Text style={styles.payoutCardSubtitle}>{i18n.t('profile.review_payout_subtitle')}</Text>
            {buddyPayout > 0 && (
              <View style={styles.payoutAmountRow}>
                <Text style={styles.payoutAmountLabel}>{i18n.t('profile.review_payout_label')}</Text>
                <Text style={styles.payoutAmountValue}>{formatPriceLine(buddyPayout)}</Text>
              </View>
            )}
          </View>
        )}

        {reviewerRole === 'auftraggeber' && (
          <View style={styles.completionCard}>
            <Text style={styles.completionCardTitle}>{i18n.t('profile.review_completion_title')}</Text>
            <Text style={styles.completionCardSubtitle}>{i18n.t('profile.review_completion_subtitle')}</Text>
            <Pressable
              style={styles.newJobButton}
              onPress={() => router.push('/(tabs)/create')}
            >
              <Text style={styles.newJobButtonText}>{i18n.t('profile.review_new_job_cta')}</Text>
            </Pressable>
          </View>
        )}

        {!jobId ? (
          <View style={styles.card}>
            <View style={styles.blockedCard}>
              <Text style={styles.blockedTitle}>{i18n.t('common.job_not_found_title')}</Text>
              <Text style={styles.blockedText}>{i18n.t('common.job_not_found_text')}</Text>
            </View>
          </View>
        ) : (
        <View style={styles.card}>
          <Text style={styles.title}>{i18n.t('profile.review_title')}</Text>
          <Text style={styles.subtitle}>{i18n.t('profile.review_prompt')}</Text>
          <Text style={styles.creatorName}>{creatorName}</Text>

          <Text style={styles.roleHint}>
            {i18n.t('profile.review_role_hint', {
              target: i18n.t(`profile.review_target_${revieweeRole}`),
            })}
          </Text>
          <Text style={styles.stateHint}>
            {counterpartReviewed
              ? i18n.t('profile.review_counterpart_done')
              : i18n.t('profile.review_counterpart_pending')}
          </Text>

          {reviewerRole === 'auftraggeber' && (
            <Pressable
              style={[
                styles.preferredBuddyButton,
                (isPreferredBuddy || isSavingPreferredBuddy) &&
                  styles.preferredBuddyButtonSaved,
              ]}
              onPress={markBuddyAsPreferred}
              disabled={isPreferredBuddy || isSavingPreferredBuddy}
            >
              <Text
                style={[
                  styles.preferredBuddyButtonText,
                  (isPreferredBuddy || isSavingPreferredBuddy) &&
                    styles.preferredBuddyButtonTextSaved,
                ]}
              >
                {isPreferredBuddy
                  ? i18n.t('profile.preferred_buddy_saved')
                  : i18n.t('profile.add_preferred_buddy')}
              </Text>
            </Pressable>
          )}

          {reviewEligibility.state === 'not_reviewable' ? (
            <View style={styles.blockedCard}>
              <Text style={styles.blockedTitle}>{i18n.t('profile.review_not_available_title')}</Text>
              <Text style={styles.blockedText}>{i18n.t('profile.review_not_available_subtitle')}</Text>
            </View>
          ) : success || reviewEligibility.state === 'already_reviewed' ? (
            <View style={styles.successCard}>
              <Text style={styles.successTitle}>
                {reviewEligibility.state === 'already_reviewed' && !success
                  ? i18n.t('profile.review_already_done_title')
                  : i18n.t('profile.review_success')}
              </Text>
              <Text style={styles.successSubtitle}>
                {reviewEligibility.state === 'already_reviewed' && !success
                  ? i18n.t('profile.review_already_done_subtitle')
                  : i18n.t('profile.review_success_subtitle')}
              </Text>
              {job && (
                <Pressable style={styles.continueButton} onPress={() => {
                  router.push({
                    pathname: '/(tabs)/feed',
                    params: { showRecommendations: job.id },
                  });
                }}>
                  <Text style={styles.continueButtonText}>
                    {i18n.t('profile.review_continue')}
                  </Text>
                </Pressable>
              )}
            </View>
          ) : (
            <>
              <View style={styles.starRow}>
                {[1, 2, 3, 4, 5].map((value) => (
                  <Pressable
                    key={value}
                    style={styles.starButton}
                    onPress={() => setRating(value as 1 | 2 | 3 | 4 | 5)}
                  >
                    <Text style={styles.starText}>
                      {rating >= value ? '★' : '☆'}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <TextInput
                style={styles.reviewInput}
                placeholder={i18n.t('profile.review_comment_placeholder')}
                placeholderTextColor={colors.placeholder}
                value={reviewText}
                onChangeText={setReviewText}
                multiline
              />

              {errorMessage ? (
                <Text style={styles.errorText}>{errorMessage}</Text>
              ) : null}

              <Pressable
                style={[
                  styles.submitButton,
                  (rating === 0 || isSubmitting || reviewEligibility.state !== 'available') && styles.submitButtonDisabled,
                ]}
                onPress={submitReview}
                disabled={rating === 0 || isSubmitting || reviewEligibility.state !== 'available'}
              >
                <Text style={styles.submitButtonText}>
                  {i18n.t('profile.review_submit')}
                </Text>
              </Pressable>
            </>
          )}
        </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: layout.screenPaddingX,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusLarge,
    padding: layout.screenPaddingX,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  headerBackText: {
    ...typography.metaStrong,
    color: colors.textPrimary,
  },
  title: {
    ...typography.screenTitle,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
    lineHeight: 22,
  },
  creatorName: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  roleHint: {
    ...typography.meta,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  stateHint: {
    ...typography.meta,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
  },
  preferredBuddyButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.secondary,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  preferredBuddyButtonSaved: {
    backgroundColor: colors.lightGrey,
  },
  preferredBuddyButtonText: {
    ...typography.meta,
    color: colors.card,
    fontWeight: '700',
  },
  preferredBuddyButtonTextSaved: {
    color: colors.secondary,
  },
  starRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xxxl,
  },
  starButton: {
    flex: 1,
    alignItems: 'center',
  },
  starText: {
    fontSize: 38,
    color: colors.yellow,
  },
  reviewInput: {
    minHeight: 100,
    backgroundColor: colors.veryLightPurple,
    borderRadius: layout.borderRadiusMedium,
    padding: spacing.lg,
    ...typography.body,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
    textAlignVertical: 'top',
  },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: layout.borderRadiusMedium,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.55,
  },
  submitButtonText: {
    ...typography.button,
    color: colors.card,
  },
  successCard: {
    backgroundColor: colors.lightGreen,
    borderRadius: layout.borderRadiusMedium,
    padding: layout.cardPadding,
    alignItems: 'center',
  },
  blockedCard: {
    backgroundColor: colors.veryLightGrey,
    borderRadius: layout.borderRadiusMedium,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    padding: layout.cardPadding,
  },
  blockedTitle: {
    ...typography.metaStrong,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  blockedText: {
    ...typography.meta,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  successTitle: {
    ...typography.sectionTitle,
    color: colors.green,
    marginBottom: spacing.sm,
  },
  successSubtitle: {
    ...typography.body,
    color: colors.mediumDarkGrey,
    lineHeight: 22,
    marginBottom: layout.cardPadding,
    textAlign: 'center',
  },
  continueButton: {
    backgroundColor: colors.secondary,
    borderRadius: layout.borderRadiusMedium,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xxxl,
  },
  continueButtonText: {
    ...typography.buttonSecondary,
    color: colors.card,
  },
  errorText: {
    ...typography.meta,
    color: colors.red,
    marginBottom: spacing.md,
  },
  payoutCard: {
    backgroundColor: colors.lightGreen,
    borderRadius: layout.borderRadiusMedium,
    borderWidth: 1,
    borderColor: '#C6F0CC',
    padding: layout.cardPadding,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  payoutCardTitle: {
    ...typography.sectionTitle,
    color: colors.green,
  },
  payoutCardSubtitle: {
    ...typography.body,
    color: colors.green,
    lineHeight: 22,
  },
  payoutAmountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: '#C6F0CC',
  },
  payoutAmountLabel: {
    ...typography.metaStrong,
    color: colors.green,
  },
  payoutAmountValue: {
    ...typography.sectionTitle,
    color: colors.green,
  },
  completionCard: {
    backgroundColor: colors.veryLightPurple,
    borderRadius: layout.borderRadiusMedium,
    borderWidth: 1,
    borderColor: colors.overlayLightPurple,
    padding: layout.cardPadding,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  completionCardTitle: {
    ...typography.sectionTitle,
    color: colors.secondary,
  },
  completionCardSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  newJobButton: {
    marginTop: spacing.xs,
    backgroundColor: colors.secondary,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  newJobButtonText: {
    ...typography.buttonSecondary,
    color: colors.card,
  },
});
