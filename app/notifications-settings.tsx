import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../lib/colors';
import i18n, { useLanguage } from '../lib/i18n';
import { goBackOrReplace } from '../lib/navigation';
import {
    getEnabledNotificationPreferenceCount,
    loadNotificationPreferences,
    NotificationPreferenceKey,
    NotificationPreferences,
    saveNotificationPreferences,
} from '../lib/notifications';
import { layout, spacing } from '../lib/spacing';
import { typography } from '../lib/typography';

type SettingItem = {
  key: NotificationPreferenceKey;
  title: string;
  hint: string;
  icon: keyof typeof Ionicons.glyphMap;
};

export default function NotificationSettingsScreen() {
  useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const loadPreferences = async () => {
        try {
          const loaded = await loadNotificationPreferences();

          if (isActive) {
            setPreferences(loaded);
          }
        } catch (error) {
          console.error('Error loading notification preferences:', error);
        }
      };

      loadPreferences();

      return () => {
        isActive = false;
      };
    }, [])
  );

  const settingItems: SettingItem[] = useMemo(
    () => [
      {
        key: 'messages',
        title: i18n.t('notifications.category_messages_title'),
        hint: i18n.t('notifications.category_messages_hint'),
        icon: 'chatbubble-ellipses-outline',
      },
      {
        key: 'jobUpdates',
        title: i18n.t('notifications.category_job_updates_title'),
        hint: i18n.t('notifications.category_job_updates_hint'),
        icon: 'briefcase-outline',
      },
      {
        key: 'jobActivity',
        title: i18n.t('notifications.category_job_activity_title'),
        hint: i18n.t('notifications.category_job_activity_hint'),
        icon: 'checkmark-done-outline',
      },
      {
        key: 'recommendedJobs',
        title: i18n.t('notifications.category_recommended_jobs_title'),
        hint: i18n.t('notifications.category_recommended_jobs_hint'),
        icon: 'sparkles-outline',
      },
      {
        key: 'productUpdates',
        title: i18n.t('notifications.category_product_updates_title'),
        hint: i18n.t('notifications.category_product_updates_hint'),
        icon: 'notifications-outline',
      },
    ],
    []
  );

  const enabledCount = preferences
    ? getEnabledNotificationPreferenceCount(preferences)
    : 0;

  const handleBack = () => {
    goBackOrReplace(router, '/(tabs)/profile');
  };

  const togglePreference = async (key: NotificationPreferenceKey) => {
    if (!preferences) return;

    const updated = {
      ...preferences,
      [key]: !preferences[key],
    };

    setPreferences(updated);

    try {
      await saveNotificationPreferences(updated);
    } catch (error) {
      console.error('Error saving notification preferences:', error);
      setPreferences(preferences);
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}> 
        <View style={styles.headerRow}>
          <Pressable style={styles.backButton} onPress={handleBack}>
            <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <View style={styles.headerSpacer} />
        </View>
        <Text style={styles.title}>{i18n.t('notifications.settings_title')}</Text>
        <Text style={styles.subtitle}>{i18n.t('notifications.settings_subtitle')}</Text>
      </View>

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>{i18n.t('notifications.settings_open')}</Text>
          <Text style={styles.summaryValue}>
            {i18n.t('notifications.settings_enabled_count', {
              count: enabledCount,
              total: settingItems.length,
            })}
          </Text>
          <Text style={styles.summaryHint}>{i18n.t('notifications.settings_save_hint')}</Text>
        </View>

        {settingItems.map((item) => {
          const isEnabled = Boolean(preferences?.[item.key]);

          return (
            <Pressable
              key={item.key}
              style={({ pressed }) => [
                styles.settingCard,
                pressed && styles.settingCardPressed,
              ]}
              onPress={() => togglePreference(item.key)}
            >
              <View style={styles.settingLeft}>
                <View style={[styles.iconWrap, isEnabled && styles.iconWrapActive]}>
                  <Ionicons
                    name={item.icon}
                    size={18}
                    color={isEnabled ? colors.secondary : colors.textSecondary}
                  />
                </View>

                <View style={styles.settingTextWrap}>
                  <Text style={styles.settingTitle}>{item.title}</Text>
                  <Text style={styles.settingHint}>{item.hint}</Text>
                </View>
              </View>

              <View
                style={[
                  styles.toggle,
                  isEnabled && styles.toggleActive,
                ]}
              >
                <View
                  style={[
                    styles.toggleHandle,
                    isEnabled && styles.toggleHandleActive,
                  ]}
                />
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
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
    paddingBottom: spacing.lg,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.veryLightGrey2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  headerSpacer: {
    width: 36,
  },
  title: {
    ...typography.screenTitle,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.meta,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    lineHeight: 18,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: layout.screenPaddingX,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
    gap: spacing.md,
  },
  summaryCard: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    padding: layout.cardPadding,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  summaryLabel: {
    ...typography.metaStrong,
    color: colors.secondary,
    marginBottom: spacing.xs,
  },
  summaryValue: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  summaryHint: {
    ...typography.meta,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  settingCard: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    padding: layout.cardPadding,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  settingCardPressed: {
    opacity: 0.95,
    transform: [{ scale: 0.995 }],
  },
  settingLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.veryLightGrey,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.lightBorder,
  },
  iconWrapActive: {
    backgroundColor: colors.veryLightPurple,
    borderColor: colors.overlayLightPurple,
  },
  settingTextWrap: {
    flex: 1,
  },
  settingTitle: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  settingHint: {
    ...typography.meta,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  toggle: {
    width: 46,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.lightBorder,
    justifyContent: 'center',
    paddingHorizontal: 3,
    flexShrink: 0,
  },
  toggleActive: {
    backgroundColor: colors.secondary,
  },
  toggleHandle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.card,
  },
  toggleHandleActive: {
    marginLeft: 18,
  },
});