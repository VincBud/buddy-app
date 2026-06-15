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
    const mapError = (key: string) => {
      console.log('[IDENTITY_VERIFICATION] mapped error key →', key);
      setErrorKey(key);
    };
    try {
      console.log('[IDENTITY_VERIFICATION] onStart pressed');
      setErrorKey(null);
      setCooldownSeconds(0);
      setPhase('launching');

      console.log('[IDENTITY_VERIFICATION] calling startVerificationInquiry()…');
      const outcome = await startVerificationInquiry();
      console.log('[IDENTITY_VERIFICATION] startVerificationInquiry outcome:', JSON.stringify(outcome, null, 2));

      if (!outcome.ok) {
        console.log('[IDENTITY_VERIFICATION] outcome.ok = false, error.kind =', outcome.error.kind);
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
            console.log('[IDENTITY_VERIFICATION] server_error detail:',
              'detail' in outcome.error ? outcome.error.detail : '(none)');
            mapError('verification.errors.server');
            break;
        }
        return;
      }

      const { result } = outcome;
      console.log('[IDENTITY_VERIFICATION] inquiry_id     =', result.inquiryId);
      console.log('[IDENTITY_VERIFICATION] reference_id   =', result.referenceId);
      console.log('[IDENTITY_VERIFICATION] status         =', result.status);
      console.log('[IDENTITY_VERIFICATION] session_token  =',
        result.sessionToken ? `present (len=${result.sessionToken.length})` : 'null');
      console.log('[IDENTITY_VERIFICATION] reused         =', result.reused);
      console.log('[IDENTITY_VERIFICATION] retry_count    =', result.retryCount);

      // Server already says we're done — refresh and let the gate route us out.
      if (result.status === 'already_verified') {
        console.log('[IDENTITY_VERIFICATION] status already_verified → refresh()');
        await refresh();
        return;
      }

      if (!result.inquiryId) {
        console.log('[IDENTITY_VERIFICATION] missing inquiry_id in successful response — bailing');
        setPhase('error');
        mapError('verification.errors.server');
        return;
      }

      const sdkAvailable = isPersonaSdkAvailable();
      console.log('[IDENTITY_VERIFICATION] isPersonaSdkAvailable() =', sdkAvailable);
      if (!sdkAvailable) {
        setPhase('error');
        mapError('verification.errors.sdk_unavailable');
        return;
      }

      setPhase('in_sdk');
      console.log('[IDENTITY_VERIFICATION] calling launchPersonaInquiry() with', {
        inquiryId: result.inquiryId,
        hasSessionToken: !!result.sessionToken,
      });
      const sdkResult = await launchPersonaInquiry({
        inquiryId: result.inquiryId,
        sessionToken: result.sessionToken,
      });
      console.log('[IDENTITY_VERIFICATION] launchPersonaInquiry result:', JSON.stringify(sdkResult, null, 2));

      if (sdkResult.outcome === 'canceled') {
        console.log('[IDENTITY_VERIFICATION] SDK canceled → returning to idle');
        setPhase('idle');
        return;
      }
      if (sdkResult.outcome === 'error' || sdkResult.outcome === 'sdk_unavailable') {
        console.log('[IDENTITY_VERIFICATION] SDK outcome =', sdkResult.outcome,
          'message =', 'message' in sdkResult ? sdkResult.message : '(none)');
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
      console.log('[IDENTITY_VERIFICATION] SDK completed → entering polling phase');
      setPhase('polling');
      pollAbortRef.current = { aborted: false };
      const settled = await pollVerificationStatus({ signal: pollAbortRef.current });
      console.log('[IDENTITY_VERIFICATION] poll settled with:', JSON.stringify(settled, null, 2));
      setState(settled);
      if (settled?.verificationStatus === 'approved' && settled.identityVerifiedAt) {
        console.log('[IDENTITY_VERIFICATION] approved → router.replace(/(tabs))');
        router.replace('/(tabs)');
        return;
      }
      setPhase('idle');
    } catch (e) {
      console.log('[IDENTITY_VERIFICATION] caught exception in onStart');
      console.log('[IDENTITY_VERIFICATION] exception name:', e instanceof Error ? e.name : typeof e);
      console.log('[IDENTITY_VERIFICATION] exception message:', e instanceof Error ? e.message : String(e));
      console.log('[IDENTITY_VERIFICATION] exception stack:', e instanceof Error ? e.stack : '(no stack)');
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

  if (status === 'pending' || status === 'manual_review') {
    return (
      <Pressable
        style={({ pressed }) => [styles.cta, styles.ctaSecondary, pressed && styles.ctaPressed]}
        onPress={onRefresh}
      >
        <Text style={styles.ctaSecondaryText}>{i18n.t('verification.cta.check_again')}</Text>
      </Pressable>
    );
  }

  const labelKey = status === 'rejected' || status === 'expired'
    ? 'verification.cta.retry'
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
    marginBottom: spacing.xl,
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
