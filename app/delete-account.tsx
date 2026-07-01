import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
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
import { signOut } from '../services/auth.service';
import { deleteAccount } from '../services/account.service';
import { layout, spacing } from '../lib/spacing';
import { typography } from '../lib/typography';

const DANGER = '#991B1B';

export default function DeleteAccountScreen() {
  useLanguage();
  const insets = useSafeAreaInsets();

  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const confirmWord = i18n.t('deleteAccount.confirm_word'); // "LÖSCHEN" / "DELETE"
  const canDelete = confirmText.trim().toUpperCase() === confirmWord.toUpperCase();

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/profile');
  };

  const onConfirmDelete = async () => {
    if (!canDelete || submitting) return;
    setErrorKey(null);
    setSubmitting(true);

    const outcome = await deleteAccount();

    if (outcome.ok) {
      // Account is gone server-side — clear the local session and leave the app.
      await signOut();
      router.replace('/welcome');
      return;
    }

    setSubmitting(false);
    setErrorKey(
      outcome.code === 'active_jobs_exist'
        ? 'deleteAccount.error_active_jobs'
        : 'deleteAccount.error_generic',
    );
  };

  const WARNINGS = ['permanent', 'data', 'active_jobs', 'reports'] as const;

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm, paddingBottom: Math.max(insets.bottom, 28) }]}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={goBack} hitSlop={8} disabled={submitting}>
          <Text style={styles.backText}>{i18n.t('deleteAccount.back')}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>{i18n.t('deleteAccount.title')}</Text>
        <Text style={styles.body}>{i18n.t('deleteAccount.body')}</Text>

        <View style={styles.warnBlock}>
          {WARNINGS.map((k) => (
            <View key={k} style={styles.warnRow}>
              <View style={styles.warnDot} />
              <Text style={styles.warnText}>{i18n.t(`deleteAccount.warn_${k}`)}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.confirmLabel}>
          {i18n.t('deleteAccount.confirm_label', { word: confirmWord })}
        </Text>
        <TextInput
          style={styles.input}
          value={confirmText}
          onChangeText={setConfirmText}
          placeholder={confirmWord}
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!submitting}
        />

        {errorKey && <Text style={styles.errorText}>{i18n.t(errorKey)}</Text>}
      </ScrollView>

      <View style={styles.bottom}>
        <Pressable
          style={({ pressed }) => [
            styles.deleteBtn,
            (!canDelete || submitting) && styles.deleteBtnDisabled,
            pressed && canDelete && !submitting && styles.deleteBtnPressed,
          ]}
          onPress={onConfirmDelete}
          disabled={!canDelete || submitting}
        >
          {submitting ? (
            <>
              <ActivityIndicator color={colors.card} />
              <Text style={styles.deleteBtnText}>{i18n.t('deleteAccount.deleting')}</Text>
            </>
          ) : (
            <Text style={styles.deleteBtnText}>{i18n.t('deleteAccount.confirm_button')}</Text>
          )}
        </Pressable>

        <Pressable style={styles.cancelBtn} onPress={goBack} disabled={submitting}>
          <Text style={styles.cancelText}>{i18n.t('deleteAccount.cancel')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: layout.screenPaddingX,
    justifyContent: 'space-between',
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  backButton: { paddingVertical: spacing.xs, paddingRight: spacing.md },
  backText: { ...typography.button, color: colors.primary, fontSize: 16 },
  scroll: { paddingBottom: spacing.xl },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.textPrimary,
    lineHeight: 34,
    letterSpacing: -0.6,
    marginBottom: spacing.md,
  },
  body: { fontSize: 16, lineHeight: 24, color: colors.textSecondary, marginBottom: spacing.lg },
  warnBlock: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    padding: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  warnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  warnDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: DANGER, marginTop: 8 },
  warnText: { flex: 1, fontSize: 15, lineHeight: 22, color: colors.textPrimary },
  confirmLabel: { fontSize: 14, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    borderWidth: 1,
    borderColor: colors.grey,
    paddingHorizontal: spacing.md,
    height: layout.buttonHeight,
    fontSize: 16,
    color: colors.textPrimary,
    letterSpacing: 1,
  },
  errorText: { marginTop: spacing.lg, color: DANGER, fontSize: 14, lineHeight: 20 },
  bottom: { gap: spacing.sm, paddingBottom: spacing.xs },
  deleteBtn: {
    backgroundColor: DANGER,
    borderRadius: layout.borderRadiusMedium,
    height: layout.buttonHeight + 4,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  deleteBtnPressed: { opacity: 0.85 },
  deleteBtnDisabled: { backgroundColor: colors.grey },
  deleteBtnText: { ...typography.button, color: colors.card, fontSize: 17 },
  cancelBtn: { height: layout.buttonHeight, alignItems: 'center', justifyContent: 'center' },
  cancelText: { ...typography.button, color: colors.textSecondary, fontSize: 16 },
});
