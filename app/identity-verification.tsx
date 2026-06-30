import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../lib/colors';
import i18n, { useLanguage } from '../lib/i18n';
import { isPersonaSdkAvailable, launchPersonaInquiry } from '../lib/persona-sdk';
import { layout, spacing } from '../lib/spacing';
import { typography } from '../lib/typography';
import {
  fetchVerificationStatus,
  pollVerificationStatus,
  startVerificationInquiry,
  VerificationState,
  VerificationStatus,
} from '../services/identity-verification.service';

type ScreenPhase =
  | 'loading'         // initial fetch of current status
  | 'idle'            // showing call-to-action for the current status
  | 'launching'       // calling Edge Function + launching SDK
  | 'in_sdk'          // SDK is open on top
  | 'polling'         // SDK returned, waiting for webhook to flip status
  | 'error';          // soft error shown inline

export default function IdentityVerificationScreen() {
  const language = useLanguage();
  const insets = useSafeAreaInsets();
  void language;

  const [phase, setPhase] = useState<ScreenPhase>('loading');
  const [state, setState] = useState<VerificationState | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(0);
  const pollAbortRef = useRef<{ aborted: boolean }>({ aborted: false });

  // Initial status fetch — also used as the "Check again" handler.
  const refresh = useCallback(async () => {
    setPhase('loading');
    const current = await fetchVerificationStatus();
    setState(current);
    if (current?.verificationStatus === 'approved' && current.identityVerifiedAt) {
      // The root layout's gate should already have routed us out, but be
      // defensive: a direct deep-link could land here too.
      router.replace('/(tabs)');
      return;
    }
    setPhase('idle');
  }, []);

  useEffect(() => {
    refresh();
    return () => {
      pollAbortRef.current.aborted = true;
    };
  }, [refresh]);

  const onStart = useCallback(async () => {
    const mapError = (key: string) => setErrorKey(key);
    try {
      setErrorKey(null);
      setCooldownSeconds(0);
      setPhase('launching');

      // HARD GATE — do not create a Persona inquiry (and do not bump the
      // server-side retry counter) when the native module cannot launch in
      // this runtime. Without this gate, hitting "Start" inside Expo Go
      // would still create an inquiry on Persona's side that we could never
      // open, and would consume one of the user's daily retry attempts.
      if (!isPersonaSdkAvailable()) {
        console.warn('[IDENTITY_VERIFICATION] Persona SDK unavailable — not creating inquiry');
        setPhase('error');
        mapError('verification.errors.sdk_unavailable');
        return;
      }

      // For pending/rejected/expired this resumes the existing inquiry
      // (reused === true) rather than creating a duplicate one.
      const outcome = await startVerificationInquiry();

      if (!outcome.ok) {
        setPhase('error');
        switch (outcome.error.kind) {
          case 'not_authenticated':
            mapError('verification.errors.not_authenticated');
            break;
          case 'cooldown':
            setCooldownSeconds(outcome.error.retryAfterSeconds);
            mapError('verification.errors.cooldown');
            break;
          case 'retry_limit_reached':
            mapError('verification.errors.retry_limit');
            break;
          case 'server_error':
          default:
            console.error('[IDENTITY_VERIFICATION] start inquiry failed:',
              'detail' in outcome.error ? outcome.error.detail : outcome.error.kind);
            mapError('verification.errors.server');
            break;
        }
        return;
      }

      const { result } = outcome;

      // Server already says we're done — refresh and let the gate route us out.
      if (result.status === 'already_verified') {
        await refresh();
        return;
      }

      if (!result.inquiryId) {
        // The Edge Function accepted the request but didn't hand us an
        // inquiry_id. Without it, the SDK has nothing to resume into —
        // surface a server error rather than blindly invoking the SDK.
        console.error('[IDENTITY_VERIFICATION] start inquiry succeeded but returned no inquiry_id');
        setPhase('error');
        mapError('verification.errors.server');
        return;
      }

      // session_token is optional — Persona accepts the `Inquiry.fromInquiry(id)`
      // (inquiry-id-only) path.
      setPhase('in_sdk');
      const sdkResult = await launchPersonaInquiry({
        inquiryId: result.inquiryId,
        sessionToken: result.sessionToken,
      });

      if (sdkResult.outcome === 'canceled') {
        setPhase('idle');
        return;
      }
      if (sdkResult.outcome === 'error' || sdkResult.outcome === 'sdk_unavailable') {
        console.error('[IDENTITY_VERIFICATION] Persona SDK ended with',
          sdkResult.outcome, '-', 'message' in sdkResult ? sdkResult.message : '');
        setPhase('error');
        mapError(
          sdkResult.outcome === 'sdk_unavailable'
            ? 'verification.errors.sdk_unavailable'
            : 'verification.errors.sdk',
        );
        return;
      }

      // SDK completed — Persona accepted the submission, but the *decision*
      // comes via the webhook. Poll get_my_verification_status until it
      // settles (approved / rejected / manual_review / expired).
      setPhase('polling');
      pollAbortRef.current = { aborted: false };
      const settled = await pollVerificationStatus({ signal: pollAbortRef.current });
      setState(settled);
      if (settled?.verificationStatus === 'approved' && settled.identityVerifiedAt) {
        router.replace('/(tabs)');
        return;
      }
      setPhase('idle');
    } catch (e) {
      console.error('[IDENTITY_VERIFICATION] onStart failed:',
        e instanceof Error ? e.message : String(e));
      setPhase('error');
      mapError('verification.errors.server');
    }
  }, [refresh]);

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 28) }]}>
      <View style={styles.content}>
        <Text style={styles.eyebrow}>{i18n.t('verification.eyebrow')}</Text>
        <Text style={styles.headline}>{i18n.t('verification.headline')}</Text>
        <Text style={styles.subline}>{i18n.t('verification.subline')}</Text>

        <View style={styles.benefits}>
          {BENEFIT_KEYS.map((key) => (
            <View key={key} style={styles.benefitRow}>
              <View style={styles.benefitDot} />
              <Text style={styles.benefitText}>{i18n.t(`verification.benefits.${key}`)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.statusBlock}>
          <StatusBadge status={state?.verificationStatus ?? 'not_started'} />
          <Text style={styles.statusDescription}>
            {i18n.t(statusBodyKey(state?.verificationStatus ?? 'not_started'))}
          </Text>
        </View>

        {phase === 'polling' && (
          <View style={styles.pollingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.pollingText}>{i18n.t('verification.polling')}</Text>
          </View>
        )}

        {phase === 'error' && errorKey && (
          <Text style={styles.errorText}>
            {cooldownSeconds > 0
              ? i18n.t(errorKey, { seconds: cooldownSeconds })
              : i18n.t(errorKey)}
          </Text>
        )}
      </View>

      <View style={styles.bottom}>
        {renderPrimaryAction({
          phase,
          status: state?.verificationStatus ?? 'not_started',
          onStart,
          onRefresh: refresh,
        })}
      </View>
    </View>
  );
}

// ── Subviews ─────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: VerificationStatus }) {
  const palette = badgePalette(status);
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <Text style={[styles.badgeText, { color: palette.fg }]}>
        {i18n.t(`verification.status.${status}`)}
      </Text>
    </View>
  );
}

