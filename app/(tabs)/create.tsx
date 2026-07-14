import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
    Image,
    Modal,
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
import { debugLog } from '../../lib/config/debug';
import i18n, { useLanguage } from '../../lib/i18n';
import { getActiveUserId } from '../../lib/auth';
import { useCurrentUser } from '../../lib/current-user';
import { CATEGORY_META, computeExpiresAt, Job, JOB_CATEGORIES, JobCategory, JobRebooking, TimeMode } from '../../lib/jobs';
import { upsertJob, deleteJob } from '../../services/jobs.service';
import { setJobLocation, type SetJobLocationParams } from '../../services/geo.service';
import { getCurrentLocationFix } from '../../lib/geo-location';
import { chooseImageSource, takePhotoWithCamera } from '../../lib/media-picker';
import { uploadMedia } from '../../services/media.service';
import { addNotification } from '../../services/notifications.service';
import { createInitialPaymentState } from '../../lib/payments';
import { loadPreferredBuddies, PreferredBuddy } from '../../lib/preferred-buddies';
import { incrementReliabilityStats } from '../../services/user.service';
import {
    calculatePriceBreakdown,
    formatPriceAmount,
    MAX_JOB_BASE_PRICE,
    MIN_JOB_BASE_PRICE,
    toStoredPriceValue,
    validateJobBasePrice,
} from '../../lib/pricing';
import { layout, spacing } from '../../lib/spacing';
import { typography } from '../../lib/typography';

