import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
    Alert,
    Image,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../lib/colors';
import i18n, { useLanguage } from '../../lib/i18n';
import {
    cancelJob,
    CancelJobReasonKey,
    IssueResolution,
    ReportIssueReasonKey,
    reportJobIssue,
    resolveJobIssue,
} from '../../lib/job-actions';
import { addNotification } from '../../services/notifications.service';
import { Job, JobParticipantRole, JobStatus } from '../../lib/jobs';
import { goBackOrReplace } from '../../lib/navigation';
import { ensureJobPaymentState, formatPriceLine } from '../../lib/payments';
import { layout, spacing } from '../../lib/spacing';
import { getReliabilitySignal, getTrustStarFillRatio } from '../../lib/trust';
import { typography } from '../../lib/typography';

type JobWithDescription = Job & {
  description?: string;
};

type ChatDetailsRouteParams = {
  id?: string | string[];
  currentUserRole?: JobParticipantRole | string | string[];
};

const REPORT_REASON_KEYS: ReportIssueReasonKey[] = [
  'counterparty_unreachable',
  'unclear_expectation',
  'safety_concern',
  'payment_process_unclear',
  'inappropriate_behavior',
  'other',
];

const CANCEL_REASON_KEYS: CancelJobReasonKey[] = [
  'no_time',
  'wrong_job',
  'no_agreement',
  'no_longer_needed',
  'other',
];

type ReportFlowStep = 'select' | 'success';
type CancelFlowStep = 'select' | 'confirm' | 'success';

const normalizeRoleParam = (value: unknown): JobParticipantRole => {
  if (Array.isArray(value)) {
    return normalizeRoleParam(value[0]);
  }
  return value === 'auftraggeber' ? 'auftraggeber' : 'buddy';
};