function renderPrimaryAction(args: {
  phase: ScreenPhase;
  status: VerificationStatus;
  onStart: () => void;
  onRefresh: () => void;
}) {
  const { phase, status, onStart, onRefresh } = args;

  if (phase === 'loading' || phase === 'launching' || phase === 'in_sdk' || phase === 'polling') {
    const labelKey = phase === 'launching'
      ? 'verification.cta.starting'
      : phase === 'in_sdk'
        ? 'verification.cta.in_sdk'
        : phase === 'polling'
          ? 'verification.cta.polling'
          : 'verification.cta.loading';
    return (
      <View style={[styles.cta, styles.ctaBusy]}>
        <ActivityIndicator color={colors.card} />
        <Text style={styles.ctaBusyText}>{i18n.t(labelKey)}</Text>
      </View>
    );
  }

  // Approved should not normally land here; the gate routes it away. Show a
  // disabled CTA defensively.
  if (status === 'approved') {
    return (
      <View style={[styles.cta, styles.ctaDisabled]}>
        <Text style={styles.ctaText}>{i18n.t('verification.cta.approved')}</Text>
      </View>
    );
  }

  // manual_review is the only refresh-only state: Persona already has a
  // submission and a human is deciding — relaunching would be pointless and
  // could create a duplicate inquiry.
  if (status === 'manual_review') {
    return (
      <Pressable
        style={({ pressed }) => [styles.cta, styles.ctaSecondary, pressed && styles.ctaPressed]}
        onPress={onRefresh}
      >
        <Text style={styles.ctaSecondaryText}>{i18n.t('verification.cta.check_again')}</Text>
      </Pressable>
    );
  }

  // Every remaining state launches/resumes Persona via onStart. For `pending`
  // startVerificationInquiry() resumes the existing inquiry (reused === true),
  // so no duplicate inquiry is created.
  const labelKey =
    status === 'pending'  ? 'verification.cta.resume'
    : status === 'rejected' ? 'verification.cta.retry'
    : status === 'expired'  ? 'verification.cta.restart'
    : 'verification.cta.start';

  return (
    <Pressable
      style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
      onPress={onStart}
    >
      <Text style={styles.ctaText}>{i18n.t(labelKey)}</Text>
    </Pressable>
  );
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

const BENEFIT_KEYS = ['real_people', 'nearby_safety', 'protection', 'required'] as const;

const statusBodyKey = (status: VerificationStatus): string =>
  `verification.body.${status}`;

const badgePalette = (status: VerificationStatus): { bg: string; fg: string } => {
  switch (status) {
    case 'approved':      return { bg: '#DCFCE7', fg: '#166534' };
    case 'rejected':      return { bg: '#FEE2E2', fg: '#991B1B' };
    case 'expired':       return { bg: '#FEE2E2', fg: '#991B1B' };
    case 'manual_review': return { bg: '#FEF3C7', fg: '#92400E' };
    case 'pending':       return { bg: '#DBEAFE', fg: '#1E3A8A' };
    case 'not_started':
    default:              return { bg: '#E5E7EB', fg: '#374151' };
  }
};

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: layout.screenPaddingX,
    justifyContent: 'space-between',
  },
  content: {
    flex: 1,
    paddingTop: spacing.xxl,
  },
  eyebrow: {
    ...typography.metaStrong,
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    marginBottom: spacing.sm,
  },
  headline: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.textPrimary,
    lineHeight: 38,
    letterSpacing: -0.8,
    marginBottom: spacing.md,
  },
  subline: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  benefits: {
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  benefitDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
    marginTop: 8,
  },
  benefitText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  statusBlock: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    padding: spacing.lg,
    gap: spacing.md,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  statusDescription: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  pollingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  pollingText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  errorText: {
    marginTop: spacing.lg,
    color: '#991B1B',
    fontSize: 14,
    lineHeight: 20,
  },
  bottom: {
    gap: spacing.sm,
    paddingBottom: spacing.xs,
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
  ctaBusy: { backgroundColor: colors.primary, opacity: 0.85 },
  ctaText: { ...typography.button, color: colors.card, fontSize: 17 },
  ctaBusyText: { ...typography.button, color: colors.card, fontSize: 15 },
  ctaSecondary: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  ctaSecondaryText: { ...typography.button, color: colors.primary, fontSize: 17 },
});
