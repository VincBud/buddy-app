import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../lib/colors';
import { layout, spacing } from '../lib/spacing';
import { typography } from '../lib/typography';

const STEPS = [
  {
    number: '1',
    title: 'Auftrag posten',
    description: 'Beschreibe dein Problem kurz und lege ein Budget fest. Dauert unter einer Minute.',
  },
  {
    number: '2',
    title: 'Buddy findet Auftrag',
    description: 'Ein Buddy in deiner Nähe sieht deinen Auftrag und meldet sich bei dir.',
  },
  {
    number: '3',
    title: 'Chatten & erledigen',
    description: "Klärt alle Details direkt im Chat – dann kann's losgehen.",
  },
] as const;

export default function IntroScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 28) }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.replace('/welcome')} hitSlop={12} style={styles.backBtn}>
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <Text style={styles.heading}>So funktioniert’s</Text>
        <Text style={styles.subheading}>In drei Schritten zur Lösung.</Text>

        <View style={styles.cards}>
          {STEPS.map((step) => (
            <View key={step.number} style={styles.card}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepNumber}>{step.number}</Text>
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{step.title}</Text>
                <Text style={styles.cardDesc}>{step.description}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingHorizontal: layout.screenPaddingX }]}>
        <Pressable
          style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
          onPress={() => router.replace('/auth-choice')}
        >
          <Text style={styles.ctaText}>Weiter</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
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
  scroll: {
    paddingHorizontal: layout.screenPaddingX,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  heading: {
    ...typography.screenTitle,
    color: colors.textPrimary,
    letterSpacing: -0.5,
    marginBottom: spacing.xs,
  },
  subheading: {
    fontSize: 16,
    fontWeight: '400',
    color: colors.textSecondary,
    lineHeight: 24,
    marginBottom: spacing.xxxl + spacing.xl,
  },
  cards: {
    gap: spacing.md,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    padding: layout.cardPadding,
    gap: spacing.lg,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  stepBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.lightOrange,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    flexShrink: 0,
  },
  stepNumber: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.primary,
    lineHeight: 18,
  },
  cardBody: {
    flex: 1,
  },
  cardTitle: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  cardDesc: {
    fontSize: 14,
    fontWeight: '400',
    color: colors.textSecondary,
    lineHeight: 21,
  },
  footer: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  cta: {
    backgroundColor: colors.primary,
    borderRadius: layout.borderRadiusMedium,
    height: layout.buttonHeight + 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    ...typography.button,
    color: colors.card,
    fontSize: 17,
  },
});
