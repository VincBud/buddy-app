import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../lib/colors';
import i18n, { getLanguage, useLanguage } from '../lib/i18n';
import { goBackOrReplace } from '../lib/navigation';
import { layout, spacing } from '../lib/spacing';
import { typography } from '../lib/typography';
import {
    createEmptyWalletSnapshot,
    loadWalletSnapshotFromStorage,
    MIN_VALID_TIMESTAMP_MS,
    requestWalletPayoutFromStorage,
    WalletEntryTone,
    WalletSnapshot,
} from '../lib/wallet';

export default function WalletScreen() {
  useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const currentLanguage = getLanguage();
  const [wallet, setWallet] = useState<WalletSnapshot>(createEmptyWalletSnapshot());

  const loadWalletData = useCallback(async () => {
    try {
      const snapshot = await loadWalletSnapshotFromStorage();
      setWallet(snapshot);
    } catch (error) {
      console.error('Error loading wallet:', error);
      setWallet(createEmptyWalletSnapshot());
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadWalletData();
    }, [loadWalletData])
  );

  const formatMoney = (amount: number) => {
    return new Intl.NumberFormat(currentLanguage === 'en' ? 'en-US' : 'de-DE', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const formatWalletDate = (date: string) => {
    const ms = new Date(date).getTime();
    // Guard against missing/invalid or epoch-0 (1970) timestamps — show a neutral
    // localized fallback instead of a nonsensical date.
    if (!Number.isFinite(ms) || ms < MIN_VALID_TIMESTAMP_MS) {
      console.warn(`[wallet] invalid transaction date, showing fallback: value="${date}"`);
      return i18n.t('wallet.date_unavailable');
    }
    return new Date(ms).toLocaleDateString(currentLanguage === 'en' ? 'en-US' : 'de-DE', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getWalletStatusLabel = () => {
    if (wallet.payoutState === 'processing') return i18n.t('wallet.status_processing');
    if (wallet.payoutState === 'setup') return i18n.t('wallet.status_setup');
    if (wallet.payoutState === 'ready') return i18n.t('wallet.status_ready');
    return i18n.t('wallet.status_minimum');
  };

  const getWalletStatusHint = () => {
    if (wallet.payoutState === 'processing') {
      return i18n.t('wallet.status_processing_hint', {
        amount: formatMoney(wallet.pendingBalance),
      });
    }

    if (wallet.payoutState === 'setup') {
      return i18n.t('wallet.status_setup_hint');
    }

    if (wallet.payoutState === 'ready') {
      return i18n.t('wallet.status_ready_hint', {
        amount: formatMoney(wallet.availableBalance),
        method: wallet.payoutMethodLabel || i18n.t('wallet.default_payout_method'),
      });
    }

    return i18n.t('wallet.status_minimum_hint', {
      amount: formatMoney(wallet.minimumPayoutAmount),
    });
  };

  const getWalletCtaLabel = () => {
    if (wallet.payoutState === 'processing') return i18n.t('wallet.cta_processing');
    if (wallet.payoutState === 'setup') return i18n.t('wallet.cta_setup');
    if (wallet.payoutState === 'ready') return i18n.t('wallet.cta_payout');
    return i18n.t('wallet.cta_minimum');
  };

  const getWalletToneStyle = (tone: WalletEntryTone) => {
    if (tone === 'positive') return styles.walletHistoryAmountPositive;
    if (tone === 'pending') return styles.walletHistoryAmountPending;
    return styles.walletHistoryAmountNeutral;
  };

  const getWalletStatusPillStyle = () => {
    if (wallet.payoutState === 'processing') return styles.walletStatusPillProcessing;
    if (wallet.payoutState === 'setup') return styles.walletStatusPillSetup;
    if (wallet.payoutState === 'ready') return styles.walletStatusPillReady;
    return styles.walletStatusPillMinimum;
  };

  const getWalletStatusPillTextStyle = () => {
    if (wallet.payoutState === 'processing') return styles.walletStatusPillTextProcessing;
    if (wallet.payoutState === 'setup') return styles.walletStatusPillTextSetup;
    if (wallet.payoutState === 'ready') return styles.walletStatusPillTextReady;
    return styles.walletStatusPillTextMinimum;
  };

  const handleWalletPayout = () => {
    if (wallet.payoutState !== 'ready') return;

    Alert.alert(
      i18n.t('wallet.payout_confirm_title'),
      i18n.t('wallet.payout_confirm_message', {
        amount: formatMoney(wallet.availableBalance),
        method: wallet.payoutMethodLabel || i18n.t('wallet.default_payout_method'),
      }),
      [
        {
          text: i18n.t('wallet.payout_cancel'),
          style: 'cancel',
        },
        {
          text: i18n.t('wallet.payout_confirm'),
          onPress: async () => {
            const result = await requestWalletPayoutFromStorage();

            if (!result.ok) {
              await loadWalletData();
              return;
            }

            await loadWalletData();

            Alert.alert(
              i18n.t('wallet.payout_success_title'),
              i18n.t('wallet.payout_success_message', {
                amount: formatMoney(result.amount),
              })
            );
          },
        },
      ]
    );
  };

  const handleBack = () => {
    goBackOrReplace(router, '/(tabs)/profile');
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}> 
        <View style={styles.headerRow}>
          <Pressable style={styles.backButton} onPress={handleBack}>
            <Text style={styles.backButtonText}>‹</Text>
          </Pressable>
          <View style={styles.headerSpacer} />
        </View>
        <Text style={styles.title}>{i18n.t('wallet.title')}</Text>
        <Text style={styles.subtitle}>{i18n.t('wallet.detail_subtitle')}</Text>
      </View>

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <View style={styles.walletHero}>
            <View style={styles.walletHeroMain}>
              <Text style={styles.walletHeroLabel}>{i18n.t('wallet.available_balance')}</Text>
              <Text style={styles.walletHeroAmount}>{formatMoney(wallet.availableBalance)}</Text>
              <Text style={styles.walletHeroHint}>{getWalletStatusHint()}</Text>
            </View>

            <View style={styles.walletStatsColumn}>
              <View style={styles.walletMiniStat}>
                <Text style={styles.walletMiniStatLabel}>{i18n.t('wallet.pending_balance')}</Text>
                <Text style={styles.walletMiniStatValue}>{formatMoney(wallet.pendingBalance)}</Text>
              </View>
              <View style={styles.walletMiniStat}>
                <Text style={styles.walletMiniStatLabel}>{i18n.t('wallet.total_earned')}</Text>
                <Text style={styles.walletMiniStatValue}>{formatMoney(wallet.totalEarned)}</Text>
              </View>
            </View>
          </View>

          <View style={styles.walletActionPanel}>
            <View style={styles.walletStatusRow}>
              <View style={[styles.walletStatusPill, getWalletStatusPillStyle()]}> 
                <Text style={[styles.walletStatusPillText, getWalletStatusPillTextStyle()]}> 
                  {getWalletStatusLabel()}
                </Text>
              </View>
              <Text style={styles.walletMethodText} numberOfLines={1}>
                {wallet.payoutMethodLabel || i18n.t('wallet.default_payout_method')}
              </Text>
            </View>

            <Pressable
              style={[
                styles.walletActionButton,
                wallet.payoutState !== 'ready' && styles.walletActionButtonDisabled,
              ]}
              disabled={wallet.payoutState !== 'ready'}
              onPress={handleWalletPayout}
            >
              <Text
                style={[
                  styles.walletActionButtonText,
                  wallet.payoutState !== 'ready' && styles.walletActionButtonTextDisabled,
                ]}
              >
                {getWalletCtaLabel()}
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.walletHistoryTitle}>{i18n.t('wallet.history_title')}</Text>

          {wallet.entries.length === 0 ? (
            <View style={styles.emptyStateCard}>
              <Text style={styles.emptyStateTitle}>{i18n.t('wallet.history_empty_title')}</Text>
              <Text style={styles.emptyText}>{i18n.t('wallet.history_empty_hint')}</Text>
            </View>
          ) : (
            <View style={styles.walletHistoryList}>
              {wallet.entries.map((entry) => (
                <View key={entry.id} style={styles.walletHistoryRow}>
                  <View style={styles.walletHistoryMeta}>
                    <Text style={styles.walletHistoryTitleText}>{entry.title}</Text>
                    <Text style={styles.walletHistorySubtitleText} numberOfLines={1}>
                      {entry.subtitle}
                    </Text>
                    <Text style={styles.walletHistoryDateText}>
                      {entry.statusLabel} • {formatWalletDate(entry.occurredAt)}
                    </Text>
                  </View>

                  <Text style={[styles.walletHistoryAmount, getWalletToneStyle(entry.tone)]}>
                    {entry.direction === 'credit' ? '+' : '-'}{formatMoney(entry.amount)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
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
  backButtonText: {
    ...typography.cardTitle,
    color: colors.textPrimary,
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
  card: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusMedium,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  walletHero: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  walletHeroMain: {
    flex: 1.2,
    backgroundColor: colors.veryLightPurple,
    borderRadius: layout.borderRadiusSmall,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.overlayLightPurple,
  },
  walletHeroLabel: {
    ...typography.metaStrong,
    color: colors.secondary,
    marginBottom: spacing.xs,
  },
  walletHeroAmount: {
    ...typography.screenTitle,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  walletHeroHint: {
    ...typography.meta,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  walletStatsColumn: {
    flex: 0.9,
    gap: spacing.sm,
  },
  walletMiniStat: {
    flex: 1,
    backgroundColor: colors.lightGrey,
    borderRadius: layout.borderRadiusSmall,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  walletMiniStatLabel: {
    ...typography.meta,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  walletMiniStatValue: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
  },
  walletActionPanel: {
    backgroundColor: colors.veryLightGrey,
    borderRadius: layout.borderRadiusSmall,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.lightBorder,
  },
  walletStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  walletStatusPill: {
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
  },
  walletStatusPillReady: {
    backgroundColor: colors.veryLightPurple,
    borderColor: colors.overlayLightPurple,
  },
  walletStatusPillProcessing: {
    backgroundColor: colors.lightOrange,
    borderColor: '#FFD4C7',
  },
  walletStatusPillSetup: {
    backgroundColor: colors.lightGrey,
    borderColor: colors.border,
  },
  walletStatusPillMinimum: {
    backgroundColor: colors.lightGrey,
    borderColor: colors.border,
  },
  walletStatusPillText: {
    ...typography.metaStrong,
  },
  walletStatusPillTextReady: {
    color: colors.secondary,
  },
  walletStatusPillTextProcessing: {
    color: colors.primary,
  },
  walletStatusPillTextSetup: {
    color: colors.textSecondary,
  },
  walletStatusPillTextMinimum: {
    color: colors.textSecondary,
  },
  walletMethodText: {
    flex: 1,
    ...typography.meta,
    color: colors.textSecondary,
  },
  walletActionButton: {
    backgroundColor: colors.primary,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  walletActionButtonDisabled: {
    backgroundColor: colors.lightGrey,
  },
  walletActionButtonText: {
    ...typography.buttonSecondary,
    color: colors.card,
  },
  walletActionButtonTextDisabled: {
    color: colors.textSecondary,
  },
  walletHistoryTitle: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  walletHistoryList: {
    gap: spacing.sm,
  },
  walletHistoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.lightGrey,
    borderRadius: layout.borderRadiusSmall,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  walletHistoryMeta: {
    flex: 1,
  },
  walletHistoryTitleText: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  walletHistorySubtitleText: {
    ...typography.metaStrong,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  walletHistoryDateText: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  walletHistoryAmount: {
    ...typography.bodyStrong,
  },
  walletHistoryAmountPositive: {
    color: colors.alternateGreen,
  },
  walletHistoryAmountPending: {
    color: colors.primary,
  },
  walletHistoryAmountNeutral: {
    color: colors.textPrimary,
  },
  emptyStateCard: {
    backgroundColor: colors.lightGrey,
    borderRadius: layout.borderRadiusSmall,
    padding: spacing.md,
  },
  emptyStateTitle: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
  },
});