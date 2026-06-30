import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
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
  isReportTargetType,
  REPORT_NOTE_MAX_LENGTH,
  reasonsForTarget,
  reportErrorKey,
  reportIntroKey,
  reportReasonKey,
  reportTitleKey,
  type ReportReason,
  type ReportTargetType,
} from '../lib/reports';
import { layout, spacing } from '../lib/spacing';
import { typography } from '../lib/typography';
import { submitReport } from '../services/reports.service';

type Phase = 'idle' | 'submitting' | 'success';

type ReportRouteParams = {
  targetType?: string | string[];
  jobId?: string | string[];
  messageId?: string | string[];
  reportedUserId?: string | string[];
};

const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

export default function ReportScreen() {
  useLanguage();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<ReportRouteParams>();

  const rawTargetType = first(params.targetType);
  const targetType: ReportTargetType = isReportTargetType(rawTargetType)
    ? rawTargetType
    : 'general';
  const reasons = useMemo(() => reasonsForTarget(targetType), [targetType]);

  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [deduplicated, setDeduplicated] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  const onSubmit = async () => {
    if (phase === 'submitting') return;
    if (!reason) {
      setErrorKey('report.choose_reason_first');
      return;
    }
    setErrorKey(null);
    setPhase('submitting');

    const outcome = await submitReport({
      targetType,
      reason,
      note,
      jobId: first(params.jobId),
      messageId: first(params.messageId),
      reportedUserId: first(params.reportedUserId),
    });

    if (outcome.ok) {
      setDeduplicated(outcome.result.deduplicated);
      setPhase('success');
      return;
    }
    setErrorKey(reportErrorKey(outcome.code));
    setPhase('idle');
  };

  // ── Success state ───────────────────────────────────────────────────────────
  if (phase === 'success') {
    return (
      <View style={[styles.root, { paddingTop: insets.top + spacing.xl, paddingBottom: Math.max(insets.bottom, 28) }]}>
        <Stack.Screen options={{ headerShown: false, presentation: 'modal' }} />
        <View style={styles.successContent}>
          <Text style={styles.successTitle}>
            {i18n.t(deduplicated ? 'report.dedup_title' : 'report.success_title')}
          </Text>
          <Text style={styles.successBody}>
            {i18n.t(deduplicated ? 'report.dedup_body' : 'report.success_body')}
          </Text>
        </View>
        <Pressable style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]} onPress={goBack}>
          <Text style={styles.ctaText}>{i18n.t('report.done')}</Text>
        </Pressable>
      </View>
    );
  }

  // ── Form ────────────────────────────────────────────────────────────────────
  const submitting = phase === 'submitting';

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.root, { paddingTop: insets.top + spacing.sm, paddingBottom: Math.max(insets.bottom, 28) }]}>
        <Stack.Screen options={{ headerShown: false, presentation: 'modal' }} />

        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={goBack} hitSlop={8}>
            <Text style={styles.backText}>{i18n.t('report.back')}</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>{i18n.t(reportTitleKey(targetType))}</Text>
          <Text style={styles.intro}>{i18n.t(reportIntroKey(targetType))}</Text>

          <Text style={styles.sectionLabel}>{i18n.t('report.reason_label')}</Text>
          <View style={styles.reasonList}>
            {reasons.map((r) => {
              const selected = r === reason;
              return (
                <Pressable
                  key={r}
                  style={({ pressed }) => [
                    styles.reasonRow,
                    selected && styles.reasonRowSelected,
                    pressed && styles.reasonRowPressed,
                  ]}
                  onPress={() => { setReason(r); setErrorKey(null); }}
                >
                  <Text style={[styles.reasonText, selected && styles.reasonTextSelected]}>
                    {i18n.t(reportReasonKey(r))}
                  </Text>
                  <View style={[styles.radio, selected && styles.radioSelected]}>
                    {selected && <View style={styles.radioDot} />}
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.sectionLabel}>{i18n.t('report.note_label')}</Text>
          <TextInput
            style={styles.noteInput}
            value={note}
            onChangeText={setNote}
            placeholder={i18n.t('report.note_placeholder')}
            placeholderTextColor={colors.textSecondary}
            multiline
            maxLength={REPORT_NOTE_MAX_LENGTH}
            textAlignVertical="top"
            editable={!submitting}
          />
          <Text style={styles.counter}>
            {i18n.t('report.note_counter', { count: note.length })}
          </Text>

          {errorKey && <Text style={styles.errorText}>{i18n.t(errorKey)}</Text>}
        </ScrollView>

        <Pressable
          style={({ pressed }) => [
            styles.cta,
            (submitting || !reason) && styles.ctaDisabled,
            pressed && !submitting && reason && styles.ctaPressed,
          ]}
          onPress={onSubmit}
          disabled={submitting || !reason}
        >
          {submitting ? (
            <>
              <ActivityIndicator color={colors.card} />
              <Text style={styles.ctaText}>{i18n.t('report.submitting')}</Text>
            </>
          ) : (
            <Text style={styles.ctaText}>{i18n.t('report.submit')}</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  root: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: layout.screenPaddingX,
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  backButton: { paddingVertical: spacing.xs, paddingRight: spacing.md },
  backText: { ...typography.button, color: colors.primary, fontSize: 16 },
  scroll: { paddingBottom: spacing.xl },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.textPrimary,
    lineHeight: 34,
    letterSpacing: -0.6,
    marginBottom: spacing.sm,
  },
  intro: {
    fontSize: 16,
    lineHeight: 23,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
  },
  sectionLabel: {
    ...typography.metaStrong,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  reasonList: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    overflow: 'hidden',
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.grey,
  },
  reasonRowSelected: { backgroundColor: '#EEF2FF' },
  reasonRowPressed: { opacity: 0.7 },
  reasonText: { fontSize: 16, color: colors.textPrimary, flex: 1, paddingRight: spacing.md },
  reasonTextSelected: { fontWeight: '700', color: colors.primary },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.grey,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  noteInput: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    padding: spacing.md,
    minHeight: 110,
    fontSize: 15,
    lineHeight: 21,
    color: colors.textPrimary,
  },
  counter: {
    alignSelf: 'flex-end',
    marginTop: spacing.xs,
    fontSize: 12,
    color: colors.textSecondary,
  },
  errorText: {
    marginTop: spacing.lg,
    color: '#991B1B',
    fontSize: 14,
    lineHeight: 20,
  },
  cta: {
    backgroundColor: colors.primary,
    borderRadius: layout.borderRadiusMedium,
    height: layout.buttonHeight + 4,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  ctaPressed: { opacity: 0.85 },
  ctaDisabled: { backgroundColor: colors.grey },
  ctaText: { ...typography.button, color: colors.card, fontSize: 17 },
  successContent: { flex: 1, justifyContent: 'center' },
  successTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.textPrimary,
    lineHeight: 32,
    letterSpacing: -0.5,
    marginBottom: spacing.md,
  },
  successBody: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.textSecondary,
  },
});