export default function ChatDetailsScreen() {
  useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<ChatDetailsRouteParams>();
  const { id } = params;
  const [job, setJob] = useState<JobWithDescription | null>(null);
  const [reportVisible, setReportVisible] = useState(false);
  const [cancelVisible, setCancelVisible] = useState(false);
  const [reportReason, setReportReason] = useState<ReportIssueReasonKey | null>(null);
  const [cancelReason, setCancelReason] = useState<CancelJobReasonKey | null>(null);
  const [reportNote, setReportNote] = useState('');
  const [cancelNote, setCancelNote] = useState('');
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [isSubmittingCancel, setIsSubmittingCancel] = useState(false);
  const [isSubmittingResolve, setIsSubmittingResolve] = useState(false);
  const [reportFlowStep, setReportFlowStep] = useState<ReportFlowStep>('select');
  const [cancelFlowStep, setCancelFlowStep] = useState<CancelFlowStep>('select');

  const jobId = useMemo(() => {
    if (!id) return '';
    return Array.isArray(id) ? id[0] : id;
  }, [id]);

  const handleBack = () => {
    goBackOrReplace(router, '/(tabs)/feed');
  };

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const load = async () => {
        try {
          const jobsRaw = await AsyncStorage.getItem('jobs');
          const parsed = jobsRaw ? JSON.parse(jobsRaw) : [];
          const safeJobs: JobWithDescription[] = Array.isArray(parsed) ? parsed : [];
          const found = safeJobs.find((item) => String(item.id) === String(jobId)) || null;

          if (isActive) {
            setJob(found);
          }
        } catch {
          if (isActive) {
            setJob(null);
          }
        }
      };

      if (jobId) {
        load();
      }

      return () => {
        isActive = false;
      };
    }, [jobId])
  );

  const requesterName = String(
    job?.creatorName?.trim() || i18n.t('common.default_user_name')
  );
  const currentUserRole = normalizeRoleParam(params.currentUserRole);
  const requesterInitial = requesterName.charAt(0).toUpperCase();

  const description =
    job?.description?.trim() ||
    job?.problem ||
    i18n.t('common.job_not_found_text');

  const files = Array.isArray(job?.media) ? job.media : [];
  const payment = ensureJobPaymentState(job ?? {});
  const reviewCount = Array.isArray(job?.creatorReviews) ? job.creatorReviews.length : 0;
  const averageRating =
    typeof job?.creatorScore === 'number' && Number.isFinite(job.creatorScore)
      ? job.creatorScore
      : reviewCount > 0
      ? job!.creatorReviews!.reduce((sum, review) => sum + review.rating, 0) / reviewCount
      : null;

  const formattedRating = averageRating !== null ? averageRating.toFixed(1) : null;
  const ratingFill = getTrustStarFillRatio(averageRating, reviewCount);
  const contactReliability = getReliabilitySignal({ completedJobs: reviewCount });
  const hasStrongTrust = (averageRating ?? 0) >= 4.7 && reviewCount >= 5;
  const jobStatus: JobStatus = job?.status ?? 'open';
  const isCancelled = jobStatus === 'cancelled';
  const isIssueReported = jobStatus === 'issue_reported';

  const clearReportForm = () => {
    setReportReason(null);
    setReportNote('');
    setReportFlowStep('select');
  };

  const clearCancelForm = () => {
    setCancelReason(null);
    setCancelNote('');
    setCancelFlowStep('select');
  };

  const getStatusInfo = (): { title: string; subtitle: string; variant?: 'issue' } | null => {
    if (isIssueReported) {
      return {
        title: i18n.t('chat.status_issue_reported_title'),
        subtitle: i18n.t('chat.status_issue_reported_subtitle'),
        variant: 'issue',
      };
    }
    if (isCancelled) {
      return {
        title: i18n.t('chat.status_cancelled_title'),
        subtitle: i18n.t('chat.status_cancelled_subtitle'),
      };
    }

    return null;
  };

  const statusInfo = getStatusInfo();

  const handleCancelJob = () => {
    clearCancelForm();
    setCancelVisible(true);
  };

  const handleReportIssue = () => {
    clearReportForm();
    setReportVisible(true);
  };

  const submitIssueReport = async () => {
    if (!job?.id || !reportReason || isSubmittingReport) return;

    try {
      setIsSubmittingReport(true);
      const result = await reportJobIssue({
        jobId: job.id,
        reporterRole: currentUserRole,
        reason: reportReason,
        note: reportNote,
      });

      if (result.updatedJob) {
        setJob(result.updatedJob as JobWithDescription);
      }

      await addNotification(
        'problemReported',
        i18n.t('notifications.problemReported_title'),
        i18n.t('notifications.problemReported_message'),
        job.id
      );

      setReportFlowStep('success');
    } finally {
      setIsSubmittingReport(false);
    }
  };

  const submitCancellation = async () => {
    if (!job?.id || !cancelReason || isSubmittingCancel) return;

    try {
      setIsSubmittingCancel(true);
      const result = await cancelJob({
        jobId: job.id,
        cancelledByRole: currentUserRole,
        reason: cancelReason,
        note: cancelNote,
      });

      if (result.updatedJob) {
        setJob(result.updatedJob as JobWithDescription);
      }

      await addNotification(
        'jobCancelled',
        i18n.t('notifications.jobCancelled_title'),
        i18n.t('notifications.jobCancelled_message'),
        job.id
      );

      setCancelFlowStep('success');
    } finally {
      setIsSubmittingCancel(false);
    }
  };

  const submitIssueResolution = async (resolution: IssueResolution) => {
    if (!job?.id || isSubmittingResolve) return;
    try {
      setIsSubmittingResolve(true);
      const result = await resolveJobIssue({
        jobId: job.id,
        resolution,
        resolvedByRole: currentUserRole,
      });
      if (result.updatedJob) {
        setJob(result.updatedJob as JobWithDescription);
      }
    } finally {
      setIsSubmittingResolve(false);
    }
  };

  const handleContinueJob = () => submitIssueResolution('continue');

  const handleCompleteJobFromIssue = () => {
    Alert.alert(
      i18n.t('chat.resolve_complete_confirm_title'),
      i18n.t('chat.resolve_complete_confirm_message'),
      [
        { text: i18n.t('common.back'), style: 'cancel' },
        {
          text: i18n.t('chat.resolve_complete_confirm_yes'),
          style: 'destructive',
          onPress: () => submitIssueResolution('complete'),
        },
      ]
    );
  };

  const handleCancelFromIssue = () => {
    Alert.alert(
      i18n.t('chat.resolve_cancel'),
      i18n.t('chat.resolve_cancel_hint'),
      [
        { text: i18n.t('common.back'), style: 'cancel' },
        {
          text: i18n.t('chat.cancel_confirm_final'),
          style: 'destructive',
          onPress: () => submitIssueResolution('cancel'),
        },
      ]
    );
  };

  const selectedCancelReasonLabel = useMemo(() => {
    if (!cancelReason) return '';
    return i18n.t(`chat.cancel_reason_${cancelReason}`);
  }, [cancelReason]);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.backButton} onPress={handleBack}>
          <Text style={styles.backButtonText}>←</Text>
        </Pressable>

        <View style={styles.heroCard}>
          <Text style={styles.heroEyebrow}>{i18n.t('chat.active_job')}</Text>
          <Text style={styles.title}>{i18n.t('chat.accepted_details_title')}</Text>
          <Text style={styles.heroSubtitle} numberOfLines={2}>
            {job?.problem || i18n.t('chat.accepted_details_subtitle')}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.screen}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + spacing.lg },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {statusInfo && (
          <View style={[styles.statusCard, statusInfo.variant === 'issue' && styles.statusCardIssue]}>
            <Text style={[styles.statusTitle, statusInfo.variant === 'issue' && styles.statusTitleIssue]}>
              {statusInfo.title}
            </Text>
            <Text style={styles.statusSubtitle}>{statusInfo.subtitle}</Text>
            {statusInfo.variant === 'issue' && job?.issueSummary?.reason && (
              <Text style={styles.statusSubtitle}>
                {i18n.t(`chat.report_reason_${job.issueSummary.reason}`)}
              </Text>
            )}
          </View>
        )}

        {isIssueReported && (
          <View style={styles.resolutionCard}>
            <Text style={styles.resolutionSectionTitle}>{i18n.t('chat.resolve_section_title')}</Text>

            <Pressable
              style={[styles.resolutionOption, styles.resolutionOptionContinue, isSubmittingResolve && styles.actionButtonDisabled]}
              onPress={handleContinueJob}
              disabled={isSubmittingResolve}
            >
              <Text style={styles.resolutionOptionLabel}>{i18n.t('chat.resolve_continue')}</Text>
              <Text style={styles.resolutionOptionHint}>{i18n.t('chat.resolve_continue_hint')}</Text>
            </Pressable>

            <Pressable
              style={[styles.resolutionOption, styles.resolutionOptionComplete, isSubmittingResolve && styles.actionButtonDisabled]}
              onPress={handleCompleteJobFromIssue}
              disabled={isSubmittingResolve}
            >
              <Text style={styles.resolutionOptionLabel}>{i18n.t('chat.resolve_complete')}</Text>
              <Text style={styles.resolutionOptionHint}>{i18n.t('chat.resolve_complete_hint')}</Text>
            </Pressable>

            <Pressable
              style={[styles.resolutionOption, isSubmittingResolve && styles.actionButtonDisabled]}
              onPress={handleCancelFromIssue}
              disabled={isSubmittingResolve}
            >
              <Text style={[styles.resolutionOptionLabel, styles.resolutionOptionLabelCancel]}>{i18n.t('chat.resolve_cancel')}</Text>
              <Text style={styles.resolutionOptionHint}>{i18n.t('chat.resolve_cancel_hint')}</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{i18n.t('chat.details_section_description')}</Text>
          <Text style={styles.bodyText}>{description}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{i18n.t('chat.details_section_requester')}</Text>
          <View style={styles.requesterRow}> 
            <View style={styles.requesterAvatar}>
              <Text style={styles.requesterAvatarText}>{requesterInitial}</Text>
            </View>

            <View style={styles.requesterInfoWrap}>
              <Text style={styles.requesterRole}>{i18n.t('chat.details_requester_role')}</Text>
              <Text style={styles.requesterValue}>{requesterName}</Text>
              <View style={styles.requesterTrustRow}>
                <View style={styles.trustStarWrap}>
                  <Text style={styles.trustStarBase}>★</Text>
                  <View
                    style={[
                      styles.trustStarFillClip,
                      { width: `${Math.max(0, Math.min(1, ratingFill)) * 100}%` },
                    ]}
                  >
                    <Text style={styles.trustStarFill}>★</Text>
                  </View>
                </View>
                <Text style={styles.requesterRatingText}>
                  {formattedRating
                    ? i18n.t('chat.details_requester_rating_with_count', {
                        rating: formattedRating,
                        count: reviewCount,
                      })
                    : i18n.t('chat.details_requester_rating_empty')}
                </Text>
              </View>
              <View style={styles.requesterTrustMetaRow}>
                <View style={styles.requesterTrustMetaChip}>
                  <Text style={styles.requesterTrustMetaText}>
                    {i18n.t('chat.trust_reliability_label')}: {i18n.t(`chat.trust_reliability_${contactReliability}`)}
                  </Text>
                </View>
                {hasStrongTrust && (
                  <View style={styles.requesterTrustMetaChipStrong}>
                    <Text style={styles.requesterTrustMetaTextStrong}>{i18n.t('chat.trust_top_rated')}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{i18n.t('chat.details_section_payment')}</Text>

          <View style={styles.paymentRow}>
            <Text style={styles.paymentLabel}>{i18n.t('chat.payment_line_job')}</Text>
            <Text style={styles.paymentValue}>{formatPriceLine(payment.buddyEarnings)}</Text>
          </View>

          <View style={styles.paymentRow}>
            <Text style={styles.paymentLabel}>{i18n.t('chat.payment_line_fee')}</Text>
            <Text style={styles.paymentValue}>{formatPriceLine(payment.platformKeeps)}</Text>
          </View>

          <View style={[styles.paymentRow, styles.paymentTotalRow]}>
            <Text style={styles.paymentTotalLabel}>{i18n.t('chat.payment_line_total')}</Text>
            <Text style={styles.paymentTotalValue}>{formatPriceLine(payment.requesterPays)}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>{i18n.t('chat.details_section_files')}</Text>
            {files.length > 0 && (
              <View style={styles.fileCountBadge}>
                <Text style={styles.fileCountText}>{files.length}</Text>
              </View>
            )}
          </View>

          {files.length > 0 ? (
            <View style={styles.filesGrid}>
              {files.map((uri, index) => (
                <Image
                  key={`${uri}-${index}`}
                  source={{ uri }}
                  style={styles.filePreview}
                />
              ))}
            </View>
          ) : (
            <Text style={styles.emptyFilesText}>{i18n.t('chat.details_no_files')}</Text>
          )}
        </View>

        <View style={styles.actionSectionCard}>
          <Pressable
            style={({ pressed }) => [
              styles.primaryActionButton,
              isCancelled && styles.actionButtonDisabled,
              pressed && !isCancelled && styles.actionButtonPressed,
            ]}
            onPress={handleCancelJob}
            disabled={isCancelled}
            hitSlop={6}
          >
            <Text style={styles.secondaryActionText}>{i18n.t('chat.cancel_job')}</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.secondaryActionButton,
              (isCancelled || isIssueReported) && styles.actionButtonDisabled,
              pressed && !(isCancelled || isIssueReported) && styles.actionButtonPressed,
            ]}
            onPress={handleReportIssue}
            disabled={isCancelled || isIssueReported}
            hitSlop={6}
          >
            <Text style={styles.tertiaryActionText}>{i18n.t('chat.report_issue')}</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal
        visible={reportVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setReportVisible(false);
          clearReportForm();
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {reportFlowStep === 'select' ? (
              <>
                <Text style={styles.modalTitle}>{i18n.t('chat.report_modal_title')}</Text>
                <Text style={styles.modalSubtitle}>{i18n.t('chat.report_modal_subtitle')}</Text>

                <View style={styles.reasonList}>
                  {REPORT_REASON_KEYS.map((reasonKey) => {
                    const selected = reportReason === reasonKey;
                    return (
                      <Pressable
                        key={reasonKey}
                        style={[
                          styles.reasonButton,
                          selected && styles.reasonButtonSelected,
                        ]}
                        onPress={() => setReportReason(reasonKey)}
                      >
                        <Text
                          style={[
                            styles.reasonButtonText,
                            selected && styles.reasonButtonTextSelected,
                          ]}
                        >
                          {i18n.t(`chat.report_reason_${reasonKey}`)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <TextInput
                  style={styles.noteInput}
                  value={reportNote}
                  onChangeText={setReportNote}
                  placeholder={i18n.t('chat.report_note_placeholder')}
                  placeholderTextColor={colors.placeholder}
                  multiline
                />

                <View style={styles.modalActionsRow}>
                  <Pressable
                    style={styles.modalSecondaryButton}
                    onPress={() => {
                      setReportVisible(false);
                      clearReportForm();
                    }}
                  >
                    <Text style={styles.modalSecondaryButtonText}>{i18n.t('chat.flow_close')}</Text>
                  </Pressable>

                  <Pressable
                    style={[
                      styles.modalPrimaryButton,
                      (!reportReason || isSubmittingReport) && styles.actionButtonDisabled,
                    ]}
                    onPress={submitIssueReport}
                    disabled={!reportReason || isSubmittingReport}
                  >
                    <Text style={styles.modalPrimaryButtonText}>{i18n.t('chat.report_submit')}</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.modalTitle}>{i18n.t('chat.report_success_title')}</Text>
                <Text style={styles.modalSubtitle}>{i18n.t('chat.report_success_message')}</Text>

                <Pressable
                  style={styles.modalPrimaryButton}
                  onPress={() => {
                    setReportVisible(false);
                    clearReportForm();
                  }}
                >
                  <Text style={styles.modalPrimaryButtonText}>{i18n.t('common.done')}</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={cancelVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setCancelVisible(false);
          clearCancelForm();
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {cancelFlowStep === 'select' && (
              <>
                <Text style={styles.modalTitle}>{i18n.t('chat.cancel_modal_title')}</Text>
                <Text style={styles.modalSubtitle}>{i18n.t('chat.cancel_modal_subtitle')}</Text>

                <View style={styles.reasonList}>
                  {CANCEL_REASON_KEYS.map((reasonKey) => {
                    const selected = cancelReason === reasonKey;
                    return (
                      <Pressable
                        key={reasonKey}
                        style={[
                          styles.reasonButton,
                          selected && styles.reasonButtonSelected,
                        ]}
                        onPress={() => setCancelReason(reasonKey)}
                      >
                        <Text
                          style={[
                            styles.reasonButtonText,
                            selected && styles.reasonButtonTextSelected,
                          ]}
                        >
                          {i18n.t(`chat.cancel_reason_${reasonKey}`)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <TextInput
                  style={styles.noteInput}
                  value={cancelNote}
                  onChangeText={setCancelNote}
                  placeholder={i18n.t('chat.cancel_note_placeholder')}
                  placeholderTextColor={colors.placeholder}
                  multiline
                />

                <View style={styles.modalActionsRow}>
                  <Pressable
                    style={styles.modalSecondaryButton}
                    onPress={() => {
                      setCancelVisible(false);
                      clearCancelForm();
                    }}
                  >
                    <Text style={styles.modalSecondaryButtonText}>{i18n.t('chat.flow_close')}</Text>
                  </Pressable>

                  <Pressable
                    style={[
                      styles.modalPrimaryButton,
                      !cancelReason && styles.actionButtonDisabled,
                    ]}
                    onPress={() => setCancelFlowStep('confirm')}
                    disabled={!cancelReason}
                  >
                    <Text style={styles.modalPrimaryButtonText}>{i18n.t('chat.cancel_continue')}</Text>
                  </Pressable>
                </View>
              </>
            )}

            {cancelFlowStep === 'confirm' && (
              <>
                <Text style={styles.modalTitle}>{i18n.t('chat.cancel_confirm_title')}</Text>
                <Text style={styles.modalSubtitle}>{i18n.t('chat.cancel_confirm_message')}</Text>

                <View style={styles.confirmReasonCard}>
                  <Text style={styles.confirmReasonLabel}>{i18n.t('chat.cancel_selected_reason')}</Text>
                  <Text style={styles.confirmReasonValue}>{selectedCancelReasonLabel}</Text>
                </View>

                <View style={styles.consequencesCard}>
                  <Text style={styles.consequenceText}>• {i18n.t('chat.cancel_consequence_end_job')}</Text>
                  <Text style={styles.consequenceText}>• {i18n.t('chat.cancel_consequence_chat_inactive')}</Text>
                  <Text style={styles.consequenceText}>• {i18n.t('chat.cancel_consequence_no_auto_payout')}</Text>
                </View>

                <View style={styles.modalActionsRow}>
                  <Pressable
                    style={styles.modalSecondaryButton}
                    onPress={() => setCancelFlowStep('select')}
                  >
                    <Text style={styles.modalSecondaryButtonText}>{i18n.t('chat.cancel_confirm_back')}</Text>
                  </Pressable>

                  <Pressable
                    style={[
                      styles.modalDangerButton,
                      isSubmittingCancel && styles.actionButtonDisabled,
                    ]}
                    onPress={submitCancellation}
                    disabled={isSubmittingCancel}
                  >
                    <Text style={styles.modalDangerButtonText}>{i18n.t('chat.cancel_confirm_final')}</Text>
                  </Pressable>
                </View>
              </>
            )}

            {cancelFlowStep === 'success' && (
              <>
                <Text style={styles.modalTitle}>{i18n.t('chat.cancel_success_title')}</Text>
                <Text style={styles.modalSubtitle}>{i18n.t('chat.cancel_success_message')}</Text>

                <Pressable
                  style={styles.modalPrimaryButton}
                  onPress={() => {
                    setCancelVisible(false);
                    clearCancelForm();
                  }}
                >
                  <Text style={styles.modalPrimaryButtonText}>{i18n.t('common.done')}</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
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
    paddingBottom: spacing.md,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.veryLightGrey2,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.lightBorder,
  },
  backButtonText: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    lineHeight: 24,
  },
  title: {
    ...typography.screenTitle,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  heroCard: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    padding: layout.cardPadding,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  heroEyebrow: {
    ...typography.metaStrong,
    color: colors.secondary,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  heroSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: layout.screenPaddingX,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  statusCard: {
    backgroundColor: colors.veryLightPurple,
    borderRadius: layout.borderRadiusMedium,
    borderWidth: 1,
    borderColor: colors.overlayLightPurple,
    paddingHorizontal: layout.cardPadding,
    paddingVertical: spacing.md,
  },
  statusTitle: {
    ...typography.metaStrong,
    color: colors.secondary,
    marginBottom: 2,
  },
  statusTitleIssue: {
    color: colors.red,
  },
  statusCardIssue: {
    backgroundColor: colors.lightOrange,
    borderColor: 'rgba(255, 64, 0, 0.25)',
  },
  resolutionCard: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    borderWidth: 1,
    borderColor: 'rgba(255, 64, 0, 0.2)',
    paddingHorizontal: layout.cardPadding,
    paddingVertical: spacing.lg,
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  resolutionSectionTitle: {
    ...typography.metaStrong,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  resolutionOption: {
    borderRadius: layout.borderRadiusSmall,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    backgroundColor: colors.veryLightGrey,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 2,
  },
  resolutionOptionContinue: {
    backgroundColor: colors.lightGreen,
    borderColor: '#C6F0CC',
  },
  resolutionOptionComplete: {
    backgroundColor: colors.veryLightPurple,
    borderColor: colors.overlayLightPurple,
  },
  resolutionOptionLabel: {
    ...typography.metaStrong,
    color: colors.textPrimary,
  },
  resolutionOptionLabelCancel: {
    color: colors.textSecondary,
  },
  resolutionOptionHint: {
    ...typography.meta,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  statusSubtitle: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    paddingHorizontal: layout.cardPadding,
    paddingVertical: spacing.lg,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  sectionTitle: {
    ...typography.metaStrong,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  bodyText: {
    ...typography.body,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  requesterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  requesterAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.veryLightPurple,
    borderWidth: 1,
    borderColor: colors.overlayLightPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requesterAvatarText: {
    ...typography.metaStrong,
    color: colors.secondary,
  },
  requesterInfoWrap: {
    flex: 1,
    gap: 2,
  },
  requesterRole: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  requesterValue: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
  },
  requesterRatingText: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  requesterTrustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 2,
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
  requesterTrustMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  requesterTrustMetaChip: {
    backgroundColor: colors.veryLightGrey,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  requesterTrustMetaChipStrong: {
    backgroundColor: colors.veryLightPurple,
    borderWidth: 1,
    borderColor: colors.overlayLightPurple,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  requesterTrustMetaText: {
    ...typography.meta,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  requesterTrustMetaTextStrong: {
    ...typography.metaStrong,
    color: colors.secondary,
    lineHeight: 16,
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
  filesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  fileCountBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.veryLightPurple,
    borderWidth: 1,
    borderColor: colors.overlayLightPurple,
  },
  fileCountText: {
    ...typography.metaStrong,
    color: colors.secondary,
    lineHeight: 16,
  },
  filePreview: {
    width: 98,
    height: 98,
    borderRadius: layout.borderRadiusSmall,
    backgroundColor: colors.veryLightGrey,
    borderWidth: 1,
    borderColor: colors.lightBorder,
  },
  emptyFilesText: {
    ...typography.meta,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  actionSectionCard: {
    backgroundColor: 'transparent',
    borderRadius: layout.borderRadiusMedium,
    borderWidth: 0,
    padding: 0,
    gap: spacing.xs,
  },
  primaryActionButton: {
    alignSelf: 'flex-start',
    minHeight: 36,
    borderRadius: layout.borderRadiusSmall,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  secondaryActionButton: {
    alignSelf: 'flex-start',
    minHeight: 36,
    borderRadius: layout.borderRadiusSmall,
    borderWidth: 1,
    borderColor: colors.veryLightGrey2,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  actionButtonPressed: {
    opacity: 0.72,
  },
  actionButtonDisabled: {
    opacity: 0.45,
  },
  secondaryActionText: {
    ...typography.metaStrong,
    color: colors.textPrimary,
  },
  tertiaryActionText: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
    padding: spacing.md,
  },
  modalCard: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    padding: layout.cardPadding,
    gap: spacing.sm,
  },
  modalTitle: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
  },
  modalSubtitle: {
    ...typography.meta,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  reasonList: {
    gap: spacing.xs,
  },
  reasonButton: {
    borderRadius: layout.borderRadiusSmall,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  reasonButtonSelected: {
    backgroundColor: colors.veryLightPurple,
    borderColor: colors.secondary,
  },
  reasonButtonText: {
    ...typography.metaStrong,
    color: colors.textPrimary,
  },
  reasonButtonTextSelected: {
    color: colors.secondary,
  },
  noteInput: {
    minHeight: 86,
    borderRadius: layout.borderRadiusSmall,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    backgroundColor: colors.veryLightGrey,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    color: colors.textPrimary,
    textAlignVertical: 'top',
  },
  confirmReasonCard: {
    borderRadius: layout.borderRadiusSmall,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    backgroundColor: colors.veryLightGrey,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 2,
  },
  confirmReasonLabel: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  confirmReasonValue: {
    ...typography.metaStrong,
    color: colors.textPrimary,
  },
  consequencesCard: {
    borderRadius: layout.borderRadiusSmall,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    backgroundColor: colors.veryLightGrey,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 2,
  },
  consequenceText: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  modalSecondaryButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: layout.borderRadiusSmall,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSecondaryButtonText: {
    ...typography.buttonSecondary,
    color: colors.textPrimary,
  },
  modalPrimaryButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: layout.borderRadiusSmall,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPrimaryButtonText: {
    ...typography.buttonSecondary,
    color: colors.card,
  },
  modalDangerButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: layout.borderRadiusSmall,
    backgroundColor: colors.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalDangerButtonText: {
    ...typography.buttonSecondary,
    color: colors.card,
  },
});
