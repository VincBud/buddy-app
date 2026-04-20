import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../lib/colors';
import { loadCurrentUser, patchCurrentUser } from '../lib/current-user';
import i18n, { useLanguage } from '../lib/i18n';
import { goBackOrReplace } from '../lib/navigation';
import { layout, spacing } from '../lib/spacing';
import { typography } from '../lib/typography';

export default function EditDisplayNameScreen() {
  useLanguage();
  const insets = useSafeAreaInsets();
  const [displayName, setDisplayName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      const currentUser = await loadCurrentUser();
      setDisplayName(currentUser.displayName);
    };
    load();
  }, []);

  const handleBack = () => {
    goBackOrReplace(router, '/(tabs)/profile');
  };

  const save = async () => {
    setIsSaving(true);
    try {
      await patchCurrentUser({ displayName: displayName.trim() });
      handleBack();
    } catch (error) {
      console.error('Error saving display name:', error);
      alert(i18n.t('profile.name_save_error'));
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
        <Text style={styles.title}>{i18n.t('profile.name_edit_title')}</Text>
        <Text style={styles.subtitle}>{i18n.t('profile.name_edit_hint')}</Text>
      </View>

      <View style={styles.content}>
        <TextInput
          style={styles.nameInput}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder={i18n.t('profile.name_placeholder')}
          placeholderTextColor={colors.placeholder}
          autoCapitalize="words"
          autoFocus
          returnKeyType="done"
          onSubmitEditing={save}
        />
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable
          style={[styles.saveButton, !displayName.trim() && styles.saveButtonDisabled]}
          onPress={save}
          disabled={isSaving || !displayName.trim()}
        >
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
  nameInput: {
    borderWidth: 1,
    borderColor: colors.lightBorder,
    borderRadius: layout.borderRadiusSmall,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.card,
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
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    ...typography.button,
    color: colors.card,
  },
});
