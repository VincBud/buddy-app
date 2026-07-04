import Slider from '@react-native-community/slider';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../lib/colors';
import i18n, { useLanguage } from '../lib/i18n';
import { chooseImageSource, takePhotoWithCamera } from '../lib/media-picker';
import { goBackOrReplace } from '../lib/navigation';
import {
    AVAILABILITY_SLOTS,
    AvailabilitySlot,
    DEFAULT_USER_PREFERENCES,
    JOB_CATEGORIES,
    JobCategory,
    loadUserPreferences,
    saveUserPreferences,
    UserPreferences,
} from '../lib/preferences';
import { loadCurrentUser, patchCurrentUser } from '../lib/current-user';
import { getActiveUserId } from '../lib/auth';
import { updateProfile } from '../services/profiles.service';
import { resetHomeHintsCounter } from './(tabs)/index';
import { layout, spacing } from '../lib/spacing';
import { typography } from '../lib/typography';
import { loadUserProfile, updateUserProfile } from '../lib/user-profile';

type PreferencesMode = 'onboarding' | 'settings';

export default function PreferencesScreen() {
  const bioCharacterLimit = 150;
  const language = useLanguage();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ mode?: string }>();
  const [prefs, setPrefs] = useState<UserPreferences>(DEFAULT_USER_PREFERENCES);
  const [bio, setBio] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [profileImageUri, setProfileImageUri] = useState<string | null>(null);
  const [referralSource, setReferralSource] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [showSkillsError, setShowSkillsError] = useState(false);

  const requestedMode: PreferencesMode | null =
    params.mode === 'settings' || params.mode === 'onboarding'
      ? params.mode
      : null;

  const mode: PreferencesMode =
    requestedMode === 'settings' || (requestedMode === null && prefs.onboardingCompleted)
      ? 'settings'
      : 'onboarding';

  const isOnboardingMode = mode === 'onboarding';

  useEffect(() => {
    const load = async () => {
      const [loaded, userProfile, currentUser] = await Promise.all([
        loadUserPreferences(getActiveUserId() || undefined),
        loadUserProfile(),
        loadCurrentUser(),
      ]);
      setPrefs(loaded);
      setBio(userProfile.bio);
      setProfileImageUri(userProfile.profileImageUri);
      setDisplayName(currentUser.displayName);
      setReferralSource(currentUser.referralSource ?? '');
      setDataLoaded(true);
    };
    load();
  }, []);

  const toggleCategory = (key: 'skills' | 'preferredCategories' | 'excludedCategories', category: JobCategory) => {
    setPrefs((prev) => {
      const exists = prev[key].includes(category);
      const nextValues = exists
        ? prev[key].filter((item) => item !== category)
        : [...prev[key], category];

      return {
        ...prev,
        [key]: nextValues,
      };
    });
  };

  const toggleAvailability = (slot: AvailabilitySlot) => {
    setPrefs((prev) => {
      const exists = prev.availability.includes(slot);
      const next = exists
        ? prev.availability.filter((item) => item !== slot)
        : [...prev.availability, slot];

      return {
        ...prev,
        availability: next.length > 0 ? next : ['flexible'],
      };
    });
  };

  const handleBack = () => {
    goBackOrReplace(router, '/(tabs)/profile');
  };

  const pickProfileImage = async () => {
    const source = await chooseImageSource();
    if (!source) return;

    if (source === 'camera') {
      const shot = await takePhotoWithCamera({ allowsEditing: true, aspect: [1, 1] });
      if (shot.status === 'ok') setProfileImageUri(shot.uri);
      return; // canceled/denied handled inside the helper
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as ImagePicker.MediaType[],
      allowsEditing: true,
      aspect: [1, 1] as [number, number],
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      setProfileImageUri(result.assets[0].uri);
    }
  };

  const save = async () => {
    if (isOnboardingMode && prefs.skills.length < 3) {
      setShowSkillsError(true);
      return;
    }
    setIsSaving(true);
    try {
      const toSave: UserPreferences = { ...prefs, onboardingCompleted: true };
      await Promise.all([
        saveUserPreferences(toSave, getActiveUserId() || undefined),
        updateUserProfile({ bio, profileImageUri }),
        patchCurrentUser({
          displayName: displayName.trim(),
          bio: bio.trim() || undefined,
          skills: prefs.skills,
          interests: prefs.preferredCategories,
          radius: prefs.radius,
          referralSource: referralSource.trim() || undefined,
          onboardingCompleted: true,
        }),
      ]);
      // Sync to Supabase profiles table — non-blocking, local state is source of truth
      // avatar_url stores local device URI for now; Supabase Storage upload is a future step
      updateProfile({
        username: displayName.trim() || undefined,
        avatar_url: profileImageUri ?? null,
        bio: bio.trim() || null,
        skills: prefs.skills.length > 0 ? prefs.skills : null,
        radius_km: prefs.radius ?? null,
        discovery_source: referralSource.trim() || null,
      }).catch(() => {/* non-fatal */});

      if (isOnboardingMode) {
        await resetHomeHintsCounter();
        router.replace('/(tabs)');
      } else {
        handleBack();
      }
    } catch (error) {
      console.error('Error saving preferences:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const completenessPercent = useMemo(() => {
    let pct = 20; // radius always has a value
    if (displayName.trim().length > 0) pct += 30;
    if (prefs.skills.length > 0) pct += 30;
    if (bio.trim().length > 0) pct += 20;
    return pct;
  }, [displayName, prefs.skills, bio]);

  const categoryLabel = useMemo(
    () =>
      Object.fromEntries(
        JOB_CATEGORIES.map((category) => [
          category,
          i18n.t(`preferences.categories.${category}`),
        ])
      ) as Record<JobCategory, string>,
    [language]
  );

  const availabilityLabel = useMemo(
    () =>
      Object.fromEntries(
        AVAILABILITY_SLOTS.map((slot) => [slot, i18n.t(`preferences.availability.${slot}`)])
      ) as Record<AvailabilitySlot, string>,
    [language]
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}> 
        {!isOnboardingMode && (
          <Pressable style={styles.backButton} onPress={handleBack}>
            <Text style={styles.backButtonText}>←</Text>
          </Pressable>
        )}
        <Text style={styles.title}>
          {isOnboardingMode
            ? i18n.t('preferences.onboarding_title')
            : i18n.t('preferences.settings_title')}
        </Text>
        <Text style={styles.subtitle}>
          {isOnboardingMode
            ? i18n.t('preferences.onboarding_subtitle')
            : i18n.t('preferences.settings_subtitle')}
        </Text>
      </View>

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {isOnboardingMode && (
          <View style={styles.completenessCard}>
            <View style={styles.completenessRow}>
              <Text style={styles.completenessLabel}>Profil vollständig</Text>
              <Text style={styles.completenessPercent}>{completenessPercent}%</Text>
            </View>
            <View style={styles.completenessTrack}>
              <View style={[styles.completenessBar, { width: `${completenessPercent}%` as any }]} />
            </View>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{i18n.t('preferences.name_title')}</Text>
          <Text style={styles.sectionHint}>{i18n.t('preferences.name_hint')}</Text>
          <TextInput
            style={styles.textInput}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder={i18n.t('preferences.name_placeholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="words"
            returnKeyType="done"
          />
          {dataLoaded && displayName.trim().length === 0 && (
            <Text style={styles.fieldError}>{i18n.t('preferences.name_required')}</Text>
          )}
          {isOnboardingMode && (
            <Pressable style={styles.avatarRow} onPress={pickProfileImage}>
              <View style={styles.avatarSmall}>
                {profileImageUri ? (
                  <Image source={{ uri: profileImageUri }} style={styles.avatarSmallImage} />
                ) : (
                  <Text style={styles.avatarSmallPlus}>+</Text>
                )}
              </View>
              <View>
                <Text style={styles.avatarRowLabel}>{i18n.t('preferences.profile_image_cta')}</Text>
                <Text style={styles.avatarRowHint}>{i18n.t('preferences.profile_image_trust_hint')}</Text>
              </View>
            </Pressable>
          )}
          {isOnboardingMode && (
            <View style={styles.ratingRow}>
              <Text style={styles.ratingStars}>★</Text>
              <Text style={styles.ratingScore}>5.0</Text>
              <Text style={styles.ratingNew}>· Noch keine Bewertungen</Text>
            </View>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{i18n.t('preferences.skills_title')}</Text>
          {isOnboardingMode && (
            <Text style={styles.sectionHint}>{i18n.t('preferences.skills_hint')}</Text>
          )}
          <View style={styles.chipsWrap}>
            {JOB_CATEGORIES.map((category) => {
              const selected = prefs.skills.includes(category);
              return (
                <Pressable
                  key={`skill-${category}`}
                  style={[styles.chip, selected && styles.chipActive]}
                  onPress={() => {
                    toggleCategory('skills', category);
                    if (showSkillsError) setShowSkillsError(false);
                  }}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                    {categoryLabel[category]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {isOnboardingMode && (
            <Text style={[styles.skillsCounter, showSkillsError && prefs.skills.length < 3 && styles.skillsCounterError]}>
              {prefs.skills.length < 3
                ? `${prefs.skills.length} von 3 ausgewählt – bitte noch ${3 - prefs.skills.length} mehr wählen`
                : `${prefs.skills.length} Stärken ausgewählt ✓`}
            </Text>
          )}
        </View>

        {!isOnboardingMode && (
          <>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{i18n.t('preferences.preferred_title')}</Text>
              <View style={styles.chipsWrap}>
                {JOB_CATEGORIES.map((category) => {
                  const selected = prefs.preferredCategories.includes(category);
                  return (
                    <Pressable
                      key={`preferred-${category}`}
                      style={[styles.chip, selected && styles.chipActive]}
                      onPress={() => toggleCategory('preferredCategories', category)}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                        {categoryLabel[category]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{i18n.t('preferences.excluded_title')}</Text>
              <View style={styles.chipsWrap}>
                {JOB_CATEGORIES.map((category) => {
                  const selected = prefs.excludedCategories.includes(category);
                  return (
                    <Pressable
                      key={`excluded-${category}`}
                      style={[styles.chip, styles.chipMuted, selected && styles.chipDanger]}
                      onPress={() => toggleCategory('excludedCategories', category)}
                    >
                      <Text style={[styles.chipText, styles.chipMutedText, selected && styles.chipDangerText]}>
                        {categoryLabel[category]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </>
        )}

        {!isOnboardingMode && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{i18n.t('preferences.availability_title')}</Text>
            <View style={styles.chipsWrap}>
              {AVAILABILITY_SLOTS.map((slot) => {
                const selected = prefs.availability.includes(slot);
                return (
                  <Pressable
                    key={`availability-${slot}`}
                    style={[styles.chip, selected && styles.chipActive]}
                    onPress={() => toggleAvailability(slot)}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                      {availabilityLabel[slot]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{i18n.t('preferences.radius_title')}</Text>
          {isOnboardingMode && (
            <Text style={styles.sectionHint}>{i18n.t('preferences.radius_hint')}</Text>
          )}
          <Text style={styles.radiusValue}>{prefs.radius} km</Text>
          <Slider
            minimumValue={1}
            maximumValue={50}
            step={1}
            value={prefs.radius}
            onValueChange={(value) =>
              setPrefs((prev) => ({ ...prev, radius: Math.round(value) }))
            }
            minimumTrackTintColor={colors.secondary}
            maximumTrackTintColor={colors.lightBorder}
            thumbTintColor={colors.secondary}
          />
        </View>

        {isOnboardingMode && (
          <>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{i18n.t('preferences.about_me_title')}</Text>
              <Text style={styles.sectionHint}>{i18n.t('preferences.about_me_hint')}</Text>
              <TextInput
                style={styles.bioInput}
                value={bio}
                onChangeText={setBio}
                multiline
                maxLength={bioCharacterLimit}
                textAlignVertical="top"
                placeholder={i18n.t('profile.about_me_placeholder')}
                placeholderTextColor={colors.placeholder}
              />
              <Text style={styles.bioCounter}>{bio.length}/{bioCharacterLimit}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{i18n.t('preferences.referral_title')}</Text>
              <Text style={styles.sectionHint}>{i18n.t('preferences.referral_hint')}</Text>
              <TextInput
                style={styles.textInput}
                value={referralSource}
                onChangeText={setReferralSource}
                placeholder={i18n.t('preferences.referral_placeholder')}
                placeholderTextColor={colors.placeholder}
                returnKeyType="done"
              />
            </View>
          </>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}> 
        <Pressable
          style={[styles.saveButton, (isSaving || (dataLoaded && displayName.trim().length === 0)) && styles.saveButtonDisabled]}
          onPress={save}
          disabled={isSaving || (dataLoaded && displayName.trim().length === 0)}
        >
          <Text style={styles.saveButtonText}>
            {isSaving
              ? i18n.t('preferences.saving')
              : isOnboardingMode
                ? i18n.t('preferences.cta_onboarding')
                : i18n.t('preferences.cta_settings')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: layout.screenPaddingX,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.veryLightGrey2,
    backgroundColor: colors.background,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  backButtonText: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    lineHeight: 24,
  },
  title: {
    ...typography.screenTitle,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: layout.screenPaddingX,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    padding: layout.cardPadding,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  sectionTitle: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  sectionHint: {
    ...typography.meta,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    backgroundColor: colors.card,
    borderRadius: 999,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.lightBorder,
  },
  chipActive: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary,
  },
  skillsCounter: {
    ...typography.meta,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  skillsCounterError: {
    color: colors.red,
  },
  chipMuted: {
    backgroundColor: colors.lightGrey,
  },
  chipDanger: {
    backgroundColor: colors.lightOrange,
  },
  chipText: {
    ...typography.metaStrong,
    color: colors.textPrimary,
  },
  chipTextActive: {
    color: colors.card,
  },
  chipMutedText: {
    color: colors.iosShadow,
  },
  chipDangerText: {
    color: colors.primary,
  },
  radiusValue: {
    ...typography.sectionTitle,
    color: colors.secondary,
    marginBottom: spacing.sm,
  },
  bioInput: {
    minHeight: 110,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    borderRadius: layout.borderRadiusSmall,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.veryLightGrey,
  },
  bioCounter: {
    marginTop: spacing.sm,
    textAlign: 'right',
    ...typography.meta,
    color: colors.textSecondary,
  },
  textInput: {
    borderWidth: 1,
    borderColor: colors.lightBorder,
    borderRadius: layout.borderRadiusSmall,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    letterSpacing: 0,
    color: colors.textPrimary,
    backgroundColor: colors.veryLightGrey,
  },
  footer: {
    paddingTop: spacing.md,
    paddingHorizontal: layout.screenPaddingX,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.veryLightGrey2,
  },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: layout.borderRadiusMedium,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.45,
  },
  saveButtonText: {
    ...typography.button,
    color: colors.card,
  },
  fieldError: {
    ...typography.meta,
    color: colors.red,
    marginTop: spacing.sm,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.veryLightGrey2,
  },
  avatarRowLabel: {
    ...typography.metaStrong,
    color: colors.textSecondary,
  },
  avatarRowHint: {
    ...typography.meta,
    color: colors.placeholder,
    marginTop: 2,
  },
  avatarSmall: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.veryLightGrey,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  avatarSmallImage: {
    width: '100%',
    height: '100%',
  },
  avatarSmallPlus: {
    fontSize: 20,
    color: colors.placeholder,
    lineHeight: 24,
  },
  completenessCard: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    padding: layout.cardPadding,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  completenessRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  completenessLabel: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  completenessPercent: {
    ...typography.metaStrong,
    color: colors.secondary,
  },
  completenessTrack: {
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.veryLightGrey,
    overflow: 'hidden',
  },
  completenessBar: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.secondary,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.veryLightGrey2,
  },
  ratingStars: {
    ...typography.metaStrong,
    color: '#F59E0B',
  },
  ratingScore: {
    ...typography.metaStrong,
    color: colors.textPrimary,
  },
  ratingNew: {
    ...typography.meta,
    color: colors.textSecondary,
  },
});
