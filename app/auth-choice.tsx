import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../lib/colors';
import { layout, spacing } from '../lib/spacing';
import { typography } from '../lib/typography';

export default function AuthChoiceScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 28) }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.replace('/welcome')} hitSlop={12} style={styles.backBtn}>
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
      </View>

      <View style={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.wordmark}>buddy</Text>
          <Text style={styles.heading}>{'Bereit\nloszulegen?'}</Text>
          <Text style={styles.subtext}>
            Erstelle dein kostenloses Konto oder melde dich einfach an.
          </Text>
        </View>

        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}
            onPress={() => router.replace({ pathname: '/auth', params: { mode: 'register' } })}
          >
            <Text style={styles.primaryBtnText}>Konto erstellen</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.7 }]}
            onPress={() => router.replace({ pathname: '/auth', params: { mode: 'login' } })}
          >
            <Text style={styles.secondaryBtnText}>Einloggen</Text>
          </Pressable>

          <Text style={styles.legal}>
            Mit der Anmeldung akzeptierst du unsere{' '}
            <Text style={styles.legalEmphasis}>Nutzungsbedingungen</Text>.
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: layout.screenPaddingX,
  },
  header: {
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
  content: {
    flex: 1,
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
  },
  hero: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: spacing.xxxl,
  },
  wordmark: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: spacing.xxl,
  },
  heading: {
    fontSize: 46,
    fontWeight: '800',
    color: colors.textPrimary,
    lineHeight: 50,
    letterSpacing: -1.5,
    marginBottom: spacing.lg,
  },
  subtext: {
    fontSize: 16,
    fontWeight: '400',
    color: colors.textSecondary,
    lineHeight: 24,
    maxWidth: 270,
  },
  actions: {
    gap: spacing.md,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: layout.borderRadiusMedium,
    height: layout.buttonHeight + 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    ...typography.button,
    color: colors.card,
    fontSize: 17,
  },
  secondaryBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.textPrimary,
    borderRadius: layout.borderRadiusMedium,
    height: layout.buttonHeight + 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    ...typography.button,
    color: colors.textPrimary,
    fontSize: 17,
  },
  legal: {
    fontSize: 12,
    fontWeight: '400',
    color: colors.placeholder,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: spacing.xs,
  },
  legalEmphasis: {
    fontWeight: '600',
    color: colors.textSecondary,
  },
});
