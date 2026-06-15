import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../lib/colors';
import i18n, { useLanguage } from '../lib/i18n';
import {
    applyJobExpiry,
    canExtendJob,
    canRepostJob,
    extendJobExpiry,
    getActiveOwnJobs,
    getHistoricalOwnJobs,
    getJobExpiryDisplay,
    getJobExpiryUrgency,
    getPausedOwnJobs,
    getRemainingExtensions,
    isJobEditable,
    isJobPauseable,
    Job,
    TimeMode,
} from '../lib/jobs';
import { getActiveUserId } from '../lib/auth';
import {
    cancelJob,
    editJobFields,
    EditableJobFields,
    pauseJob,
    repostJob,
    resumeJob,
} from '../lib/job-actions';
import { loadJobs, saveJobs } from '../services/jobs.service';
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

const TIME_MODES: TimeMode[] = ['sofort', 'flexibel', 'termin'];

export default function MyPostedJobsScreen() {
  useLanguage();
  const insets = useSafeAreaInsets();

  const [activeJobs, setActiveJobs] = useState<Job[]>([]);
  const [pausedJobs, setPausedJobs] = useState<Job[]>([]);
  const [historicalJobs, setHistoricalJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [extendingJob, setExtendingJob] = useState<Job | null>(null);
  const [selectedDurationMs, setSelectedDurationMs] = useState<number>(EXTEND_OPTIONS[1].ms);
  const [cancellingJob, setCancellingJob] = useState<Job | null>(null);
  const [pausingJob, setPausingJob] = useState<Job | null>(null);
  const [repostingJob, setRepostingJob] = useState<Job | null>(null);

  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [editProblem, setEditProblem] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editTimeMode, setEditTimeMode] = useState<TimeMode>('sofort');
  const [editAppointmentDate, setEditAppointmentDate] = useState('');
  const [editAppointmentTime, setEditAppointmentTime] = useState('');

  const [successToast, setSuccessToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const errorToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (successToast) {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setSuccessToast(null), 2500);
    }
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [successToast]);

  useEffect(() => {
    if (errorToast) {
      if (errorToastTimer.current) clearTimeout(errorToastTimer.current);
      errorToastTimer.current = setTimeout(() => setErrorToast(null), 2500);
    }
    return () => {
      if (errorToastTimer.current) clearTimeout(errorToastTimer.current);
    };
  }, [errorToast]);

  const loadMyJobs = useCallback(async () => {
    try {
      setIsLoading(true);
      const safe = await loadJobs();

      const { jobs: withExpiry, changed } = applyJobExpiry(safe);
      if (changed) {
        await saveJobs(withExpiry);
      }

      const activeUserId = getActiveUserId();
      const active = getActiveOwnJobs(withExpiry, activeUserId);
      active.sort((a, b) => {
        if (!a.expiresAt) return 1;
        if (!b.expiresAt) return -1;
        return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
      });

      const paused = getPausedOwnJobs(withExpiry, activeUserId);
      const historical = getHistoricalOwnJobs(withExpiry, activeUserId);
      historical.sort((a, b) =>
        new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() -
        new Date(a.updatedAt ?? a.createdAt ?? 0).getTime()
      );

      setActiveJobs(active);
      setPausedJobs(paused);
      setHistoricalJobs(historical);
    } catch {
      setActiveJobs([]);
      setPausedJobs([]);
      setHistoricalJobs([]);
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

  // --- Extend ---
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
      const safe = await loadJobs();

      let extendedJob: Job | null = null;
      const updatedAll = safe.map((j) => {
        if (String(j.id) === String(jobId)) {
          extendedJob = extendJobExpiry(j, durationMs);
          return extendedJob;
        }
        return j;
      });

      if (!extendedJob) return;

      await saveJobs(updatedAll);

      setActiveJobs((prev) =>
        prev
          .map((j) => (String(j.id) === String(jobId) ? extendedJob! : j))
          .sort((a, b) => {
            if (!a.expiresAt) return 1;
            if (!b.expiresAt) return -1;
            return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
          })
      );

      setSuccessToast(isEn ? `Extended by ${chosenLabel} ✓` : `Laufzeit um ${chosenLabel} verlängert ✓`);
    } catch {
      loadMyJobs();
      setErrorToast(isEn ? 'Could not extend job.' : 'Verlängerung fehlgeschlagen.');
    }
  };

  // --- Cancel ---
  const confirmCancel = async () => {
    if (!cancellingJob) return;
    const jobId = cancellingJob.id;
    setCancellingJob(null);

    try {
      await cancelJob({ jobId, cancelledByRole: 'auftraggeber', reason: 'no_longer_needed' });
      setActiveJobs((prev) => prev.filter((j) => String(j.id) !== String(jobId)));
      setSuccessToast(isEn ? 'Job cancelled ✓' : 'Job wurde abgebrochen ✓');
    } catch {
      loadMyJobs();
      setErrorToast(isEn ? 'Could not cancel job.' : 'Abbrechen fehlgeschlagen.');
    }
  };

  // --- Pause ---
  const confirmPause = async () => {
    if (!pausingJob) return;
    const job = pausingJob;
    setPausingJob(null);

    try {
      const { updatedJob } = await pauseJob({ jobId: job.id, ownerId: getActiveUserId() });
      if (!updatedJob) return;
      setActiveJobs((prev) => prev.filter((j) => String(j.id) !== String(job.id)));
      setPausedJobs((prev) => [updatedJob, ...prev]);
      setSuccessToast(isEn ? 'Job paused ✓' : 'Job pausiert ✓');
    } catch {
      loadMyJobs();
      setErrorToast(isEn ? 'Could not pause job.' : 'Pausieren fehlgeschlagen.');
    }
  };

  // --- Resume ---
  const confirmResume = async (job: Job) => {
    try {
      const { updatedJob } = await resumeJob({ jobId: job.id, ownerId: getActiveUserId() });
      if (!updatedJob) return;
      setPausedJobs((prev) => prev.filter((j) => String(j.id) !== String(job.id)));
      setActiveJobs((prev) =>
        [updatedJob, ...prev].sort((a, b) => {
          if (!a.expiresAt) return 1;
          if (!b.expiresAt) return -1;
          return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
        })
      );
      setSuccessToast(isEn ? 'Job resumed ✓' : 'Job fortgesetzt ✓');
    } catch {
      loadMyJobs();
      setErrorToast(isEn ? 'Could not resume job.' : 'Fortsetzen fehlgeschlagen.');
    }
  };

  // --- Repost ---
  const confirmRepost = async () => {
    if (!repostingJob) return;
    const job = repostingJob;
    setRepostingJob(null);

    if (!canRepostJob(job)) {
      setErrorToast(isEn ? 'Repost window has expired.' : 'Erneut posten nicht mehr möglich.');
      return;
    }

    try {
      const { newJob } = await repostJob({ sourceJobId: job.id, ownerId: getActiveUserId() });
      if (!newJob) return;
      setActiveJobs((prev) => [newJob, ...prev]);
      setSuccessToast(isEn ? 'Job reposted ✓' : 'Job erneut gepostet ✓');
    } catch {
      loadMyJobs();
      setErrorToast(isEn ? 'Could not repost job.' : 'Erneut posten fehlgeschlagen.');
    }
  };

  // --- Edit ---
  const openEditModal = (job: Job) => {
    setEditProblem(job.problem ?? '');
    setEditPrice(job.price ?? '');
    setEditTimeMode(job.timeMode ?? 'sofort');
    setEditAppointmentDate(job.appointmentDate ?? '');
    setEditAppointmentTime(job.appointmentTime ?? '');
    setEditingJob(job);
  };

  const confirmEdit = async () => {
    if (!editingJob) return;
    const job = editingJob;
    setEditingJob(null);

    const fields: EditableJobFields = {
      problem: editProblem.trim() || job.problem,
      price: editPrice.trim() || job.price,
      timeMode: editTimeMode,
      appointmentDate: editTimeMode === 'termin' ? editAppointmentDate.trim() : undefined,
      appointmentTime: editTimeMode === 'termin' ? editAppointmentTime.trim() : undefined,
    };

    try {
      const { updatedJob } = await editJobFields({
        jobId: job.id,
        ownerId: getActiveUserId(),
        fields,
      });
      if (!updatedJob) return;
      setActiveJobs((prev) =>
        prev.map((j) => (String(j.id) === String(job.id) ? updatedJob : j))
      );
      setSuccessToast(isEn ? 'Job updated ✓' : 'Job aktualisiert ✓');
    } catch {
      loadMyJobs();
      setErrorToast(isEn ? 'Could not update job.' : 'Aktualisieren fehlgeschlagen.');
    }
  };

  const locale = getLocale();
  const isEn = locale === 'en';

  const totalCount = activeJobs.length + pausedJobs.length;

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
        ) : totalCount === 0 && historicalJobs.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>
              {isEn ? 'No posted jobs yet' : 'Noch keine Aufträge'}
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
            {/* Active (open) jobs */}
            {activeJobs.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>
                  {isEn ? `Active · ${activeJobs.length}` : `Aktiv · ${activeJobs.length}`}
                </Text>
                {activeJobs.map((job) => {
                  const expiryLabel = getJobExpiryDisplay(job, locale);
                  const urgency = getJobExpiryUrgency(job);
                  const remaining = getRemainingExtensions(job);
                  const extensionsAllowed = canExtendJob(job);
                  const canEdit = isJobEditable(job);
                  const canPause = isJobPauseable(job);

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

                      {(canEdit || canPause) && (
                        <View style={styles.ownerActionRow}>
                          {canEdit && (
                            <Pressable
                              style={({ pressed }) => [styles.ownerActionBtn, pressed && styles.ownerActionBtnPressed]}
                              onPress={() => openEditModal(job)}
                              hitSlop={6}
                            >
                              <Text style={styles.ownerActionBtnText}>
                                {isEn ? 'Edit' : 'Bearbeiten'}
                              </Text>
                            </Pressable>
                          )}
                          {canPause && (
                            <Pressable
                              style={({ pressed }) => [styles.ownerActionBtn, pressed && styles.ownerActionBtnPressed]}
                              onPress={() => setPausingJob(job)}
                              hitSlop={6}
                            >
                              <Text style={styles.ownerActionBtnText}>
                                {isEn ? 'Pause' : 'Pausieren'}
                              </Text>
                            </Pressable>
                          )}
                        </View>
                      )}

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

            {/* Paused jobs */}
            {pausedJobs.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>
                  {isEn ? `Paused · ${pausedJobs.length}` : `Pausiert · ${pausedJobs.length}`}
                </Text>
                {pausedJobs.map((job) => (
                  <Pressable
                    key={job.id}
                    style={({ pressed }) => [styles.card, styles.cardPaused, pressed && styles.cardPressed]}
                    onPress={() => openJob(job)}
                  >
                    <View style={styles.cardTopRow}>
                      <Text style={[styles.jobProblem, styles.textMuted]} numberOfLines={2}>
                        {job.problem}
                      </Text>
                      <View style={[styles.pricePill, styles.pricePillMuted]}>
                        <Text style={[styles.priceText, styles.textMuted]}>{job.price}€</Text>
                      </View>
                    </View>

                    <View style={styles.cardBottomRow}>
                      <View style={styles.pausedBadge}>
                        <Text style={styles.pausedBadgeText}>
                          {isEn ? 'Paused' : 'Pausiert'}
                        </Text>
                      </View>
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

                        <View style={{ flex: 1 }} />

                        <Pressable
                          style={({ pressed }) => [
                            styles.resumeButton,
                            pressed && styles.extendButtonPressed,
                          ]}
                          onPress={() => confirmResume(job)}
                          hitSlop={8}
                        >
                          <Text style={styles.resumeButtonText}>
                            {isEn ? '▶ Resume' : '▶ Fortsetzen'}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  </Pressable>
                ))}
              </>
            )}

            {/* Historical jobs */}
            {historicalJobs.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>
                  {isEn ? 'History' : 'Verlauf'}
                </Text>
                {historicalJobs.map((job) => (
                  <Pressable
                    key={job.id}
                    style={({ pressed }) => [styles.card, styles.cardMuted, pressed && styles.cardPressed]}
                    onPress={() => openJob(job)}
                  >
                    <View style={styles.cardTopRow}>
                      <Text style={[styles.jobProblem, styles.textMuted]} numberOfLines={2}>
                        {job.problem}
                      </Text>
                      <View style={[styles.pricePill, styles.pricePillMuted]}>
                        <Text style={[styles.priceText, styles.textMuted]}>{job.price}€</Text>
                      </View>
                    </View>

                    <View style={[styles.cardBottomRow, { marginBottom: 0 }]}>
                      <View
                        style={[
                          styles.statusBadge,
                          job.status === 'completed' && styles.statusBadgeCompleted,
                          job.status === 'expired' && styles.statusBadgeExpired,
                          job.status === 'cancelled' && styles.statusBadgeCancelled,
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusBadgeText,
                            job.status === 'completed' && styles.statusBadgeTextCompleted,
                            job.status === 'expired' && styles.statusBadgeTextExpired,
                            job.status === 'cancelled' && styles.statusBadgeTextCancelled,
                          ]}
                        >
                          {job.status === 'completed'
                            ? isEn ? 'Completed' : 'Abgeschlossen'
                            : job.status === 'expired'
                            ? isEn ? 'Expired' : 'Abgelaufen'
                            : isEn ? 'Cancelled' : 'Abgebrochen'}
                        </Text>
                      </View>

                      <Pressable
                        style={({ pressed }) => [
                          styles.repostButton,
                          pressed && styles.extendButtonPressed,
                        ]}
                        onPress={() => setRepostingJob(job)}
                        hitSlop={8}
                      >
                        <Text style={styles.repostButtonText}>
                          {isEn ? '↩ Repost' : '↩ Erneut posten'}
                        </Text>
                      </Pressable>
                    </View>
                  </Pressable>
                ))}
              </>
            )}

            {totalCount === 0 && historicalJobs.length > 0 && (
              <Pressable
                style={({ pressed }) => [styles.createButton, { alignSelf: 'center', marginBottom: spacing.xl }, pressed && styles.pressed]}
                onPress={() => router.push('/(tabs)/create')}
              >
                <Text style={styles.createButtonText}>
                  {isEn ? '+ Post a new job' : '+ Neuen Auftrag posten'}
                </Text>
              </Pressable>
            )}
          </>
        )}
      </ScrollView>

      {/* Extend modal */}
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

      {/* Cancel modal */}
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

      {/* Pause modal */}
      <Modal
        visible={pausingJob !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setPausingJob(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setPausingJob(null)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>
              {isEn ? 'Pause job?' : 'Job pausieren?'}
            </Text>
            {pausingJob && (
              <Text style={styles.modalJobLabel} numberOfLines={1}>
                {pausingJob.problem}
              </Text>
            )}
            <Text style={styles.cancelWarningText}>
              {isEn
                ? 'Your job will be hidden from the feed until you resume it. Applicants won\'t see it, but no data is lost.'
                : 'Dein Auftrag wird im Feed ausgeblendet, bis du ihn fortsetzt. Bewerber sehen ihn nicht, aber alle Daten bleiben erhalten.'}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.confirmButton, pressed && styles.confirmButtonPressed]}
              onPress={confirmPause}
            >
              <Text style={styles.confirmButtonText}>
                {isEn ? 'Pause job' : 'Job pausieren'}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
              onPress={() => setPausingJob(null)}
            >
              <Text style={styles.cancelButtonText}>
                {isEn ? 'Go back' : 'Zurück'}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Repost modal */}
      <Modal
        visible={repostingJob !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setRepostingJob(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setRepostingJob(null)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>
              {isEn ? 'Repost job?' : 'Job erneut posten?'}
            </Text>
            {repostingJob && (
              <Text style={styles.modalJobLabel} numberOfLines={1}>
                {repostingJob.problem}
              </Text>
            )}
            <Text style={styles.cancelWarningText}>
              {isEn
                ? 'A fresh copy of this job will be posted to the marketplace. The original stays in your history.'
                : 'Eine neue Kopie dieses Auftrags wird im Marktplatz gepostet. Das Original bleibt in deinem Verlauf.'}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.confirmButton, pressed && styles.confirmButtonPressed]}
              onPress={confirmRepost}
            >
              <Text style={styles.confirmButtonText}>
                {isEn ? 'Yes, repost' : 'Ja, erneut posten'}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
              onPress={() => setRepostingJob(null)}
            >
              <Text style={styles.cancelButtonText}>
                {isEn ? 'Cancel' : 'Abbrechen'}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Edit modal */}
      <Modal
        visible={editingJob !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setEditingJob(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setEditingJob(null)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>
              {isEn ? 'Edit job' : 'Auftrag bearbeiten'}
            </Text>

            <Text style={styles.editFieldLabel}>
              {isEn ? 'Description' : 'Beschreibung'}
            </Text>
            <TextInput
              style={styles.editTextArea}
              value={editProblem}
              onChangeText={setEditProblem}
              multiline
              numberOfLines={3}
              placeholder={isEn ? 'What do you need help with?' : 'Wobei brauchst du Hilfe?'}
              placeholderTextColor={colors.placeholder}
            />

            <Text style={styles.editFieldLabel}>
              {isEn ? 'Price (€)' : 'Preis (€)'}
            </Text>
            <TextInput
              style={styles.editInput}
              value={editPrice}
              onChangeText={setEditPrice}
              keyboardType="decimal-pad"
              placeholder="20"
              placeholderTextColor={colors.placeholder}
            />

            <Text style={styles.editFieldLabel}>
              {isEn ? 'Timing' : 'Zeit'}
            </Text>
            <View style={styles.timeModeRow}>
              {TIME_MODES.map((mode) => (
                <Pressable
                  key={mode}
                  style={[
                    styles.timeModeOption,
                    editTimeMode === mode && styles.timeModeOptionSelected,
                  ]}
                  onPress={() => setEditTimeMode(mode)}
                >
                  <Text
                    style={[
                      styles.timeModeOptionText,
                      editTimeMode === mode && styles.timeModeOptionTextSelected,
                    ]}
                  >
                    {mode === 'sofort'
                      ? isEn ? 'Now' : 'Sofort'
                      : mode === 'flexibel'
                      ? isEn ? 'Flexible' : 'Flexibel'
                      : isEn ? 'Scheduled' : 'Termin'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {editTimeMode === 'termin' && (
              <>
                <Text style={styles.editFieldLabel}>
                  {isEn ? 'Date (DD.MM.YYYY)' : 'Datum (TT.MM.JJJJ)'}
                </Text>
                <TextInput
                  style={styles.editInput}
                  value={editAppointmentDate}
                  onChangeText={setEditAppointmentDate}
                  placeholder="17.04.2026"
                  placeholderTextColor={colors.placeholder}
                  keyboardType="numbers-and-punctuation"
                />
                <Text style={styles.editFieldLabel}>
                  {isEn ? 'Time (HH:MM)' : 'Uhrzeit (HH:MM)'}
                </Text>
                <TextInput
                  style={styles.editInput}
                  value={editAppointmentTime}
                  onChangeText={setEditAppointmentTime}
                  placeholder="14:00"
                  placeholderTextColor={colors.placeholder}
                  keyboardType="numbers-and-punctuation"
                />
              </>
            )}

            <Pressable
              style={({ pressed }) => [styles.confirmButton, { marginTop: spacing.lg }, pressed && styles.confirmButtonPressed]}
              onPress={confirmEdit}
            >
              <Text style={styles.confirmButtonText}>
                {isEn ? 'Save changes' : 'Änderungen speichern'}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
              onPress={() => setEditingJob(null)}
            >
              <Text style={styles.cancelButtonText}>
                {isEn ? 'Cancel' : 'Abbrechen'}
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
      {errorToast && (
        <View style={[styles.toast, styles.toastError, { bottom: insets.bottom + spacing.xxl }]} pointerEvents="none">
          <Text style={styles.toastText}>{errorToast}</Text>
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
  sectionLabel: {
    ...typography.metaStrong,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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
  cardPaused: {
    borderColor: colors.overlayLightPurple,
    backgroundColor: colors.veryLightPurple,
  },
  cardMuted: {
    opacity: 0.75,
  },
  cardCritical: {
    borderColor: '#FFCFC0',
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
  textMuted: {
    color: colors.textSecondary,
  },
  pricePill: {
    backgroundColor: colors.lightOrange,
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: '#FFD4C7',
  },
  pricePillMuted: {
    backgroundColor: colors.lightGrey,
    borderColor: colors.border,
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
  ownerActionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  ownerActionBtn: {
    borderRadius: 7,
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.overlayLightPurple,
    backgroundColor: colors.veryLightPurple,
  },
  ownerActionBtnPressed: {
    opacity: 0.6,
  },
  ownerActionBtnText: {
    fontSize: 12,
    fontWeight: '600' as const,
    lineHeight: 16,
    color: colors.secondary,
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
  pausedBadge: {
    backgroundColor: colors.veryLightPurple,
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.overlayLightPurple,
  },
  pausedBadgeText: {
    ...typography.meta,
    color: colors.secondary,
    fontWeight: '600',
  },
  resumeButton: {
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.secondary,
    borderWidth: 1,
    borderColor: colors.secondary,
  },
  resumeButtonText: {
    fontSize: 13,
    fontWeight: '700' as const,
    lineHeight: 17,
    color: colors.card,
  },
  statusBadge: {
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    backgroundColor: colors.lightGrey,
    borderColor: colors.border,
  },
  statusBadgeCompleted: {
    backgroundColor: '#F0FDF4',
    borderColor: '#86EFAC',
  },
  statusBadgeExpired: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  statusBadgeCancelled: {
    backgroundColor: '#FFF4F0',
    borderColor: '#FFCFC0',
  },
  statusBadgeText: {
    ...typography.meta,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  statusBadgeTextCompleted: {
    color: '#166534',
  },
  statusBadgeTextExpired: {
    color: '#92400E',
  },
  statusBadgeTextCancelled: {
    color: colors.primary,
  },
  repostButton: {
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.lightGrey,
    borderWidth: 1,
    borderColor: colors.border,
    marginLeft: 'auto',
  },
  repostButtonText: {
    fontSize: 13,
    fontWeight: '700' as const,
    lineHeight: 17,
    color: colors.textPrimary,
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
  editFieldLabel: {
    ...typography.metaStrong,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  editInput: {
    backgroundColor: colors.background,
    borderRadius: layout.borderRadiusSmall,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    ...typography.body,
    color: colors.textPrimary,
  },
  editTextArea: {
    backgroundColor: colors.background,
    borderRadius: layout.borderRadiusSmall,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    ...typography.body,
    color: colors.textPrimary,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  timeModeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  timeModeOption: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.lightGrey,
    borderWidth: 1,
    borderColor: colors.border,
  },
  timeModeOptionSelected: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary,
  },
  timeModeOptionText: {
    ...typography.meta,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  timeModeOptionTextSelected: {
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
  toastError: {
    backgroundColor: colors.red,
  },
});
