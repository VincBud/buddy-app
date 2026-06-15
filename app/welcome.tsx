import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../lib/colors';
import { layout, spacing } from '../lib/spacing';
import { typography } from '../lib/typography';

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(28)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 700, delay: 80, useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: 600, delay: 80, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 28) }]}>
      <Animated.View style={[styles.content, { opacity: fade, transform: [{ translateY: slide }] }]}>
        <Text style={styles.wordmark}>buddy</Text>

        <View style={styles.hero}>
          <Text style={styles.headline}>{'Hilfe\nin Minuten.'}</Text>
          <Text style={styles.tagline}>
            Buddy verbindet Menschen, die Hilfe brauchen, mit Buddies in ihrer Nähe.
          </Text>
        </View>

        <View style={styles.bottom}>
          <Pressable
            style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
            onPress={() => router.replace('/intro')}
          >
            <Text style={styles.ctaText}>Loslegen</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.loginLink, pressed && { opacity: 0.6 }]}
            onPress={() => router.replace('/auth-choice')}
          >
            <Text style={styles.loginLinkText}>Bereits ein Konto? Einloggen</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: layout.screenPaddingX,
  },
  content: {
    flex: 1,
    justifyContent: 'space-between',
  },
  wordmark: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: spacing.xxl,
  },
  hero: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: spacing.xxxl,
  },
  headline: {
    fontSize: 54,
    fontWeight: '800',
    color: colors.textPrimary,
    lineHeight: 58,
    letterSpacing: -1.5,
    marginBottom: spacing.xxl,
  },
  tagline: {
    fontSize: 17,
    fontWeight: '400',
    color: colors.textSecondary,
    lineHeight: 26,
    maxWidth: 290,
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
  },
  ctaPressed: {
    opacity: 0.85,
  },
  ctaText: {
    ...typography.button,
    color: colors.card,
    fontSize: 17,
  },
  loginLink: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  loginLinkText: {
    ...typography.metaStrong,
    color: colors.textSecondary,
  },
});
