import AsyncStorage from '@react-native-async-storage/async-storage';
import Slider from '@react-native-community/slider';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../lib/colors';
import i18n, { useLanguage } from '../../lib/i18n';
import { loadUserPreferences, saveUserPreferences } from '../../lib/preferences';
import { layout, spacing } from '../../lib/spacing';
import { typography } from '../../lib/typography';

const HOME_SEEN_COUNT_KEY = 'home_seen_count';
const HOME_HINTS_MAX_SEEN = 3;

export default function HomeScreen() {
  useLanguage();
  const insets = useSafeAreaInsets();
  const [radius, setRadius] = useState(20);
  const [showBuddyFlow, setShowBuddyFlow] = useState(false);
  const [showOnboardingHints, setShowOnboardingHints] = useState(true);
  const hintsProgress = useRef(new Animated.Value(1)).current;

  const getSafeSeenCount = (value: string | null): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.floor(parsed);
  };

  const trackHomeScreenSeen = useCallback(async () => {
    try {
      const countRaw = await AsyncStorage.getItem(HOME_SEEN_COUNT_KEY);
      const currentCount = getSafeSeenCount(countRaw);
      const nextCount = currentCount + 1;

      await AsyncStorage.setItem(HOME_SEEN_COUNT_KEY, String(nextCount));
      setShowOnboardingHints(nextCount <= HOME_HINTS_MAX_SEEN);
    } catch (error) {
      console.error('Fehler beim Tracken der Home-Nutzung:', error);
      setShowOnboardingHints(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      trackHomeScreenSeen();

      const loadRadius = async () => {
        try {
          const prefs = await loadUserPreferences();
          setRadius(prefs.radius);
        } catch (error) {
          console.error('Error loading radius:', error);
        }
      };

      loadRadius();
    }, [trackHomeScreenSeen])
  );

  useEffect(() => {
    Animated.timing(hintsProgress, {
      toValue: showOnboardingHints ? 1 : 0,
      duration: 220,
      useNativeDriver: false,
    }).start();
  }, [hintsProgress, showOnboardingHints]);

  const subtitleContainerStyle = {
    opacity: hintsProgress,
    maxHeight: hintsProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 72],
    }),
    marginBottom: hintsProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [spacing.sm, spacing.lg],
    }),
  };

  const handleShowJobs = async () => {
    try {
      const prefs = await loadUserPreferences();
      await saveUserPreferences({ ...prefs, radius: Math.round(radius) });
      router.push('/(tabs)/feed');
    } catch (error) {
      console.error('Error saving radius:', error);
    }
  };

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.content,
          {
            paddingTop: insets.top + spacing.md,
            paddingBottom: Math.max(insets.bottom + spacing.xl, spacing.xl),
            justifyContent: showBuddyFlow ? 'flex-start' : 'center',
          },
        ]}
      >
        <View style={styles.mainBlock}>
          <View style={styles.heroSection}>
            <Text style={styles.title}>{i18n.t('home.home_title')}</Text>
            <Animated.View style={[styles.subtitleWrap, subtitleContainerStyle]}>
              <Text style={styles.subtitle}>{i18n.t('home.home_subtitle')}</Text>
            </Animated.View>
          </View>

          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
            onPress={() => router.push('/(tabs)/create')}
          >
            <Text style={styles.primaryButtonText}>{i18n.t('home.post_problem')}</Text>
          </Pressable>

          {!showBuddyFlow ? (
            <Pressable
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => setShowBuddyFlow(true)}
            >
              <Text style={styles.secondaryButtonText}>{i18n.t('home.be_buddy')}</Text>
            </Pressable>
          ) : (
            <View style={styles.buddyCard}>
              <Text style={styles.buddyTitle}>{i18n.t('home.radius_question')}</Text>
              <Text style={styles.buddyHelper}>{i18n.t('home.radius_helper')}</Text>
              <Text style={styles.radiusValue}>{radius} km</Text>

              <Slider
                minimumValue={1}
                maximumValue={50}
                step={1}
                value={radius}
                onValueChange={setRadius}
                minimumTrackTintColor={colors.secondary}
                maximumTrackTintColor="#D9D9D9"
                thumbTintColor={colors.secondary}
              />

              <Pressable
                style={({ pressed }) => [styles.jobsButton, pressed && styles.buttonPressed]}
                onPress={handleShowJobs}
              >
                <Text style={styles.jobsButtonText}>
                  {i18n.t('home.show_jobs_in_radius')}
                </Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
                onPress={() => setShowBuddyFlow(false)}
              >
                <Text style={styles.backButtonText}>{i18n.t('home.back')}</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </View>
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
  },
  mainBlock: {
    width: '100%',
    maxWidth: 360,
    alignSelf: 'center',
  },
  heroSection: {
    marginBottom: spacing.xl,
  },
  subtitleWrap: {
    overflow: 'hidden',
  },
  title: {
    ...typography.screenTitle,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  primaryButton: {
    width: '100%',
    backgroundColor: colors.primary,
    paddingVertical: spacing.lg,
    borderRadius: layout.borderRadiusMedium,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: spacing.lg,
    shadowOffset: { width: 0, height: 4 },
    elevation: layout.shadowLarge,
    marginBottom: spacing.md,
  },
  buttonPressed: {
    opacity: 0.94,
    transform: [{ scale: 0.992 }],
  },
  primaryButtonText: {
    color: colors.card,
    ...typography.button,
  },
  secondaryButton: {
    width: '100%',
    backgroundColor: colors.secondary,
    paddingVertical: spacing.lg,
    borderRadius: layout.borderRadiusMedium,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: spacing.lg,
    shadowOffset: { width: 0, height: 3 },
    elevation: layout.shadowMedium,
    marginBottom: spacing.sm,
  },
  secondaryButtonText: {
    color: colors.card,
    ...typography.button,
  },
  buddyCard: {
    width: '100%',
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.lightGrey,
    marginTop: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: layout.shadowSmall,
  },
  buddyTitle: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  buddyHelper: {
    ...typography.meta,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
    lineHeight: 18,
  },
  radiusValue: {
    ...typography.sectionTitle,
    color: colors.secondary,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  jobsButton: {
    backgroundColor: colors.secondary,
    paddingVertical: spacing.lg,
    borderRadius: layout.borderRadiusSmall,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  jobsButtonText: {
    color: colors.card,
    ...typography.button,
  },
  backButton: {
    alignItems: 'center',
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
  },
  backButtonPressed: {
    opacity: 0.72,
  },
  backButtonText: {
    color: colors.iosShadow,
    ...typography.metaStrong,
  },
});