// New jobs start with a local timestamp id and are promoted to a Supabase UUID
// on sync; only the UUID can be referenced by set_job_location().
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function CreateScreen() {
  useLanguage();
  const insets = useSafeAreaInsets();
  const { user: currentUser } = useCurrentUser();
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
  const [selectedTime, setSelectedTime] = useState<TimeMode | null>(null);

  const [flexibleRange, setFlexibleRange] = useState('');
  const [media, setMedia] = useState<string[]>([]);

  const [appointmentDate, setAppointmentDate] = useState<Date | null>(null);
  const [appointmentTime, setAppointmentTime] = useState<Date | null>(null);

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [notifyPreferredBuddies, setNotifyPreferredBuddies] = useState(false);
  const [showBuddyModal, setShowBuddyModal] = useState(false);
  const [preferredBuddies, setPreferredBuddies] = useState<PreferredBuddy[]>([]);
  const [showCategorySheet, setShowCategorySheet] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');
  const suggestFade = useRef(new Animated.Value(0)).current;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const errorToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (errorToast) {
      if (errorToastTimer.current) clearTimeout(errorToastTimer.current);
      errorToastTimer.current = setTimeout(() => setErrorToast(null), 2500);
    }
    return () => {
      if (errorToastTimer.current) clearTimeout(errorToastTimer.current);
    };
  }, [errorToast]);

  const isCustomPrice = selectedPrice === 'custom';

  const CATEGORY_KEYWORDS: Record<JobCategory, string[]> = {
    transport: ['transport', 'fahrt', 'fahrdienst', 'taxi', 'auto', 'fahrer', 'mitfahrt', 'chauffeur', 'fahren', 'drive', 'pickup'],
    moving: ['möbel tragen', 'tragen', 'schleppen', 'sofa', 'schrank', 'schwer', 'last', 'heben'],
    relocation: ['umzug', 'umziehen', 'einzug', 'auszug', 'karton', 'kiste', 'umzugshilfe'],
    errands: ['einkauf', 'besorgung', 'supermarkt', 'apotheke', 'paket', 'post', 'bank', 'errand', 'einkaufen', 'besorgen', 'shop', 'buy', 'pharmacy'],
    tech: ['tech', 'computer', 'pc', 'laptop', 'software', 'router', 'internet', 'wifi', 'handy', 'setup', 'wlan', 'phone'],
    household: ['haushalt', 'putzen', 'reinigung', 'wäsche', 'küche', 'wohnung', 'sauber', 'clean', 'waschen', 'reinigen', 'wash', 'laundry'],
    garden: ['garten', 'rasen', 'hecke', 'mähen', 'pflanzen', 'schneiden', 'terrasse', 'balkon', 'außen'],
    furniture: ['möbel aufbauen', 'aufbauen', 'ikea', 'regal', 'bett aufbauen', 'schrank aufbauen', 'aufbau'],
    petcare: ['hund', 'katze', 'tier', 'haustier', 'gassi', 'füttern', 'tierpflege', 'pet'],
    events: ['event', 'gastronomie', 'gastro', 'feier', 'party', 'veranstaltung', 'kellner', 'catering', 'service'],
    photo: ['foto', 'photo', 'social media', 'instagram', 'content', 'video', 'shooting', 'kamera', 'reels'],
    handyman: ['handyman', 'reparatur', 'repair', 'bohren', 'montieren', 'bauen', 'werkzeug', 'install', 'schrauben', 'kaputt', 'reparieren', 'broken', 'fix'],
    storage: ['lager', 'lagern', 'stapeln', 'keller', 'dachboden', 'einlagern', 'sortieren'],
    delivery: ['lieferung', 'liefern', 'abholen', 'abholung', 'kurierfahrt', 'auslieferung', 'bringen'],
    other: ['sonstige', 'andere', 'sonstiges', 'anderes', 'verschiedenes'],
  };

  const detectTopCategories = (text: string): JobCategory[] => {
    const normalized = text.toLowerCase();
    if (!normalized.trim()) return [];

    const scores: { category: JobCategory; score: number }[] = [];

    for (const category of JOB_CATEGORIES) {
      const keywords = CATEGORY_KEYWORDS[category];
      let score = 0;
      for (const keyword of keywords) {
        if (normalized.includes(keyword)) score += 1;
      }
      if (score > 0) scores.push({ category, score });
    }

    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((s) => s.category);
  };

  const topSuggestions = useMemo(
    () => detectTopCategories(problem),
    [problem]
  );

  useEffect(() => {
    if (categoryManuallySelected) return;
    const top = topSuggestions[0] ?? null;
    if (!top) return;
    if (selectedCategory === top) return;
    setSelectedCategory(top);
  }, [categoryManuallySelected, selectedCategory, topSuggestions]);

  useEffect(() => {
    Animated.timing(suggestFade, {
      toValue: topSuggestions.length > 0 ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [topSuggestions.length, suggestFade]);

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
        isAboveMaximum: false,
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
    !priceValidation.isValid;

  const customPriceValidationKey = priceValidation.isBelowMinimum
    ? 'create.custom_price_min_error'
    : priceValidation.isAboveMaximum
      ? 'create.custom_price_max_error'
      : 'create.invalid_price';

  const customPriceValidationAmount = priceValidation.isAboveMaximum
    ? MAX_JOB_BASE_PRICE
    : MIN_JOB_BASE_PRICE;

  const isFormValid =
    problem.trim().length > 0 &&
    selectedCategory !== null &&
    selectedPrice !== null &&
    (!isCustomPrice || priceValidation.isValid) &&
    selectedTime !== null &&
    (selectedTime !== 'flexibel' || flexibleRange.trim().length > 0) &&
    (selectedTime !== 'termin' || (appointmentDate !== null && appointmentTime !== null));

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
      setErrorToast(i18n.t('create.max_3_media'));
      return;
    }

    const source = await chooseImageSource();
    if (!source) return;

    if (source === 'camera') {
      const shot = await takePhotoWithCamera();
      if (shot.status === 'ok') {
        setMedia([...media, shot.uri].slice(0, 3));
      }
      return; // canceled/denied handled inside the helper
    }

    const permissionResult =
      await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permissionResult.granted) {
      setErrorToast(i18n.t('create.allow_media'));
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
    if (isSubmitting || !isFormValid) return;

    if (!priceBreakdown || priceValue === null) return;

    setIsSubmitting(true);
    const tSubmit = Date.now();

    const finalPrice = toStoredPriceValue(priceBreakdown.basePrice);
    const tempJobId = Date.now().toString();
    const userId = getActiveUserId();

    // Upload all local URIs in parallel. With Promise.all the total time is
    // bounded by the slowest single upload, not the sum of all uploads.
    // Pre-existing http(s) URLs (e.g. an already-uploaded image being re-saved)
    // pass through untouched and keep their position in the array.
    const tMedia = Date.now();
    const settled = await Promise.allSettled(
      media.map((uri) =>
        uri.startsWith('http')
          ? Promise.resolve({ publicUrl: uri })
          : uploadMedia(uri, tempJobId, userId)
      )
    );
    const remoteMedia: string[] = [];
    let anyUploadFailed = false;
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        remoteMedia.push(r.value.publicUrl);
      } else {
        console.warn(`[create] media upload failed idx=${i}:`, r.reason);
        anyUploadFailed = true;
      }
    });
    debugLog(`[create] handleSubmit: media uploads done count=${remoteMedia.length}/${media.length} (${Date.now() - tMedia}ms)`);
    if (anyUploadFailed) {
      setErrorToast(i18n.t('create.media_upload_failed'));
    }

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
      id: tempJobId,
      requesterId: userId,
      creatorName: currentUser?.displayName || '',
      category: selectedCategory,
      problem,
      price: finalPrice,
      basePrice: priceBreakdown.basePrice,
      platformFee: priceBreakdown.platformFee,
      totalPrice: priceBreakdown.totalPrice,
      payment: createInitialPaymentState(priceBreakdown),
      time: buildTimeLabel(),
      timeMode: selectedTime ?? undefined,
      flexibleRange,
      appointmentDate: formattedDate,
      appointmentTime: formattedTime,
      media: remoteMedia,
      // Exact coordinates are NOT stored in the world-readable job payload.
      // They are written separately to the private job_locations side-table via
      // set_job_location() after the job is created (see below). The server adds
      // a coarse payload.location_summary; the client stores no lat/lng.
      status: 'open',
      expiresAt: computeExpiresAt(selectedTime ?? undefined, formattedDate, formattedTime),
      rebooking: rebookingMeta,
    };

    // TODO(rate-limit): enforce per-user job creation rate limit (e.g. 5 active jobs or 10/day) before upsertJob.
    try {
      // Capture the real device (or cached) location BEFORE creating the job, so
      // a public.jobs row is never inserted without a usable location. No
      // hardcoded fallback.
      // TODO(geo-manual-fallback): offer a manual city/postal/map-pin entry here
      // instead of blocking, for users who deny location or have no fix.
      const fixOutcome = await getCurrentLocationFix();
      if (!fixOutcome.ok) {
        console.warn(`[create] getCurrentLocationFix failed (pre-create): code=${fixOutcome.code}`);
        setErrorToast(i18n.t('create.location_unavailable'));
        return; // keep the form; do not create a job without a real location
      }
      const { fix } = fixOutcome;

      const tUpsert = Date.now();
      const { jobId } = await upsertJob(newJob);
      debugLog(`[create] handleSubmit: upsertJob done id=${jobId} (${Date.now() - tUpsert}ms)`);

      // Record the job's location via the secure RPC (writes exact coordinates
      // to the private job_locations table; the world-readable payload only ever
      // gets a coarse, server-owned summary — never lat/lng). Skipped for
      // local-only/offline jobs whose id was never promoted to a Supabase UUID.
      if (UUID_REGEX.test(jobId)) {
        const geoParams: SetJobLocationParams = {
          jobId,
          lat: fix.lat,
          lng: fix.lng,
          geoPrecision: fix.source === 'device' ? 'exact' : 'approx',
          city: fix.city ?? null,
          postalCode: fix.postalCode ?? null,
        };
        // One retry absorbs a transient RPC hiccup before we give up.
        let geoOutcome = await setJobLocation(geoParams);
        if (!geoOutcome.ok) {
          geoOutcome = await setJobLocation(geoParams);
        }
        if (!geoOutcome.ok) {
          // The jobs row was inserted but has no job_locations row — it would be
          // an orphaned, locationless open job that never surfaces in the nearby
          // feed (nearby_open_jobs INNER JOINs job_locations). Roll the job back
          // so creation is all-or-nothing: no location ⇒ no job.
          console.warn(`[create] set_job_location failed after retry: code=${geoOutcome.code} job=${jobId} — rolling back job`);
          try {
            await deleteJob(jobId);
          } catch (delErr) {
            console.warn('[create] rollback deleteJob failed:', delErr instanceof Error ? delErr.message : String(delErr));
          }
          setErrorToast(i18n.t('create.location_error'));
          return; // keep the form; nothing persisted remotely
        }
      }

      // Non-critical follow-ups run in the background so we can navigate immediately.
      void incrementReliabilityStats(getActiveUserId(), 'totalPostedJobs').catch((e) =>
        console.warn('[create] incrementReliabilityStats failed:', e)
      );
      if (notifyPreferredBuddies && preferredBuddies.length > 0) {
        void addNotification(
          'preferredBuddyJob',
          i18n.t('notifications.preferredBuddyJob'),
          i18n.t('notifications.preferred_buddy_rebooking'),
          newJob.id
        ).catch((e) => console.warn('[create] addNotification failed:', e));
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

      console.log(`[create] posted job=${newJob.id} in ${Date.now() - tSubmit}ms`);
      router.push('/(tabs)/feed');
    } catch (error) {
      console.error(error);
      setErrorToast(i18n.t('create.create_error'));
    } finally {
      setIsSubmitting(false);
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

          <Pressable
            style={[styles.mediaButton, media.length >= 3 && styles.mediaButtonDisabled]}
            onPress={pickMedia}
            disabled={media.length >= 3}
          >
            <Text style={styles.mediaButtonText}>{i18n.t('create.select_files')}</Text>
          </Pressable>

          {media.length > 0 && (
            <Text style={styles.mediaCount}>{media.length} / 3</Text>
          )}

          {media.length > 0 && (
            <View style={styles.mediaThumbnailRow}>
              {media.map((uri) => (
                <View key={uri} style={styles.mediaThumbnailWrap}>
                  <Image
                    source={{ uri }}
                    style={styles.mediaThumbnail}
                    resizeMode="cover"
                  />
                  <Pressable
                    style={styles.mediaThumbnailRemove}
                    onPress={() => removeMedia(uri)}
                    hitSlop={8}
                  >
                    <Text style={styles.mediaThumbnailRemoveText}>✕</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>{i18n.t('create.category_question')}</Text>

          {topSuggestions.length > 0 && (
            <Animated.View style={[styles.catSuggestRow, { opacity: suggestFade }]}>
              {topSuggestions.map((cat) => {
                const isActive = selectedCategory === cat;
                return (
                  <Pressable
                    key={cat}
                    style={({ pressed }) => [
                      styles.catSuggestChip,
                      isActive && styles.catSuggestChipActive,
                      pressed && { opacity: 0.7 },
                    ]}
                    onPress={() => {
                      setSelectedCategory(cat);
                      setCategoryManuallySelected(true);
                    }}
                  >
                    <Ionicons
                      name={CATEGORY_META[cat].icon as any}
                      size={12}
                      color={isActive ? colors.card : colors.textSecondary}
                    />
                    <Text style={[styles.catSuggestText, isActive && styles.catSuggestTextActive]}>
                      {i18n.t(`preferences.categories.${cat}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </Animated.View>
          )}

          <Pressable
            style={({ pressed }) => [
              styles.catSelectorBtn,
              selectedCategory != null && styles.catSelectorBtnSelected,
              pressed && { opacity: 0.75 },
            ]}
            onPress={() => setShowCategorySheet(true)}
          >
            {selectedCategory != null && (
              <View style={styles.catSelectorIconWrap}>
                <Ionicons
                  name={CATEGORY_META[selectedCategory].icon as any}
                  size={15}
                  color={colors.secondary}
                />
              </View>
            )}
            <Text style={[styles.catSelectorText, selectedCategory != null && styles.catSelectorTextSelected]}>
              {selectedCategory
                ? i18n.t(`preferences.categories.${selectedCategory}`)
                : i18n.t('create.category_placeholder')}
            </Text>
            <Ionicons name="chevron-forward-outline" size={15} color={colors.placeholder} />
          </Pressable>
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
                styles.customPriceButton,
                isCustomPrice && styles.priceButtonActive,
              ]}
              onPress={() => setSelectedPrice('custom')}
            >
              <Text
                style={[
                  styles.customPriceButtonText,
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
              {i18n.t(customPriceValidationKey, { amount: customPriceValidationAmount })}
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
            onPress={() => {
              if (notifyPreferredBuddies) {
                setNotifyPreferredBuddies(false);
              } else if (preferredBuddies.length > 0) {
                setNotifyPreferredBuddies(true);
                setShowBuddyModal(true);
              }
            }}
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

          {preferredBuddies.length === 0 && (
            <Text style={styles.helperText}>{i18n.t('create.no_preferred_buddies')}</Text>
          )}
        </View>

        {priceBreakdown && (
          <View style={styles.section}>
            <Text style={styles.label}>{i18n.t('create.submit_pricing_title')}</Text>

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
          style={[styles.submitButton, (!isFormValid || isSubmitting) && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={!isFormValid || isSubmitting}
        >
          {isSubmitting
            ? <ActivityIndicator size="small" color={colors.card} />
            : <Text style={styles.submitText}>{i18n.t('create.find_buddy')}</Text>
          }
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

      {errorToast && (
        <View
          style={[styles.errorToast, { bottom: insets.bottom + spacing.xxl }]}
          pointerEvents="none"
        >
          <Text style={styles.errorToastText}>{errorToast}</Text>
        </View>
      )}

      <Modal
        visible={showCategorySheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCategorySheet(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowCategorySheet(false)}>
          <Pressable style={[styles.catSheetContainer, { paddingBottom: insets.bottom + spacing.xl }]} onPress={() => {}}>
            <View style={styles.catSheetHandleBar} />
            <View style={styles.catSheetHeader}>
              <Text style={styles.catSheetTitle}>{i18n.t('create.category_question')}</Text>
            </View>
            <View style={styles.catSheetSearchWrap}>
              <Ionicons name="search-outline" size={15} color={colors.placeholder} />
              <TextInput
                style={styles.catSheetSearchInput}
                value={categorySearch}
                onChangeText={setCategorySearch}
                placeholder={i18n.t('create.category_search_placeholder')}
                placeholderTextColor={colors.placeholder}
                autoCorrect={false}
                autoCapitalize="none"
                clearButtonMode="while-editing"
              />
            </View>
            <ScrollView style={styles.catSheetList} showsVerticalScrollIndicator={false}>
              {JOB_CATEGORIES
                .filter((cat) =>
                  !categorySearch.trim() ||
                  i18n.t(`preferences.categories.${cat}`)
                    .toLowerCase()
                    .includes(categorySearch.trim().toLowerCase())
                )
                .map((cat) => {
                  const isActive = selectedCategory === cat;
                  return (
                    <Pressable
                      key={cat}
                      style={({ pressed }) => [
                        styles.catSheetRow,
                        pressed && { opacity: 0.6 },
                      ]}
                      onPress={() => {
                        setSelectedCategory(cat);
                        setCategoryManuallySelected(true);
                        setShowCategorySheet(false);
                        setCategorySearch('');
                      }}
                    >
                      <View style={styles.catSheetRowLeft}>
                        <View style={[styles.catSheetRowIcon, isActive && styles.catSheetRowIconActive]}>
                          <Ionicons
                            name={CATEGORY_META[cat].icon as any}
                            size={15}
                            color={isActive ? colors.secondary : colors.textSecondary}
                          />
                        </View>
                        <Text style={[styles.catSheetRowText, isActive && styles.catSheetRowTextActive]}>
                          {i18n.t(`preferences.categories.${cat}`)}
                        </Text>
                      </View>
                      {isActive
                        ? <Ionicons name="checkmark-circle" size={18} color={colors.secondary} />
                        : <Ionicons name="chevron-forward-outline" size={13} color={colors.lightBorder} />
                      }
                    </Pressable>
                  );
                })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={showBuddyModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setShowBuddyModal(false);
          setNotifyPreferredBuddies(false);
        }}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => {
            setShowBuddyModal(false);
            setNotifyPreferredBuddies(false);
          }}
        >
          <Pressable style={[styles.modalSheet, { paddingBottom: insets.bottom + spacing.lg }]} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{i18n.t('create.buddy_modal_title')}</Text>
            <Text style={styles.modalHelper}>{i18n.t('create.buddy_modal_helper')}</Text>

            <ScrollView style={styles.modalList} showsVerticalScrollIndicator={false}>
              {preferredBuddies.length === 0 ? (
                <Text style={styles.modalEmpty}>{i18n.t('create.buddy_modal_empty')}</Text>
              ) : (
                preferredBuddies.map((buddy) => (
                  <View key={buddy.id} style={styles.modalBuddyRow}>
                    <View style={styles.modalBuddyAvatar}>
                      <Text style={styles.modalBuddyAvatarText}>
                        {buddy.name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.modalBuddyName}>{buddy.name}</Text>
                  </View>
                ))
              )}
            </ScrollView>

            <Pressable
              style={styles.modalConfirmButton}
              onPress={() => setShowBuddyModal(false)}
            >
              <Text style={styles.modalConfirmText}>{i18n.t('create.buddy_modal_confirm')}</Text>
            </Pressable>
            <Pressable
              style={styles.modalCancelButton}
              onPress={() => {
                setShowBuddyModal(false);
                setNotifyPreferredBuddies(false);
              }}
            >
              <Text style={styles.modalCancelText}>{i18n.t('create.buddy_modal_cancel')}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
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
  mediaButtonDisabled: {
    opacity: 0.45,
  },
  mediaCount: {
    ...typography.meta,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'right',
  },
  mediaThumbnailRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  mediaThumbnailWrap: {
    flex: 1,
    position: 'relative',
  },
  mediaThumbnail: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 10,
    backgroundColor: colors.lightGreyVariant,
  },
  mediaThumbnailRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.red,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
    borderWidth: 1.5,
    borderColor: colors.card,
  },
  mediaThumbnailRemoveText: {
    color: colors.card,
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 12,
  },
  priceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: layout.sectionGap,
  },
  catSuggestRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: spacing.sm,
  },
  catSuggestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.veryLightGrey,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.lightBorder,
  },
  catSuggestChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  catSuggestText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
    lineHeight: 17,
  },
  catSuggestTextActive: {
    color: colors.card,
  },
  catSelectorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.borderRadiusSmall,
    paddingHorizontal: spacing.lg,
    height: layout.inputHeight,
    backgroundColor: colors.card,
    gap: spacing.sm,
  },
  catSelectorBtnSelected: {
    borderColor: colors.secondary,
  },
  catSelectorIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: colors.veryLightPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catSelectorText: {
    ...typography.body,
    color: colors.placeholder,
    flex: 1,
  },
  catSelectorTextSelected: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  catSheetContainer: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: layout.screenPaddingX,
    paddingTop: spacing.sm,
  },
  catSheetHandleBar: {
    width: 32,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.lightBorder,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  catSheetHeader: {
    marginBottom: spacing.sm,
  },
  catSheetTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    letterSpacing: -0.2,
  },

  catSheetSearchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.veryLightGrey,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    paddingHorizontal: spacing.md,
    height: 36,
    marginBottom: spacing.sm,
  },
  catSheetSearchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    height: 36,
  },
  catSheetList: {
    maxHeight: 248,
  },
  catSheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.veryLightGrey2,
  },
  catSheetRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  catSheetRowIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.veryLightGrey,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catSheetRowIconActive: {
    backgroundColor: colors.veryLightPurple,
  },
  catSheetRowText: {
    fontSize: 15,
    fontWeight: '400',
    color: colors.textPrimary,
    lineHeight: 21,
  },
  catSheetRowTextActive: {
    color: colors.secondary,
    fontWeight: '500',
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
    borderColor: colors.primary,
  },
  customPriceButton: {
    backgroundColor: colors.primary,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.lg,
    paddingHorizontal: layout.cardPadding,
    minWidth: 80,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  customPriceButtonText: {
    color: colors.card,
    ...typography.cardTitle,
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
    borderColor: colors.secondary,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: layout.screenPaddingX,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.lightBorder,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  modalTitle: {
    ...typography.cardTitle,
    color: colors.textPrimary,
  },
  modalHelper: {
    ...typography.meta,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  modalList: {
    maxHeight: 220,
  },
  modalEmpty: {
    ...typography.body,
    color: colors.placeholder,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  modalBuddyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.veryLightGrey2,
  },
  modalBuddyAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.veryLightPurple,
    borderWidth: 1,
    borderColor: colors.overlayLightPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBuddyAvatarText: {
    ...typography.metaStrong,
    color: colors.secondary,
  },
  modalBuddyName: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
  },
  modalConfirmButton: {
    backgroundColor: colors.secondary,
    borderRadius: layout.borderRadiusMedium,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  modalConfirmText: {
    ...typography.button,
    color: colors.card,
  },
  modalCancelButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  modalCancelText: {
    ...typography.metaStrong,
    color: colors.textSecondary,
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
  errorToast: {
    position: 'absolute',
    left: layout.screenPaddingX,
    right: layout.screenPaddingX,
    backgroundColor: colors.red,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  errorToastText: {
    ...typography.metaStrong,
    color: colors.card,
    textAlign: 'center',
  },
});