import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../lib/colors';
import i18n, { useLanguage } from '../lib/i18n';
import { sendOtp, verifyOtp } from '../lib/auth';
import { layout, spacing } from '../lib/spacing';
import { typography } from '../lib/typography';

type Step = 'email' | 'otp';

export default function AuthScreen() {
  useLanguage();
  const insets = useSafeAreaInsets();
  const { mode } = useLocalSearchParams<{ mode?: 'login' | 'register' }>();
  const isRegister = mode === 'register';
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSendOtp = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      setError(i18n.t('auth.invalid_email'));
      return;
    }
    setIsLoading(true);
    setError(null);
    const result = await sendOtp(trimmed);
    setIsLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setStep('otp');
  };

  const handleVerifyOtp = async () => {
    const trimmed = otp.trim();
    if (trimmed.length < 6) {
      setError(i18n.t('auth.invalid_code'));
      return;
    }
    setIsLoading(true);
    setError(null);
    const result = await verifyOtp(email.trim().toLowerCase(), trimmed);
    setIsLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    // Auth state change listener in _layout.tsx handles the redirect
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {step === 'email' && (
        <View style={styles.header}>
          <Pressable onPress={() => router.replace('/auth-choice')} hitSlop={12} style={styles.backBtn}>
            <Text style={styles.backArrow}>←</Text>
          </Pressable>
        </View>
      )}
      <View style={styles.content}>
        {step === 'email' ? (
          <>
            <View style={styles.brandBlock}>
              <Text style={styles.brandLabel}>buddy</Text>
              <Text style={styles.heading}>
                {isRegister ? 'Konto erstellen' : i18n.t('auth.email_title')}
              </Text>
              <Text style={styles.subtitle}>{i18n.t('auth.email_subtitle')}</Text>
            </View>

            <TextInput
              style={styles.input}
              value={email}
              onChangeText={(v) => { setEmail(v); setError(null); }}
              placeholder={i18n.t('auth.email_placeholder')}
              placeholderTextColor={colors.placeholder}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              returnKeyType="go"
              onSubmitEditing={handleSendOtp}
            />

            {error && <Text style={styles.errorText}>{error}</Text>}

            <Pressable
              style={[styles.button, isLoading && styles.buttonDisabled]}
              onPress={handleSendOtp}
              disabled={isLoading}
            >
              <Text style={styles.buttonText}>
                {isLoading ? i18n.t('auth.sending') : i18n.t('auth.send_code')}
              </Text>
            </Pressable>

          </>
        ) : (
          <>
            <Text style={styles.title}>{i18n.t('auth.otp_title')}</Text>
            <Text style={styles.subtitle}>
              {i18n.t('auth.otp_subtitle', { email: email.trim() })}
            </Text>

            <TextInput
              style={[styles.input, styles.otpInput]}
              value={otp}
              onChangeText={(v) => { setOtp(v.replace(/\D/g, '')); setError(null); }}
              placeholder="000000"
              placeholderTextColor={colors.placeholder}
              keyboardType="number-pad"
              maxLength={8}
              returnKeyType="go"
              onSubmitEditing={handleVerifyOtp}
              autoFocus
            />

            {error && <Text style={styles.errorText}>{error}</Text>}

            <Pressable
              style={[styles.button, isLoading && styles.buttonDisabled]}
              onPress={handleVerifyOtp}
              disabled={isLoading}
            >
              <Text style={styles.buttonText}>
                {isLoading ? i18n.t('auth.verifying') : i18n.t('auth.verify_code')}
              </Text>
            </Pressable>

            <Pressable
              style={styles.backLink}
              onPress={() => { setStep('email'); setOtp(''); setError(null); }}
            >
              <Text style={styles.backLinkText}>{i18n.t('auth.change_email')}</Text>
            </Pressable>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: layout.screenPaddingX,
    justifyContent: 'center',
    maxWidth: 400,
    alignSelf: 'center',
    width: '100%',
  },
  brandBlock: {
    marginBottom: spacing.xxxl,
  },
  brandLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  heading: {
    ...typography.screenTitle,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    letterSpacing: -0.5,
  },
  title: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '400',
    color: colors.textSecondary,
    lineHeight: 24,
    marginBottom: spacing.xl,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.lightBorder,
    borderRadius: layout.borderRadiusSmall,
    paddingHorizontal: spacing.lg,
    height: layout.inputHeight,
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: 0,
    color: colors.textPrimary,
    backgroundColor: colors.card,
    marginBottom: spacing.md,
  },
  otpInput: {
    textAlign: 'center',
    letterSpacing: 8,
    fontSize: 24,
    fontWeight: '700',
  },
  errorText: {
    ...typography.meta,
    color: colors.red,
    marginBottom: spacing.md,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: layout.borderRadiusMedium,
    height: layout.buttonHeight,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    ...typography.button,
    color: colors.card,
  },
  header: {
    paddingHorizontal: layout.screenPaddingX,
    paddingVertical: spacing.sm,
  },
  backBtn: {
    alignSelf: 'flex-start',
    padding: spacing.xs,
  },
  backArrow: {
    fontSize: 22,
    color: colors.textPrimary,
    fontWeight: '300',
  },
  backLink: {
    alignItems: 'center',
    marginTop: spacing.xl,
    paddingVertical: spacing.sm,
  },
  backLinkText: {
    ...typography.metaStrong,
    color: colors.textSecondary,
  },
});
