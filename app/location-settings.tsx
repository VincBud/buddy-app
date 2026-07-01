import Ionicons from '@expo/vector-icons/Ionicons';
import Slider from '@react-native-community/slider';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getActiveUserId } from '../lib/auth';
import { colors } from '../lib/colors';
import i18n, { useLanguage } from '../lib/i18n';
import {
    DEFAULT_LOCATION_SETTINGS,
    loadLocationSettings,
    LocationPermissionStatus,
    LocationSettings,
    saveLocationSettings,
} from '../lib/location';
import {
    getForegroundPermissionStatus,
    openLocationSettings,
    requestForegroundLocationPermission,
} from '../lib/geo-location';
import { goBackOrReplace } from '../lib/navigation';
import { loadUserPreferences, saveUserPreferences } from '../lib/preferences';
import { layout, spacing } from '../lib/spacing';
import { typography } from '../lib/typography';

export default function LocationSettingsScreen() {
  useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [settings, setSettings] = useState<LocationSettings>(DEFAULT_LOCATION_SETTINGS);
  const [isSaving, setIsSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const load = async () => {
        try {
          const [locationSettings, userPreferences, livePermission] = await Promise.all([
            loadLocationSettings(),
            loadUserPreferences(getActiveUserId() || undefined),
            // Read the real OS permission (does NOT prompt) so the card always
            // reflects the true system state, not a stale stored value.
            getForegroundPermissionStatus(),
          ]);
          if (isActive) {
            setSettings({
              ...locationSettings,
              radius: userPreferences.radius,
              permissionStatus: livePermission,
            });
          }
        } catch {
          // fall back to defaults; non-fatal
        }
      };

      load();
      return () => { isActive = false; };
    }, [])
  );

  const handleBack = () => {
    goBackOrReplace(router, '/(tabs)/profile');
  };

  const setPermissionStatus = (status: LocationPermissionStatus) => {
    setSettings((prev) => ({ ...prev, permissionStatus: status }));
  };

  // Only prompts in response to this user action (never on launch/focus).
  const handleRequestPermission = async () => {
    setActionError(null);
    const status = await requestForegroundLocationPermission();
    setPermissionStatus(status);
    if (status === 'not_determined') {
      // The OS neither granted nor hard-denied — treat as a failed request.
      setActionError(i18n.t('location.permission_request_failed'));
    }
  };

  const handleOpenSettings = async () => {
    setActionError(null);
    await openLocationSettings();
  };

  const toggleDiscovery = () => {
    setSettings((prev) => ({ ...prev, discoveryEnabled: !prev.discoveryEnabled }));
  };

  const setRadius = (value: number) => {
    setSettings((prev) => ({ ...prev, radius: Math.round(value) }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await saveLocationSettings(settings);
      const prefs = await loadUserPreferences();
      await saveUserPreferences({ ...prefs, radius: settings.radius }, getActiveUserId() || undefined);
      handleBack();
    } catch {
      // non-fatal
    } finally {
      setIsSaving(false);
    }
  };

  const permissionIcon =
    settings.permissionStatus === 'granted'
      ? 'location'
      : settings.permissionStatus === 'denied'
        ? 'location-outline'
        : 'help-circle-outline';

  const permissionColor =
    settings.permissionStatus === 'granted' ? colors.green : colors.textSecondary;
  const locationReady = settings.permissionStatus === 'granted' && settings.discoveryEnabled;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.headerRow}>
          <Pressable style={styles.backButton} onPress={handleBack}>
            <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <View style={styles.headerSpacer} />
        </View>
        <Text style={styles.title}>{i18n.t('location.title')}</Text>
        <Text style={styles.subtitle}>{i18n.t('location.subtitle')}</Text>
      </View>

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Permission status ─────────────────────────────────── */}
        <View style={styles.sectionLabel}>
          <Text style={styles.sectionLabelText}>
            {i18n.t('location.section_status_title')}
          </Text>
        </View>

        <View
          style={[
            styles.statusCard,
            settings.permissionStatus === 'granted' && styles.statusCardGranted,
          ]}
        >
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusIconWrap,
                settings.permissionStatus === 'granted' && styles.statusIconWrapGranted,
              ]}
            >
              <Ionicons name={permissionIcon} size={20} color={permissionColor} />
            </View>
            <View style={styles.statusTextWrap}>
              <Text style={styles.statusTitle}>
                {i18n.t(`location.permission_${settings.permissionStatus}`)}
              </Text>
              <Text style={styles.statusHint}>
                {i18n.t(`location.permission_${settings.permissionStatus}_hint`)}
              </Text>
            </View>
          </View>

          {settings.permissionStatus !== 'granted' && (
            <View style={styles.permissionActions}>
              <Pressable
                style={({ pressed }) => [
                  styles.permissionCta,
                  pressed && styles.permissionCtaPressed,
                ]}
                onPress={handleRequestPermission}
              >
                <Text style={styles.permissionCtaText}>
                  {i18n.t('location.permission_request_cta')}
                </Text>
              </Pressable>

              {settings.permissionStatus === 'denied' && (
                <Pressable
                  style={({ pressed }) => [
                    styles.permissionCtaSecondary,
                    pressed && styles.permissionCtaPressed,
                  ]}
                  onPress={handleOpenSettings}
                >
                  <Text style={styles.permissionCtaSecondaryText}>
                    {i18n.t('location.permission_open_cta')}
                  </Text>
                </Pressable>
              )}

              {actionError && (
                <Text style={styles.permissionErrorText}>{actionError}</Text>
              )}
            </View>
          )}
        </View>

        {/* ── Discovery toggle ──────────────────────────────────── */}
        <View style={styles.sectionLabel}>
          <Text style={styles.sectionLabelText}>
            {i18n.t('location.section_discovery_title')}
          </Text>
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.toggleCard,
            pressed && styles.toggleCardPressed,
          ]}
          onPress={toggleDiscovery}
        >
          <View style={styles.toggleLeft}>
            <View
              style={[
                styles.iconWrap,
                settings.discoveryEnabled && styles.iconWrapActive,
              ]}
            >
              <Ionicons
                name="navigate-outline"
                size={18}
                color={settings.discoveryEnabled ? colors.secondary : colors.textSecondary}
              />
            </View>
            <View style={styles.toggleTextWrap}>
              <Text style={styles.toggleLabel}>
                {i18n.t('location.discovery_toggle_label')}
              </Text>
              <Text style={styles.toggleHint}>
                {i18n.t('location.discovery_toggle_hint')}
              </Text>
            </View>
          </View>

          <View style={[styles.toggle, settings.discoveryEnabled && styles.toggleActive]}>
            <View
              style={[
                styles.toggleHandle,
                settings.discoveryEnabled && styles.toggleHandleActive,
              ]}
            />
          </View>
        </Pressable>

        {/* ── Radius ───────────────────────────────────────────── */}
        <View style={styles.sectionLabel}>
          <Text style={styles.sectionLabelText}>
            {i18n.t('location.section_radius_title')}
          </Text>
        </View>

        <View
          style={[
            styles.radiusCard,
            !settings.discoveryEnabled && styles.radiusCardDisabled,
          ]}
        >
          <View style={styles.radiusHeaderRow}>
            <View style={styles.iconWrap}>
              <Ionicons name="compass-outline" size={18} color={colors.textSecondary} />
            </View>
            <Text style={styles.radiusValue}>
              {i18n.t('location.radius_value', { km: settings.radius })}
            </Text>
          </View>

          <Slider
            style={styles.slider}
            minimumValue={1}
            maximumValue={50}
            step={1}
            value={settings.radius}
            onValueChange={setRadius}
            minimumTrackTintColor={
              settings.discoveryEnabled ? colors.secondary : colors.lightBorder
            }
            maximumTrackTintColor={colors.lightBorder}
            thumbTintColor={
              settings.discoveryEnabled ? colors.secondary : colors.iosShadow
            }
            disabled={!settings.discoveryEnabled}
          />

          <View style={styles.radiusRange}>
            <Text style={styles.radiusRangeLabel}>1 km</Text>
            <Text style={styles.radiusRangeLabel}>50 km</Text>
          </View>

          <Text style={styles.radiusDescription}>
            {i18n.t('location.radius_description')}
          </Text>

          {!locationReady && (
            <View style={styles.lockedStateWrap}>
              <Ionicons name="lock-closed-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.lockedStateText}>
                {i18n.t('location.locked_state_hint')}
              </Text>
            </View>
          )}
        </View>

        {/* ── Usage explanation ─────────────────────────────────── */}
        <View style={styles.usageCard}>
          <View style={styles.usageTitleRow}>
            <Ionicons name="shield-checkmark-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.usageTitle}>
              {i18n.t('location.section_usage_title')}
            </Text>
          </View>
          <Text style={styles.usageBody}>{i18n.t('location.usage_body')}</Text>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable
          style={({ pressed }) => [
            styles.saveButton,
            pressed && styles.saveButtonPressed,
          ]}
          onPress={handleSave}
          disabled={isSaving}
        >
          <Text style={styles.saveButtonText}>
            {isSaving ? i18n.t('preferences.saving') : i18n.t('location.save')}
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
    gap: spacing.sm,
  },

  // ── Section labels ─────────────────────────────────────────────
  sectionLabel: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  sectionLabelText: {
    ...typography.metaStrong,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // ── Status card ────────────────────────────────────────────────
  statusCard: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    padding: layout.cardPadding,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  statusCardGranted: {
    borderColor: colors.green,
    borderLeftWidth: 3,
    borderLeftColor: colors.green,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  statusIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.veryLightGrey,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.lightBorder,
    flexShrink: 0,
  },
  statusIconWrapGranted: {
    backgroundColor: colors.lightGreen,
    borderColor: colors.green,
  },
  statusTextWrap: {
    flex: 1,
  },
  statusTitle: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  statusHint: {
    ...typography.meta,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  permissionActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  permissionErrorText: {
    width: '100%',
    marginTop: spacing.xs,
    color: '#991B1B',
    fontSize: 13,
    lineHeight: 18,
  },
  permissionCta: {
    backgroundColor: colors.secondary,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  permissionCtaSecondary: {
    backgroundColor: colors.veryLightGrey,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.lightBorder,
  },
  permissionCtaPressed: {
    opacity: 0.8,
  },
  permissionCtaText: {
    ...typography.metaStrong,
    color: colors.card,
  },
  permissionCtaSecondaryText: {
    ...typography.metaStrong,
    color: colors.textPrimary,
  },

  // ── Discovery toggle card ──────────────────────────────────────
  toggleCard: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    padding: layout.cardPadding,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  toggleCardPressed: {
    opacity: 0.95,
    transform: [{ scale: 0.995 }],
  },
  toggleLeft: {
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
    flexShrink: 0,
  },
  iconWrapActive: {
    backgroundColor: colors.veryLightPurple,
    borderColor: colors.overlayLightPurple,
  },
  toggleTextWrap: {
    flex: 1,
  },
  toggleLabel: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  toggleHint: {
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

  // ── Radius card ────────────────────────────────────────────────
  radiusCard: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    padding: layout.cardPadding,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  radiusCardDisabled: {
    opacity: 0.5,
  },
  radiusHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  radiusValue: {
    ...typography.sectionTitle,
    color: colors.secondary,
  },
  slider: {
    width: '100%',
    height: 40,
    marginHorizontal: -spacing.xs,
  },
  radiusRange: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -spacing.xs,
    marginBottom: spacing.sm,
  },
  radiusRangeLabel: {
    ...typography.meta,
    color: colors.placeholder,
  },
  radiusDescription: {
    ...typography.meta,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  lockedStateWrap: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.lightBorder,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  lockedStateText: {
    ...typography.meta,
    color: colors.textSecondary,
    flex: 1,
    lineHeight: 18,
  },

  // ── Usage explanation ──────────────────────────────────────────
  usageCard: {
    backgroundColor: colors.veryLightGrey,
    borderRadius: layout.borderRadiusMedium,
    padding: layout.cardPadding,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    marginTop: spacing.sm,
  },
  usageTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  usageTitle: {
    ...typography.metaStrong,
    color: colors.textSecondary,
  },
  usageBody: {
    ...typography.meta,
    color: colors.textSecondary,
    lineHeight: 20,
  },

  // ── Footer ─────────────────────────────────────────────────────
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
  saveButtonPressed: {
    opacity: 0.88,
  },
  saveButtonText: {
    ...typography.button,
    color: colors.card,
  },
});
