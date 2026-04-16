import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../lib/colors';
import i18n, { useLanguage } from '../lib/i18n';
import { goBackOrReplace } from '../lib/navigation';
import { layout, spacing } from '../lib/spacing';
import { typography } from '../lib/typography';
import { loadUserProfile, updateUserProfile } from '../lib/user-profile';

export default function EditBioScreen() {
  const bioCharacterLimit = 150;
  useLanguage();
  const insets = useSafeAreaInsets();
  const [bio, setBio] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      const userProfile = await loadUserProfile();
      setBio(userProfile.bio);
    };

    load();
  }, []);

  const handleBack = () => {
    goBackOrReplace(router, '/(tabs)/profile');
  };

  const saveBio = async () => {
    setIsSaving(true);
    try {
      await updateUserProfile({ bio });
      handleBack();
    } catch (error) {
      console.error('Error saving bio:', error);
      alert(i18n.t('profile.about_me_save_error'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.backButton} onPress={handleBack}>
          <Text style={styles.backButtonText}>←</Text>
        </Pressable>
        <Text style={styles.title}>{i18n.t('profile.about_me_edit_title')}</Text>
        <Text style={styles.subtitle}>{i18n.t('profile.about_me_edit_hint')}</Text>
      </View>

      <View style={styles.content}>
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
        <Text style={styles.counter}>{bio.length}/{bioCharacterLimit}</Text>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable style={styles.saveButton} onPress={saveBio} disabled={isSaving}>
          <Text style={styles.saveButtonText}>
            {isSaving ? i18n.t('preferences.saving') : i18n.t('profile.about_me_save')}
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
  content: {
    flex: 1,
    paddingHorizontal: layout.screenPaddingX,
    paddingTop: spacing.lg,
  },
  bioInput: {
    minHeight: 150,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    borderRadius: layout.borderRadiusSmall,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.card,
  },
  counter: {
    marginTop: spacing.sm,
    textAlign: 'right',
    ...typography.meta,
    color: colors.textSecondary,
  },
  footer: {
    paddingTop: spacing.md,
    paddingHorizontal: layout.screenPaddingX,
    borderTopWidth: 1,
    borderTopColor: colors.veryLightGrey2,
    backgroundColor: colors.background,
  },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: layout.borderRadiusMedium,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  saveButtonText: {
    ...typography.button,
    color: colors.card,
  },
});
