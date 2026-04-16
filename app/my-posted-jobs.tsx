import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../lib/colors';
import i18n, { useLanguage } from '../lib/i18n';
import {
    applyJobExpiry,
    canExtendJob,
    extendJobExpiry,
    getActiveOwnJobs,
    getJobExpiryDisplay,
    getJobExpiryUrgency,
    getRemainingExtensions,
    Job,
    LOCAL_USER_ID,
} from '../lib/jobs';
import { layout, spacing } from '../lib/spacing';
import { typography } from '../lib/typography';

const getLocale = (): 'de' | 'en' => {
  const locale = String(i18n.locale).toLowerCase();
  return locale.startsWith('en') ? 'en' : 'de';
};

const EXTEND_OPTIONS: { label: string; ms: number }[] = [
  { label: '1h',  ms: 1  * 3600 * 1000 },
  { label: '3h',  ms: 3  * 3600 * 1000 },
  { label: '6h',  ms: 6  * 3600 * 1000 },
  { label: '12h', ms: 12 * 3600 * 1000 },
  { label: '24h', ms: 24 * 3600 * 1000 },
];

export default function MyPostedJobsScreen() {
  useLanguage();
  const insets = useSafeAreaInsets();
  const [myJobs, setMyJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [extendingJob, setExtendingJob] = useState<Job | null>(null);
  const [selectedDurationMs, setSelectedDurationMs] = useState<number>(EXTEND_OPTIONS[1].ms);
  const [cancellingJob, setCancellingJob] = useState<Job | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (successToast) {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setSuccessToast(null), 2500);
    }
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [successToast]);

  const loadMyJobs = useCallback(async () => {
    try {
      setIsLoading(true);
      const jobsRaw = await AsyncStorage.getItem('jobs');
      const parsed = jobsRaw ? JSON.parse(jobsRaw) : [];
      const safe: Job[] = Array.isArray(parsed) ? parsed : [];

      const { jobs: withExpiry, changed } = applyJobExpiry(safe);
      if (changed) {
        await AsyncStorage.setItem('jobs', JSON.stringify(withExpiry));
      }

      const active = getActiveOwnJobs(withExpiry, LOCAL_USER_ID);

      // Sort by expiresAt ascending — soonest expiry first
      active.sort((a, b) => {
        if (!a.expiresAt) return 1;
        if (!b.expiresAt) return -1;
        return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
      });

      setMyJobs(active);
    } catch {
      setMyJobs([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadMyJobs();
    }, [loadMyJobs])
  );

  const openJob = (job: Job) => {
    router.push({ pathname: '/job/[id]', params: { id: job.id } });
  };

  const openExtendModal = (job: Job) => {
    setSelectedDurationMs(EXTEND_OPTIONS[1].ms);
    setExtendingJob(job);
  };

  const confirmExtend = async () => {
    if (!extendingJob) return;
    if (!canExtendJob(extendingJob)) return;
    const jobId = extendingJob.id;
    const durationMs = selectedDurationMs;
    const chosenLabel = EXTEND_OPTIONS.find((o) => o.ms === durationMs)?.label ?? '';
    setExtendingJob(null);

    try {
      const jobsRaw = await AsyncStorage.getItem('jobs');
      const parsed = jobsRaw ? JSON.parse(jobsRaw) : [];
      const safe: Job[] = Array.isArray(parsed) ? parsed : [];

      let extendedJob: Job | null = null;
      const updatedAll = safe.map((j) => {
        if (String(j.id) === String(jobId)) {
          extendedJob = extendJobExpiry(j, durationMs);
          return extendedJob;
        }
        return j;
      });

      if (!extendedJob) return;

      await AsyncStorage.setItem('jobs', JSON.stringify(updatedAll));

      setMyJobs((prev) =>
        prev
          .map((j) => (String(j.id) === String(jobId) ? extendedJob! : j))
          .sort((a, b) => {
            if (!a.expiresAt) return 1;
            if (!b.expiresAt) return -1;
            return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
          })
      );

      setSuccessToast(
        isEn
          ? `Extended by ${chosenLabel} ✓`
          : `Laufzeit um ${chosenLabel} verlängert ✓`
      );
    } catch {
      loadMyJobs();
    }
  };

  const confirmCancel = async () => {
    if (!cancellingJob) return;
    const jobId = cancellingJob.id;
    setCancellingJob(null);

    try {
      const jobsRaw = await AsyncStorage.getItem('jobs');
      const parsed = jobsRaw ? JSON.parse(jobsRaw) : [];
      const safe: Job[] = Array.isArray(parsed) ? parsed : [];

      const updatedAll = safe.map((j) =>
        String(j.id) === String(jobId)
          ? { ...j, status: 'cancelled' as const }
          : j
      );

      await AsyncStorage.setItem('jobs', JSON.stringify(updatedAll));

      // Remove immediately from own-jobs view — no reload needed
      setMyJobs((prev) => prev.filter((j) => String(j.id) !== String(jobId)));

      setSuccessToast(isEn ? 'Job cancelled ✓' : 'Job wurde abgebrochen ✓');
    } catch {
      loadMyJobs();
    }
  };

  const locale = getLocale();
  const isEn = locale === 'en';

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          onPress={() => router.back()}
        >
          <Text style={styles.backButtonText}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>
          {isEn ? 'My Posted Jobs' : 'Meine Aufträge'}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + spacing.xxl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <Text style={styles.loadingText}>
            {isEn ? 'Loading…' : 'Wird geladen…'}
          </Text>
        ) : myJobs.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>
              {isEn ? 'No active posted jobs' : 'Keine aktiven Aufträge'}
            </Text>
            <Text style={styles.emptyHint}>
              {isEn
                ? 'Jobs you post will appear here while they are still open.'
                : 'Aufträge, die du postest, erscheinen hier solange sie offen sind.'}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.createButton, pressed && styles.pressed]}
              onPress={() => router.push('/(tabs)/create')}
            >
              <Text style={styles.createButtonText}>
                {isEn ? 'Post a job' : 'Auftrag posten'}
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.countHint}>
              {isEn
                ? `${myJobs.length} active ${myJobs.length === 1 ? 'job' : 'jobs'}`
                : `${myJobs.length} aktiver ${myJobs.length === 1 ? 'Auftrag' : 'Aufträge'}`}
            </Text>
            {myJobs.map((job) => {
              const expiryLabel = getJobExpiryDisplay(job, locale);
              const urgency = getJobExpiryUrgency(job);
              const remaining = getRemainingExtensions(job);
              const extensionsAllowed = canExtendJob(job);

              return (
                <Pressable
                  key={job.id}
                  style={({ pressed }) => [
                    styles.card,
                    urgency === 'critical' && styles.cardCritical,
                    pressed && styles.cardPressed,
                  ]}
                  onPress={() => openJob(job)}
                >
                  <View style={styles.cardTopRow}>
                    <Text style={styles.jobProblem} numberOfLines={2}>
                      {job.problem}
                    </Text>
                    <View style={styles.pricePill}>
                      <Text style={styles.priceText}>{job.price}€</Text>
                    </View>
                  </View>

                  <View style={styles.cardBottomRow}>
                    <View style={styles.timeModeChip}>
                      <Text style={styles.timeModeText}>
                        {job.timeMode === 'sofort'
                          ? `⚡ ${isEn ? 'Now' : 'Sofort'}`
                          : job.timeMode === 'flexibel'
                          ? isEn ? 'Flexible' : 'Flexibel'
                          : isEn ? 'Scheduled' : 'Termin'}
                      </Text>
                    </View>

                    {expiryLabel && (
                      <View
                        style={[
                          styles.expiryChip,
                          urgency === 'soon' && styles.expiryChipSoon,
                          urgency === 'critical' && styles.expiryChipCritical,
                        ]}
                      >
                        <Text
                          style={[
                            styles.expiryText,
                            urgency === 'soon' && styles.expiryTextSoon,
                            urgency === 'critical' && styles.expiryTextCritical,
                          ]}
                        >
                          {expiryLabel}
                        </Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.cardFooter}>
                    <View style={styles.cardActionRow}>
                      <Pressable
                        style={({ pressed }) => [
                          styles.cancelJobButton,
                          pressed && styles.cancelJobButtonPressed,
                        ]}
                        onPress={() => setCancellingJob(job)}
                        hitSlop={8}
                      >
                        <Text style={styles.cancelJobButtonText}>
                          {isEn ? 'Cancel' : 'Abbrechen'}
                        </Text>
                      </Pressable>

                      <Text style={styles.extensionsHint}>
                        {extensionsAllowed
                          ? remaining === 1
                            ? isEn ? 'Last extension' : 'Letzte Verlängerung'
                            : isEn ? `${remaining} extensions left` : `Noch ${remaining} Verlängerungen`
                          : isEn ? 'Limit reached' : 'Limit erreicht'}
                      </Text>

                      <Pressable
                        style={({ pressed }) => [
                          styles.extendButton,
                          urgency === 'critical' && extensionsAllowed && styles.extendButtonCritical,
                          !extensionsAllowed && styles.extendButtonDisabled,
                          pressed && extensionsAllowed && styles.extendButtonPressed,
                        ]}
                        onPress={() => extensionsAllowed && openExtendModal(job)}
                        hitSlop={8}
                        disabled={!extensionsAllowed}
                      >
                        <Text
                          style={[
                            styles.extendButtonText,
                            urgency === 'critical' && extensionsAllowed && styles.extendButtonTextCritical,
                            !extensionsAllowed && styles.extendButtonTextDisabled,
                          ]}
                        >
                          {isEn ? '+ Extend' : '+ Verlängern'}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </>
        )}
      </ScrollView>

      <Modal
        visible={extendingJob !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setExtendingJob(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setExtendingJob(null)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>
              {isEn ? 'Extend runtime' : 'Laufzeit verlängern'}
            </Text>
            {extendingJob && (
              <Text style={styles.modalJobLabel} numberOfLines={1}>
                {extendingJob.problem}
              </Text>
            )}
            <Text style={styles.modalDurationHint}>
              {isEn ? 'Choose duration' : 'Dauer wählen'}
            </Text>
            {extendingJob && (
              <Text style={styles.modalExtensionsHint}>
                {(() => {
                  const r = getRemainingExtensions(extendingJob);
                  if (r === 1) return isEn ? 'Last extension available' : 'Letzte verfügbare Verlängerung';
                  return isEn ? `${r} extensions remaining` : `Noch ${r} Verlängerungen verfügbar`;
                })()}
              </Text>
            )}
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
                  <Text
                    style={[
                      styles.durationOptionText,
                      selectedDurationMs === opt.ms && styles.durationOptionTextSelected,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              style={({ pressed }) => [styles.confirmButton, pressed && styles.confirmButtonPressed]}
              onPress={confirmExtend}
            >
              <Text style={styles.confirmButtonText}>
                {isEn ? 'Confirm' : 'Bestätigen'}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
              onPress={() => setExtendingJob(null)}
            >
              <Text style={styles.cancelButtonText}>
                {isEn ? 'Cancel' : 'Abbrechen'}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={cancellingJob !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setCancellingJob(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setCancellingJob(null)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>
              {isEn ? 'Cancel job?' : 'Job abbrechen?'}
            </Text>
            {cancellingJob && (
              <Text style={styles.modalJobLabel} numberOfLines={1}>
                {cancellingJob.problem}
              </Text>
            )}
            <Text style={styles.cancelWarningText}>
              {isEn
                ? 'This job will be closed and removed from the marketplace. This cannot be undone.'
                : 'Dieser Auftrag wird geschlossen und aus dem Marktplatz entfernt. Diese Aktion kann nicht rückgängig gemacht werden.'}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.confirmCancelButton, pressed && styles.confirmButtonPressed]}
              onPress={confirmCancel}
            >
              <Text style={styles.confirmCancelButtonText}>
                {isEn ? 'Yes, cancel job' : 'Ja, Job abbrechen'}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
              onPress={() => setCancellingJob(null)}
            >
              <Text style={styles.cancelButtonText}>
                {isEn ? 'Go back' : 'Zurück'}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {successToast && (
        <View style={[styles.toast, { bottom: insets.bottom + spacing.xxl }]} pointerEvents="none">
          <Text style={styles.toastText}>{successToast}</Text>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.screenPaddingX,
    paddingBottom: spacing.lg,
    backgroundColor: colors.background,
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
    fontSize: 22,
    fontWeight: '600',
    color: colors.textPrimary,
    lineHeight: 26,
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
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: layout.screenPaddingX,
    paddingTop: spacing.sm,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xxl,
  },
  emptyState: {
    marginTop: spacing.xxl,
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    padding: layout.cardPadding,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  emptyTitle: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  emptyHint: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.xl,
  },
  createButton: {
    backgroundColor: colors.primary,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignSelf: 'flex-start',
  },
  createButtonText: {
    ...typography.button,
    color: colors.card,
  },
  countHint: {
    ...typography.meta,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    padding: spacing.lg,
    marginBottom: layout.cardMarginBottom,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  cardPressed: {
    opacity: 0.97,
    transform: [{ scale: 0.992 }],
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  jobProblem: {
    flex: 1,
    ...typography.cardTitle,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  pricePill: {
    backgroundColor: colors.lightOrange,
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: '#FFD4C7',
  },
  priceText: {
    ...typography.metaStrong,
    color: colors.primary,
    fontWeight: '800',
  },
  cardBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
    marginBottom: spacing.sm,
  },
  timeModeChip: {
    backgroundColor: colors.veryLightPurple,
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.overlayLightPurple,
  },
  timeModeText: {
    ...typography.meta,
    color: colors.secondary,
    fontWeight: '600',
  },
  expiryChip: {
    backgroundColor: colors.lightGrey,
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  expiryChipSoon: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  expiryChipCritical: {
    backgroundColor: '#FFF4F0',
    borderColor: '#FFCFC0',
  },
  expiryText: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  expiryTextSoon: {
    color: '#92400E',
    fontWeight: '700',
  },
  expiryTextCritical: {
    color: colors.primary,
    fontWeight: '700',
  },
  cardCritical: {
    borderColor: '#FFCFC0',
  },
  cardFooter: {
    borderTopWidth: 1,
    borderTopColor: colors.lightBorder,
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
  },
  cardActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  extendButton: {
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.veryLightPurple,
    borderWidth: 1,
    borderColor: colors.overlayLightPurple,
  },
  extendButtonCritical: {
    backgroundColor: '#FFF4F0',
    borderColor: '#FFCFC0',
  },
  extendButtonPressed: {
    opacity: 0.75,
  },
  extendButtonText: {
    fontSize: 13,
    fontWeight: '700' as const,
    lineHeight: 17,
    color: colors.secondary,
  },
  extendButtonTextCritical: {
    color: colors.primary,
  },
  extendButtonDisabled: {
    backgroundColor: colors.lightGrey,
    borderColor: colors.border,
    opacity: 0.55,
  },
  extendButtonTextDisabled: {
    color: colors.placeholder,
  },
  extensionsHint: {
    flex: 1,
    fontSize: 11,
    fontWeight: '400' as const,
    lineHeight: 14,
    color: colors.placeholder,
    textAlign: 'center',
    paddingHorizontal: spacing.xs,
  },
  cancelJobButton: {
    borderRadius: 7,
    paddingVertical: 5,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'transparent',
  },
  cancelJobButtonPressed: {
    opacity: 0.55,
  },
  cancelJobButtonText: {
    fontSize: 12,
    fontWeight: '500' as const,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  cancelWarningText: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.xl,
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
  pressed: {
    opacity: 0.9,
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
  modalJobLabel: {
    ...typography.meta,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
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
  confirmButtonPressed: {
    opacity: 0.88,
  },
  confirmButtonText: {
    ...typography.button,
    color: colors.card,
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  cancelButtonText: {
    ...typography.meta,
    color: colors.textSecondary,
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
  toastText: {
    ...typography.metaStrong,
    color: colors.card,
    textAlign: 'center',
  },
});
