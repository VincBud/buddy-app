import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
    Image,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View
} from 'react-native';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../lib/colors';
import i18n, { useLanguage } from '../../lib/i18n';
import { getActiveDevUser, getActiveDevUserId } from '../../lib/dev-session';
import { computeExpiresAt, Job, JOB_CATEGORIES, JobCategory, JobRebooking } from '../../lib/jobs';
import { createNotification, Notification } from '../../lib/notifications';
import { createInitialPaymentState } from '../../lib/payments';
import { loadPreferredBuddies, PreferredBuddy } from '../../lib/preferred-buddies';
import {
    calculatePriceBreakdown,
    formatPriceAmount,
    MIN_JOB_BASE_PRICE,
    toStoredPriceValue,
    validateJobBasePrice,
} from '../../lib/pricing';
import { layout, spacing } from '../../lib/spacing';
import { typography } from '../../lib/typography';

type TimeMode = 'sofort' | 'flexibel' | 'termin' | null;

export default function CreateScreen() {
  useLanguage();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    rebookBuddyId?: string;
    rebookBuddyName?: string;
    rebookJobsWorked?: string;
    rebookSourceJobId?: string;
  }>();

  const [rebookBuddy, setRebookBuddy] = useState<{
    id: string;
    name: string;
    jobsWorked: number;
    sourceJobId?: string;
  } | null>(() => {
    const id = params.rebookBuddyId?.trim();
    const name = params.rebookBuddyName?.trim();
    if (!id || !name) return null;
    return {
      id,
      name,
      jobsWorked: Number(params.rebookJobsWorked) || 1,
      sourceJobId: params.rebookSourceJobId?.trim() || undefined,
    };
  });

  const [problem, setProblem] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<JobCategory | null>(null);
  const [categoryManuallySelected, setCategoryManuallySelected] = useState(false);
  const [selectedPrice, setSelectedPrice] = useState<string | null>(null);
  const [customPrice, setCustomPrice] = useState('');
  const [selectedTime, setSelectedTime] = useState<TimeMode>(null);

  const [flexibleRange, setFlexibleRange] = useState('');
  const [media, setMedia] = useState<string[]>([]);

  const [appointmentDate, setAppointmentDate] = useState<Date | null>(null);
  const [appointmentTime, setAppointmentTime] = useState<Date | null>(null);

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [notifyPreferredBuddies, setNotifyPreferredBuddies] = useState(false);
  const [preferredBuddies, setPreferredBuddies] = useState<PreferredBuddy[]>([]);

  const isCustomPrice = selectedPrice === 'custom';

  const CATEGORY_KEYWORDS: Record<JobCategory, string[]> = {
    transport: [
      'fahren',
      'abholen',
      'liefern',
      'umzug',
      'drive',
      'pickup',
      'deliver',
      'moving',
      'move',
    ],
    handyman: [
      'kaputt',
      'reparieren',
      'auto',
      'schrauben',
      'broken',
      'repair',
      'car',
      'screw',
      'fix',
    ],
    household: [
      'putzen',
      'waschen',
      'reinigen',
      'clean',
      'wash',
      'laundry',
    ],
    tech: [
      'laptop',
      'handy',
      'wlan',
      'pc',
      'wifi',
      'computer',
      'phone',
    ],
    errands: [
      'einkaufen',
      'besorgen',
      'apotheke',
      'shopping',
      'shop',
      'buy',
      'errand',
      'pharmacy',
    ],
  };

  const detectSuggestedCategory = (text: string): JobCategory | null => {
    const normalized = text.toLowerCase();
    if (!normalized.trim()) return null;

    let bestCategory: JobCategory | null = null;
    let bestScore = 0;

    for (const category of JOB_CATEGORIES) {
      const keywords = CATEGORY_KEYWORDS[category];
      let score = 0;

      for (const keyword of keywords) {
        if (normalized.includes(keyword)) score += 1;
      }

      if (score > bestScore) {
        bestScore = score;
        bestCategory = category;
      }
    }

    return bestScore > 0 ? bestCategory : null;
  };

  const suggestedCategory = useMemo(
    () => detectSuggestedCategory(problem),
    [problem]
  );

  useEffect(() => {
    if (categoryManuallySelected) return;
    if (!suggestedCategory) return;
    if (selectedCategory === suggestedCategory) return;
    setSelectedCategory(suggestedCategory);
  }, [categoryManuallySelected, selectedCategory, suggestedCategory]);

  useEffect(() => {
    const loadBuddies = async () => {
      const buddies = await loadPreferredBuddies();
      setPreferredBuddies(buddies);
    };

    loadBuddies();
  }, []);

  const handleProblemChange = (value: string) => {
    setProblem(value);
  };

  const rawPriceInput = isCustomPrice ? customPrice : selectedPrice;

  const priceValidation = useMemo(() => {
    if (!rawPriceInput) {
      return {
        parsedPrice: null,
        isValid: false,
        isBelowMinimum: false,
      };
    }

    return validateJobBasePrice(rawPriceInput, MIN_JOB_BASE_PRICE);
  }, [rawPriceInput]);

  const priceValue = priceValidation.parsedPrice;

  const priceBreakdown = useMemo(() => {
    if (!priceValidation.isValid || priceValue === null) return null;
    return calculatePriceBreakdown(priceValue);
  }, [priceValidation.isValid, priceValue]);

  const showCustomPriceValidationError =
    isCustomPrice &&
    customPrice.trim().length > 0 &&
    (!priceValidation.isValid || priceValidation.isBelowMinimum);

  const customPriceValidationKey = priceValidation.isBelowMinimum
    ? 'create.custom_price_min_error'
    : 'create.invalid_price';

  const isSubmitBlockedByPrice = isCustomPrice && !priceValidation.isValid;

  const priceHelperKey = useMemo(() => {
    if (priceValue === null) return 'create.price_helper_default';
    if (priceValue >= 100) return 'create.price_helper_top';
    if (priceValue >= 50) return 'create.price_helper_high';
    if (priceValue >= 25) return 'create.price_helper_medium';
    return 'create.price_helper_low';
  }, [priceValue]);

  const formattedDate = useMemo(() => {
    if (!appointmentDate) return '';
    return appointmentDate.toLocaleDateString('de-DE');
  }, [appointmentDate]);

  const formattedTime = useMemo(() => {
    if (!appointmentTime) return '';
    return appointmentTime.toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [appointmentTime]);

  const pickMedia = async () => {
    if (media.length >= 3) {
      alert(i18n.t('create.max_3_media'));
      return;
    }

    const permissionResult =
      await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permissionResult.granted) {
      alert(i18n.t('create.allow_media'));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      selectionLimit: 3 - media.length,
      quality: 0.8,
    });

    if (!result.canceled) {
      const newUris = result.assets.map((asset) => asset.uri);
      const updatedMedia = [...media, ...newUris].slice(0, 3);
      setMedia(updatedMedia);
    }
  };

  const removeMedia = (uriToRemove: string) => {
    setMedia(media.filter((uri) => uri !== uriToRemove));
  };

  const handleDateConfirm = (selectedDate: Date) => {
    setAppointmentDate(selectedDate);
    setShowDatePicker(false);
  };

  const handleDateCancel = () => {
    setShowDatePicker(false);
  };

  const handleTimeConfirm = (selectedTime: Date) => {
    setAppointmentTime(selectedTime);
    setShowTimePicker(false);
  };

  const handleTimeCancel = () => {
    setShowTimePicker(false);
  };

  const buildTimeLabel = () => {
    if (selectedTime === 'sofort') return i18n.t('common.time_sofort');
    if (selectedTime === 'flexibel')
      return i18n.t('common.time_flexible', {
        range: flexibleRange || i18n.t('common.time_open'),
      });
    if (selectedTime === 'termin') {
      return i18n.t('common.time_scheduled', {
        date: formattedDate,
        time: formattedTime,
      });
    }
    return '';
  };

  const handleSubmit = async () => {
    if (!problem || !selectedCategory || (!selectedPrice && !customPrice) || !selectedTime) {
      alert(i18n.t('create.fill_all'));
      return;
    }

    if (selectedPrice === 'custom' && !customPrice.trim()) {
      alert(i18n.t('create.fill_all'));
      return;
    }

    if (priceValidation.isBelowMinimum) {
      alert(i18n.t('create.custom_price_min_error', { amount: MIN_JOB_BASE_PRICE }));
      return;
    }

    if (!priceValidation.isValid || priceValue === null || !priceBreakdown) {
      alert(i18n.t('create.invalid_price'));
      return;
    }

    if (selectedTime === 'flexibel' && !flexibleRange.trim()) {
      alert(i18n.t('create.enter_flexible'));
      return;
    }

    if (selectedTime === 'termin' && (!appointmentDate || !appointmentTime)) {
      alert(i18n.t('create.pick_date_time'));
      return;
    }

    const finalPrice = toStoredPriceValue(priceBreakdown.basePrice);

    const rebookingMeta: JobRebooking | undefined = rebookBuddy
      ? {
          preferredBuddyId: rebookBuddy.id,
          preferredBuddyName: rebookBuddy.name,
          sourceJobId: rebookBuddy.sourceJobId,
          status: 'pending',
          createdAt: new Date().toISOString(),
        }
      : undefined;

    const newJob: Job = {
      id: Date.now().toString(),
      requesterId: getActiveDevUserId(),
      creatorName: getActiveDevUser().name,
      category: selectedCategory,
      problem,
      price: finalPrice,
      basePrice: priceBreakdown.basePrice,
      platformFee: priceBreakdown.platformFee,
      totalPrice: priceBreakdown.totalPrice,
      payment: createInitialPaymentState(priceBreakdown),
      time: buildTimeLabel(),
      timeMode: selectedTime,
      flexibleRange,
      appointmentDate: formattedDate,
      appointmentTime: formattedTime,
      media,
      location: {
        lat: 47.856,
        lng: 12.128,
      },
      status: 'open',
      expiresAt: computeExpiresAt(selectedTime, formattedDate, formattedTime),
      rebooking: rebookingMeta,
    };

    try {
      const existingJobsRaw = await AsyncStorage.getItem('jobs');
      const existingJobs = existingJobsRaw ? JSON.parse(existingJobsRaw) : [];
      const safeJobs = Array.isArray(existingJobs) ? existingJobs : [];

      const updatedJobs = [newJob, ...safeJobs];
      await AsyncStorage.setItem('jobs', JSON.stringify(updatedJobs));

      if (notifyPreferredBuddies && preferredBuddies.length > 0) {
        const notification = createNotification(
          'preferredBuddyJob',
          i18n.t('notifications.preferredBuddyJob'),
          i18n.t('notifications.preferred_buddy_rebooking'),
          newJob.id
        );

        const notificationsRaw = await AsyncStorage.getItem('notifications');
        const existingNotifications: Notification[] = notificationsRaw
          ? JSON.parse(notificationsRaw)
          : [];

        const safeNotifications = Array.isArray(existingNotifications)
          ? existingNotifications
          : [];

        await AsyncStorage.setItem(
          'notifications',
          JSON.stringify([notification, ...safeNotifications])
        );
      }

      setProblem('');
      setSelectedCategory(null);
      setCategoryManuallySelected(false);
      setSelectedPrice(null);
      setCustomPrice('');
      setSelectedTime(null);
      setFlexibleRange('');
      setMedia([]);
      setAppointmentDate(null);
      setAppointmentTime(null);
      setNotifyPreferredBuddies(false);
      setRebookBuddy(null);

      router.push('/(tabs)/feed');
    } catch (error) {
      console.error(error);
      alert(i18n.t('create.create_error'));
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + spacing.xl,
            paddingBottom: Math.max(insets.bottom + spacing.xxxl, layout.screenPaddingY + spacing.xl),
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>{i18n.t('create.create_job')}</Text>

        {rebookBuddy && (
          <View style={styles.rebookBanner}>
            <View style={styles.rebookBannerMain}>
              <Text style={styles.rebookBannerLabel}>
                {i18n.t('rebooking.selected_buddy_label')}
              </Text>
              <View style={styles.rebookBannerNameRow}>
                <View style={styles.rebookBannerAvatar}>
                  <Text style={styles.rebookBannerAvatarText}>
                    {rebookBuddy.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View>
                  <Text style={styles.rebookBannerName}>{rebookBuddy.name}</Text>
                  <Text style={styles.rebookBannerMeta}>
                    {i18n.t('rebooking.jobs_together', { count: rebookBuddy.jobsWorked })}
                    {' · '}
                    {i18n.t('rebooking.context_verified')}
                  </Text>
                </View>
              </View>
              <Text style={styles.rebookBannerHint}>
                {i18n.t('rebooking.unavailable_hint')}
              </Text>
            </View>
            <Pressable
              style={styles.rebookBannerClear}
              onPress={() => setRebookBuddy(null)}
            >
              <Text style={styles.rebookBannerClearText}>
                {i18n.t('rebooking.clear_selection')}
              </Text>
            </Pressable>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.label}>{i18n.t('create.describe_problem')}</Text>
          <TextInput
            style={styles.inputLarge}
            placeholder={i18n.t('create.problem_placeholder')}
            placeholderTextColor={colors.iosShadow}
            value={problem}
            onChangeText={handleProblemChange}
            multiline
            textAlignVertical="top"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>{i18n.t('create.add_media')}</Text>
          <Text style={styles.helperText}>{i18n.t('create.media_helper')}</Text>

          <Pressable style={styles.mediaButton} onPress={pickMedia}>
            <Text style={styles.mediaButtonText}>{i18n.t('create.select_files')}</Text>
          </Pressable>

          {media.length > 0 && (
            <View style={styles.mediaGrid}>
              {media.map((uri) => (
                <View key={uri} style={styles.mediaCard}>
                  <Image source={{ uri }} style={styles.mediaPreview} />
                  <Pressable
                    style={styles.removeMediaButton}
                    onPress={() => removeMedia(uri)}
                  >
                    <Text style={styles.removeMediaButtonText}>
                      {i18n.t('create.remove')}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>{i18n.t('create.category_question')}</Text>
          {!categoryManuallySelected && suggestedCategory && (
            <Text style={styles.helperText}>{i18n.t('create.category_suggested_hint')}</Text>
          )}
          <View style={styles.categoryGrid}>
            {JOB_CATEGORIES.map((category) => {
              const isActive = selectedCategory === category;
              return (
                <Pressable
                  key={category}
                  style={[styles.categoryChip, isActive && styles.categoryChipActive]}
                  onPress={() => {
                    setSelectedCategory(category);
                    setCategoryManuallySelected(true);
                  }}
                >
                  <Text
                    style={[styles.categoryChipText, isActive && styles.categoryChipTextActive]}
                  >
                    {i18n.t(`preferences.categories.${category}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>{i18n.t('create.price_question')}</Text>
          <Text style={styles.helperText}>{i18n.t(priceHelperKey)}</Text>

          <View style={styles.priceGrid}>
            {['10', '25', '50'].map((price) => (
              <Pressable
                key={price}
                style={[
                  styles.priceButton,
                  selectedPrice === price && styles.priceButtonActive,
                ]}
                onPress={() => setSelectedPrice(price)}
              >
                <Text
                  style={[
                    styles.priceText,
                    selectedPrice === price && styles.priceTextActive,
                  ]}
                >
                  {price}€
                </Text>
              </Pressable>
            ))}

            <Pressable
              style={[
                styles.priceButton,
                isCustomPrice && styles.priceButtonActive,
              ]}
              onPress={() => setSelectedPrice('custom')}
            >
              <Text
                style={[
                  styles.priceText,
                  isCustomPrice && styles.priceTextActive,
                ]}
              >
                {i18n.t('create.custom')}
              </Text>
            </Pressable>
          </View>

          {isCustomPrice && (
            <View style={styles.customPriceWrap}>
              <TextInput
                style={styles.customPriceInput}
                placeholder={i18n.t('create.custom_amount_placeholder')}
                placeholderTextColor={colors.iosShadow}
                keyboardType="numeric"
                value={customPrice}
                onChangeText={setCustomPrice}
              />
              <Text style={styles.euroSuffix}>€</Text>
            </View>
          )}

          {showCustomPriceValidationError && (
            <Text style={styles.priceValidationErrorText}>
              {i18n.t(customPriceValidationKey, { amount: MIN_JOB_BASE_PRICE })}
            </Text>
          )}

          {priceBreakdown && (
            <Text style={styles.pricePreviewText}>
              {i18n.t('create.price_preview', {
                amount: formatPriceAmount(priceBreakdown.basePrice),
              })}
            </Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>{i18n.t('create.when_help')}</Text>

          <View style={styles.timeRow}>
            <Pressable
              style={[
                styles.timeButton,
                selectedTime === 'sofort' && styles.timeButtonActive,
              ]}
              onPress={() => setSelectedTime('sofort')}
            >
              <Text
                style={[
                  styles.timeText,
                  selectedTime === 'sofort' && styles.timeTextActive,
                ]}
              >
                {i18n.t('common.time_sofort')}
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.timeButton,
                selectedTime === 'flexibel' && styles.timeButtonActive,
              ]}
              onPress={() => setSelectedTime('flexibel')}
            >
              <Text
                style={[
                  styles.timeText,
                  selectedTime === 'flexibel' && styles.timeTextActive,
                ]}
              >
                {i18n.t('common.flexible')}
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.timeButton,
                selectedTime === 'termin' && styles.timeButtonActive,
              ]}
              onPress={() => setSelectedTime('termin')}
            >
              <Text
                style={[
                  styles.timeText,
                  selectedTime === 'termin' && styles.timeTextActive,
                ]}
              >
                {i18n.t('common.scheduled')}
              </Text>
            </Pressable>
          </View>

          {selectedTime === 'flexibel' && (
            <TextInput
              style={styles.extraInput}
              placeholder={i18n.t('create.flexible_placeholder')}
              placeholderTextColor={colors.iosShadow}
              value={flexibleRange}
              onChangeText={setFlexibleRange}
            />
          )}

          {selectedTime === 'termin' && (
            <View style={styles.terminWrap}>
              <Pressable
                style={styles.terminButton}
                onPress={() => setShowDatePicker(true)}
              >
                <Text style={styles.terminButtonLabel}>
                  {i18n.t('create.select_date')}
                </Text>
                <Text style={styles.terminButtonValue}>
                  {formattedDate || i18n.t('create.no_date')}
                </Text>
              </Pressable>

              <Pressable
                style={styles.terminButton}
                onPress={() => setShowTimePicker(true)}
              >
                <Text style={styles.terminButtonLabel}>
                  {i18n.t('create.select_time')}
                </Text>
                <Text style={styles.terminButtonValue}>
                  {formattedTime || i18n.t('create.no_time')}
                </Text>
              </Pressable>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>{i18n.t('create.notify_preferred_buddies')}</Text>
          <Text style={styles.helperText}>{i18n.t('create.notify_preferred_buddies_helper')}</Text>

          <Pressable
            style={styles.notifyRow}
            onPress={() =>
              preferredBuddies.length > 0 &&
              setNotifyPreferredBuddies((prev) => !prev)
            }
          >
            <Text style={styles.notifyLabel}>
              {i18n.t('create.notify_preferred_buddies_toggle')}
            </Text>
            <View
              style={[
                styles.toggle,
                notifyPreferredBuddies && styles.toggleActive,
                preferredBuddies.length === 0 && styles.toggleDisabled,
              ]}
            >
              <View
                style={[
                  styles.toggleHandle,
                  notifyPreferredBuddies && styles.toggleHandleActive,
                ]}
              />
            </View>
          </Pressable>

          {preferredBuddies.length > 0 ? (
            <View style={styles.preferredBuddiesChips}>
              {preferredBuddies.slice(0, 4).map((buddy) => (
                <View
                  key={buddy.id}
                  style={[
                    styles.preferredBuddyChip,
                    notifyPreferredBuddies && styles.preferredBuddyChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.preferredBuddyChipText,
                      notifyPreferredBuddies && styles.preferredBuddyChipTextActive,
                    ]}
                  >
                    {buddy.name}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.helperText}>{i18n.t('create.no_preferred_buddies')}</Text>
          )}
        </View>

        {priceBreakdown && (
          <View style={styles.section}>
            <Text style={styles.label}>{i18n.t('create.submit_pricing_title')}</Text>
            <Text style={styles.helperText}>{i18n.t('create.submit_pricing_hint')}</Text>

            <View style={styles.submitPricingCard}>
              <View style={styles.priceBreakdownRow}>
                <Text style={styles.priceBreakdownLabel}>{i18n.t('create.price_line_job')}</Text>
                <Text style={styles.priceBreakdownValue}>{formatPriceAmount(priceBreakdown.basePrice)} €</Text>
              </View>

              <View style={styles.priceBreakdownRow}>
                <Text style={styles.priceBreakdownLabel}>{i18n.t('create.price_line_fee')}</Text>
                <Text style={styles.priceBreakdownValue}>{formatPriceAmount(priceBreakdown.platformFee)} €</Text>
              </View>

              <View style={[styles.priceBreakdownRow, styles.priceBreakdownTotalRow]}>
                <Text style={styles.priceBreakdownTotalLabel}>{i18n.t('create.price_line_total')}</Text>
                <Text style={styles.priceBreakdownTotalValue}>{formatPriceAmount(priceBreakdown.totalPrice)} €</Text>
              </View>
            </View>
          </View>
        )}

        <Pressable
          style={[styles.submitButton, isSubmitBlockedByPrice && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={isSubmitBlockedByPrice}
        >
          <Text style={styles.submitText}>{i18n.t('create.find_buddy')}</Text>
        </Pressable>
      </ScrollView>

      <DateTimePickerModal
        isVisible={showDatePicker}
        mode="date"
        onConfirm={handleDateConfirm}
        onCancel={handleDateCancel}
        date={appointmentDate || new Date()}
      />

      <DateTimePickerModal
        isVisible={showTimePicker}
        mode="time"
        onConfirm={handleTimeConfirm}
        onCancel={handleTimeCancel}
        date={appointmentTime || new Date()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: layout.screenPaddingX,
  },
  title: {
    ...typography.screenTitle,
    color: colors.textPrimary,
    marginBottom: spacing.xl,
  },
  section: {
    marginBottom: spacing.xxl,
  },
  label: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  helperText: {
    ...typography.metaStrong,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    lineHeight: 19,
  },
  inputLarge: {
    backgroundColor: colors.lightGrey,
    borderRadius: layout.borderRadiusLarge,
    padding: layout.cardPadding,
    minHeight: 120,
    ...typography.body,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mediaButton: {
    backgroundColor: colors.secondary,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: layout.shadowSmall,
  },
  mediaButtonText: {
    color: colors.card,
    ...typography.buttonSecondary,
  },
  mediaGrid: {
    marginTop: spacing.lg,
    gap: layout.sectionGap,
  },
  mediaCard: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusSmall,
    padding: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: spacing.lg,
    shadowOffset: { width: 0, height: 3 },
    elevation: layout.shadowSmall,
  },
  mediaPreview: {
    width: '100%',
    height: 160,
    borderRadius: layout.borderRadiusSmall,
    backgroundColor: colors.lightGreyVariant,
  },
  removeMediaButton: {
    marginTop: layout.componentGap,
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    borderRadius: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  removeMediaButtonText: {
    color: colors.card,
    ...typography.metaStrong,
  },
  priceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: layout.sectionGap,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: layout.sectionGap,
  },
  categoryChip: {
    backgroundColor: colors.lightGrey,
    borderRadius: 999,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryChipActive: {
    backgroundColor: colors.secondary,
  },
  categoryChipText: {
    color: colors.textPrimary,
    ...typography.metaStrong,
  },
  categoryChipTextActive: {
    color: colors.card,
  },
  priceButton: {
    backgroundColor: colors.lightGrey,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.lg,
    paddingHorizontal: layout.cardPadding,
    minWidth: 80,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  priceButtonActive: {
    backgroundColor: colors.primary,
  },
  priceText: {
    color: colors.textPrimary,
    ...typography.cardTitle,
  },
  priceTextActive: {
    color: colors.card,
  },
  customPriceWrap: {
    marginTop: spacing.lg,
    backgroundColor: colors.lightGrey,
    borderRadius: layout.borderRadiusSmall,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  customPriceInput: {
    flex: 1,
    paddingVertical: spacing.lg,
    ...typography.body,
    color: colors.textPrimary,
  },
  euroSuffix: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    marginLeft: spacing.sm,
  },
  pricePreviewText: {
    ...typography.meta,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  priceBreakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  priceBreakdownTotalRow: {
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.lightBorder,
  },
  priceBreakdownLabel: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  priceBreakdownValue: {
    ...typography.metaStrong,
    color: colors.textPrimary,
  },
  priceBreakdownTotalLabel: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
  },
  priceBreakdownTotalValue: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
  },
  priceValidationErrorText: {
    ...typography.meta,
    color: colors.red,
    marginTop: spacing.sm,
  },
  timeRow: {
    flexDirection: 'row',
    gap: layout.sectionGap,
    flexWrap: 'wrap',
  },
  timeButton: {
    backgroundColor: colors.lightGrey,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.lg,
    paddingHorizontal: layout.cardPadding,
    borderWidth: 1,
    borderColor: colors.border,
  },
  timeButtonActive: {
    backgroundColor: colors.secondary,
  },
  timeText: {
    color: colors.textPrimary,
    ...typography.bodyStrong,
  },
  timeTextActive: {
    color: colors.card,
  },
  extraInput: {
    marginTop: spacing.lg,
    backgroundColor: colors.lightGrey,
    borderRadius: layout.borderRadiusSmall,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    ...typography.body,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  terminWrap: {
    marginTop: spacing.lg,
    gap: layout.sectionGap,
  },
  notifyRow: {
    backgroundColor: colors.lightGrey,
    borderRadius: layout.borderRadiusSmall,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
  },
  notifyLabel: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
    flex: 1,
    marginRight: spacing.md,
  },
  toggle: {
    width: 46,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.lightBorder,
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  toggleActive: {
    backgroundColor: colors.secondary,
  },
  toggleDisabled: {
    opacity: 0.5,
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
  preferredBuddiesChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  preferredBuddyChip: {
    backgroundColor: colors.veryLightPurple,
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  preferredBuddyChipActive: {
    backgroundColor: colors.purpleBadge,
    borderColor: 'rgba(103, 97, 168, 0.22)',
  },
  preferredBuddyChipText: {
    ...typography.meta,
    color: colors.placeholder,
  },
  preferredBuddyChipTextActive: {
    color: colors.secondary,
  },
  terminButton: {
    backgroundColor: colors.lightGrey,
    borderRadius: layout.borderRadiusSmall,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  terminButtonLabel: {
    ...typography.metaStrong,
    color: colors.secondary,
    marginBottom: spacing.sm,
  },
  terminButtonValue: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
  },
  submitPricingCard: {
    borderRadius: layout.borderRadiusSmall,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    backgroundColor: colors.card,
    padding: spacing.md,
    gap: spacing.xs,
  },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: layout.borderRadiusMedium,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: spacing.lg,
    shadowOffset: { width: 0, height: 4 },
    elevation: layout.shadowLarge,
  },
  submitButtonDisabled: {
    opacity: 0.45,
  },
  submitText: {
    color: colors.card,
    ...typography.button,
  },
  rebookBanner: {
    backgroundColor: colors.lightPurple,
    borderRadius: layout.borderRadiusMedium,
    borderWidth: 1,
    borderColor: colors.secondary,
    padding: layout.cardPadding,
    marginBottom: spacing.xxl,
    gap: spacing.sm,
  },
  rebookBannerMain: {
    gap: spacing.sm,
  },
  rebookBannerLabel: {
    ...typography.metaStrong,
    color: colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  rebookBannerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  rebookBannerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rebookBannerAvatarText: {
    ...typography.metaStrong,
    color: colors.card,
  },
  rebookBannerName: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
  },
  rebookBannerMeta: {
    ...typography.meta,
    color: colors.secondary,
    marginTop: 2,
  },
  rebookBannerHint: {
    ...typography.meta,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  rebookBannerClear: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  rebookBannerClearText: {
    ...typography.meta,
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
});