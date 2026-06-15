import AsyncStorage from '@react-native-async-storage/async-storage';

import i18n from './i18n';
import { getSafeJobPriceNumber, Job } from './jobs';
import { ensureJobPaymentState } from './payments';
import { STORAGE_KEYS } from './storage-keys';
import { getActiveUserId } from './auth';

const WALLET_TRANSACTIONS_KEY = STORAGE_KEYS.WALLET_TRANSACTIONS;
const WALLET_PAYOUTS_KEY = STORAGE_KEYS.WALLET_PAYOUT_RECORDS;
const WALLET_SETTINGS_KEY = STORAGE_KEYS.WALLET_SETTINGS;
const DEFAULT_MINIMUM_PAYOUT_AMOUNT = 25;

export type WalletPayoutStatus = 'pending' | 'paid' | 'failed';
export type WalletPayoutState = 'ready' | 'minimum' | 'processing' | 'setup';
export type WalletEntryTone = 'positive' | 'pending' | 'neutral';
export type WalletTransactionType = 'earning' | 'payout';
export type WalletTransactionStatus = 'available' | WalletPayoutStatus;

export type WalletTransaction = {
  id: string;
  type: WalletTransactionType;
  amount: number;
  status: WalletTransactionStatus;
  createdAt: string;
  jobId?: string;
  jobTitle?: string;
};

type WalletSettings = {
  minimumPayoutAmount: number;
  hasPayoutMethod: boolean;
  payoutMethodLabel: string | null;
};

export type WalletHistoryEntry = {
  id: string;
  title: string;
  subtitle: string;
  statusLabel: string;
  occurredAt: string;
  amount: number;
  direction: 'credit' | 'debit';
  tone: WalletEntryTone;
};

export type WalletSnapshot = {
  availableBalance: number;
  pendingBalance: number;
  totalEarned: number;
  minimumPayoutAmount: number;
  hasPayoutMethod: boolean;
  payoutMethodLabel: string | null;
  payoutState: WalletPayoutState;
  entries: WalletHistoryEntry[];
};

type WalletPayoutRequestResult =
  | { ok: true; amount: number }
  | { ok: false; reason: WalletPayoutState };

type LegacyPayoutRecord = {
  id: string;
  amount: number;
  status: WalletPayoutStatus;
  createdAt: string;
};

const roundCurrency = (value: number): number => {
  return Math.round(value * 100) / 100;
};

const getDefaultWalletSettings = (): WalletSettings => {
  return {
    minimumPayoutAmount: DEFAULT_MINIMUM_PAYOUT_AMOUNT,
    hasPayoutMethod: true,
    payoutMethodLabel: i18n.t('wallet.default_payout_method'),
  };
};

const getFallbackTimestamp = (job: Pick<Job, 'id' | 'review'>): string => {
  if (job.review?.reviewedAt) {
    return job.review.reviewedAt;
  }

  const parsedId = Number(job.id);
  if (Number.isFinite(parsedId) && parsedId > 0) {
    return new Date(parsedId).toISOString();
  }

  return new Date(0).toISOString();
};

const getJobWalletEarningAmount = (job: Pick<Job, 'price'> & Partial<Pick<Job, 'payment'>>): number => {
  const payment = ensureJobPaymentState(job);
  const fromPayment = Number(payment.buddyEarnings);

  if (Number.isFinite(fromPayment) && fromPayment > 0) {
    return roundCurrency(fromPayment);
  }

  return roundCurrency(getSafeJobPriceNumber({ price: job.price }));
};

const sanitizeLegacyPayoutRecords = (value: unknown): LegacyPayoutRecord[] => {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];

    const candidate = item as Partial<LegacyPayoutRecord>;
    const amount = Number(candidate.amount);
    const status = candidate.status;
    const createdAt = String(candidate.createdAt || '');

    if (!candidate.id || !Number.isFinite(amount) || amount <= 0) return [];
    if (status !== 'pending' && status !== 'paid' && status !== 'failed') return [];
    if (Number.isNaN(new Date(createdAt).getTime())) return [];

    return [
      {
        id: String(candidate.id),
        amount: roundCurrency(amount),
        status,
        createdAt,
      },
    ];
  });
};

const sanitizeWalletSettings = (value: unknown): WalletSettings => {
  const defaults = getDefaultWalletSettings();
  if (!value || typeof value !== 'object') return defaults;

  const candidate = value as Partial<WalletSettings>;
  const minimumPayoutAmount = Number(candidate.minimumPayoutAmount);

  return {
    minimumPayoutAmount:
      Number.isFinite(minimumPayoutAmount) && minimumPayoutAmount > 0
        ? roundCurrency(minimumPayoutAmount)
        : defaults.minimumPayoutAmount,
    hasPayoutMethod:
      typeof candidate.hasPayoutMethod === 'boolean'
        ? candidate.hasPayoutMethod
        : defaults.hasPayoutMethod,
    payoutMethodLabel:
      typeof candidate.payoutMethodLabel === 'string' && candidate.payoutMethodLabel.trim().length > 0
        ? candidate.payoutMethodLabel.trim()
        : defaults.payoutMethodLabel,
  };
};

const sanitizeTransactions = (value: unknown): WalletTransaction[] => {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];

    const candidate = item as Partial<WalletTransaction>;
    const amount = Number(candidate.amount);
    const type = candidate.type;
    const status = candidate.status;
    const createdAt = String(candidate.createdAt || '');

    if (!candidate.id || !Number.isFinite(amount) || amount <= 0) return [];
    if (type !== 'earning' && type !== 'payout') return [];
    if (type === 'earning' && status !== 'available') return [];
    if (type === 'payout' && status !== 'pending' && status !== 'paid' && status !== 'failed') return [];
    if (Number.isNaN(new Date(createdAt).getTime())) return [];

    const normalizedStatus: WalletTransactionStatus =
      type === 'earning' ? 'available' : (status as WalletPayoutStatus);

    return [
      {
        id: String(candidate.id),
        type,
        amount: roundCurrency(amount),
        status: normalizedStatus,
        createdAt,
        jobId: candidate.jobId ? String(candidate.jobId) : undefined,
        jobTitle: typeof candidate.jobTitle === 'string' ? candidate.jobTitle.trim() : undefined,
      },
    ];
  });
};

const normalizeTransactions = (transactions: WalletTransaction[]): WalletTransaction[] => {
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const seenEarningJobIds = new Set<string>();
  const normalized: WalletTransaction[] = [];

  for (const transaction of sorted) {
    if (transaction.type === 'earning' && transaction.jobId) {
      if (seenEarningJobIds.has(transaction.jobId)) {
        continue;
      }
      seenEarningJobIds.add(transaction.jobId);
    }

    normalized.push(transaction);
  }

  return normalized;
};

const migrateLegacyPayouts = (
  transactions: WalletTransaction[],
  legacyPayouts: LegacyPayoutRecord[]
): { nextTransactions: WalletTransaction[]; changed: boolean } => {
  if (legacyPayouts.length === 0) {
    return { nextTransactions: transactions, changed: false };
  }

  const existingPayoutIds = new Set(
    transactions.filter((tx) => tx.type === 'payout').map((tx) => tx.id)
  );

  let changed = false;
  const migrated = [...transactions];

  for (const payout of legacyPayouts) {
    if (existingPayoutIds.has(payout.id)) continue;

    migrated.push({
      id: payout.id,
      type: 'payout',
      amount: payout.amount,
      status: payout.status,
      createdAt: payout.createdAt,
    });
    existingPayoutIds.add(payout.id);
    changed = true;
  }

  return {
    nextTransactions: migrated,
    changed,
  };
};

const ensureCompletedJobEarnings = (
  transactions: WalletTransaction[],
  completedJobs: Pick<Job, 'id' | 'problem' | 'price' | 'review'>[]
): { nextTransactions: WalletTransaction[]; changed: boolean } => {
  const existingEarningJobIds = new Set(
    transactions
      .filter((tx) => tx.type === 'earning' && tx.jobId)
      .map((tx) => String(tx.jobId))
  );

  let changed = false;
  const next = [...transactions];

  for (const job of completedJobs) {
    if (existingEarningJobIds.has(String(job.id))) {
      continue;
    }

    const amount = getJobWalletEarningAmount(job);
    if (amount <= 0) continue;

    next.push({
      id: `earning-${job.id}`,
      type: 'earning',
      amount,
      status: 'available',
      createdAt: getFallbackTimestamp(job),
      jobId: String(job.id),
      jobTitle: String(job.problem || '').trim(),
    });

    existingEarningJobIds.add(String(job.id));
    changed = true;
  }

  return {
    nextTransactions: next,
    changed,
  };
};

const loadTransactionsState = async (
  completedJobs: Pick<Job, 'id' | 'problem' | 'price' | 'review'>[]
): Promise<WalletTransaction[]> => {
  const [transactionsRaw, legacyPayoutsRaw] = await Promise.all([
    AsyncStorage.getItem(WALLET_TRANSACTIONS_KEY),
    AsyncStorage.getItem(WALLET_PAYOUTS_KEY),
  ]);

  const parsedTransactions = sanitizeTransactions(
    transactionsRaw ? JSON.parse(transactionsRaw) : []
  );
  const parsedLegacyPayouts = sanitizeLegacyPayoutRecords(
    legacyPayoutsRaw ? JSON.parse(legacyPayoutsRaw) : []
  );

  const migration = migrateLegacyPayouts(parsedTransactions, parsedLegacyPayouts);
  const withEarnings = ensureCompletedJobEarnings(migration.nextTransactions, completedJobs);
  const normalized = normalizeTransactions(withEarnings.nextTransactions);

  const wasChanged =
    migration.changed ||
    withEarnings.changed ||
    normalized.length !== parsedTransactions.length;

  if (wasChanged) {
    await AsyncStorage.setItem(WALLET_TRANSACTIONS_KEY, JSON.stringify(normalized));
  }

  return normalized;
};

const loadCompletedJobsFromStorage = async (): Promise<Job[]> => {
  const jobsRaw = await AsyncStorage.getItem(STORAGE_KEYS.JOBS);
  const parsedJobs = jobsRaw ? JSON.parse(jobsRaw) : [];
  const safeJobs: Job[] = Array.isArray(parsedJobs) ? parsedJobs : [];
  const activeUserId = getActiveUserId();

  return safeJobs.filter(
    (job) =>
      job.status === 'completed' &&
      job.match?.selectedApplicationId === activeUserId
  );
};

const getPayoutStatusLabel = (status: WalletPayoutStatus): string => {
  if (status === 'paid') return i18n.t('wallet.entry_payout_status_paid');
  if (status === 'failed') return i18n.t('wallet.entry_payout_status_failed');
  return i18n.t('wallet.entry_payout_status_pending');
};

const buildWalletEntries = (
  transactions: WalletTransaction[],
  payoutMethodLabel: string | null
): WalletHistoryEntry[] => {
  return [...transactions]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((transaction) => {
      if (transaction.type === 'earning') {
        return {
          id: transaction.id,
          title: i18n.t('wallet.entry_earning_title'),
          subtitle: String(transaction.jobTitle || i18n.t('wallet.entry_earning_title')),
          statusLabel: i18n.t('wallet.entry_earning_status'),
          occurredAt: transaction.createdAt,
          amount: transaction.amount,
          direction: 'credit' as const,
          tone: 'positive' as const,
        };
      }

      return {
        id: transaction.id,
        title: i18n.t('wallet.entry_payout_title'),
        subtitle: String(payoutMethodLabel ?? i18n.t('wallet.default_payout_method')),
        statusLabel: getPayoutStatusLabel(transaction.status as WalletPayoutStatus),
        occurredAt: transaction.createdAt,
        amount: transaction.amount,
        direction: 'debit' as const,
        tone:
          transaction.status === 'pending'
            ? ('pending' as const)
            : ('neutral' as const),
      };
    })
    .slice(0, 6);
};

const deriveSnapshot = (
  transactions: WalletTransaction[],
  settings: WalletSettings
): WalletSnapshot => {
  const totalEarned = roundCurrency(
    transactions.reduce((sum, transaction) => {
      if (transaction.type !== 'earning' || transaction.status !== 'available') {
        return sum;
      }
      return sum + transaction.amount;
    }, 0)
  );

  const deductedByPayouts = roundCurrency(
    transactions.reduce((sum, transaction) => {
      if (transaction.type !== 'payout') return sum;
      if (transaction.status === 'failed') return sum;
      return sum + transaction.amount;
    }, 0)
  );

  const pendingBalance = roundCurrency(
    transactions.reduce((sum, transaction) => {
      if (transaction.type !== 'payout' || transaction.status !== 'pending') {
        return sum;
      }
      return sum + transaction.amount;
    }, 0)
  );

  const availableBalance = roundCurrency(
    Math.max(0, totalEarned - deductedByPayouts)
  );

  let payoutState: WalletPayoutState = 'minimum';

  if (!settings.hasPayoutMethod) {
    payoutState = 'setup';
  } else if (pendingBalance > 0) {
    payoutState = 'processing';
  } else if (availableBalance >= settings.minimumPayoutAmount) {
    payoutState = 'ready';
  }

  return {
    availableBalance,
    pendingBalance,
    totalEarned,
    minimumPayoutAmount: settings.minimumPayoutAmount,
    hasPayoutMethod: settings.hasPayoutMethod,
    payoutMethodLabel: settings.payoutMethodLabel,
    payoutState,
    entries: buildWalletEntries(transactions, settings.payoutMethodLabel),
  };
};

export const createEmptyWalletSnapshot = (): WalletSnapshot => {
  const defaults = getDefaultWalletSettings();

  return {
    availableBalance: 0,
    pendingBalance: 0,
    totalEarned: 0,
    minimumPayoutAmount: defaults.minimumPayoutAmount,
    hasPayoutMethod: defaults.hasPayoutMethod,
    payoutMethodLabel: defaults.payoutMethodLabel,
    payoutState: 'minimum',
    entries: [],
  };
};

export const recordJobCompletionEarning = async (
  job: Pick<Job, 'id' | 'problem' | 'price' | 'review'> & Partial<Pick<Job, 'payment'>>
): Promise<void> => {
  const amount = getJobWalletEarningAmount(job);
  if (amount <= 0) return;

  const transactions = await loadTransactionsState([]);
  const hasEntry = transactions.some(
    (transaction) => transaction.type === 'earning' && transaction.jobId === String(job.id)
  );

  if (hasEntry) return;

  const nextTransactions = normalizeTransactions([
    ...transactions,
    {
      id: `earning-${job.id}`,
      type: 'earning',
      amount,
      status: 'available',
      createdAt: getFallbackTimestamp(job),
      jobId: String(job.id),
      jobTitle: String(job.problem || '').trim(),
    },
  ]);

  await AsyncStorage.setItem(WALLET_TRANSACTIONS_KEY, JSON.stringify(nextTransactions));
};

export const loadWalletSnapshot = async (completedJobs: Job[]): Promise<WalletSnapshot> => {
  const [settingsRaw, transactions] = await Promise.all([
    AsyncStorage.getItem(WALLET_SETTINGS_KEY),
    loadTransactionsState(completedJobs),
  ]);

  const settings = sanitizeWalletSettings(settingsRaw ? JSON.parse(settingsRaw) : null);

  return deriveSnapshot(transactions, settings);
};

export const loadWalletSnapshotFromStorage = async (): Promise<WalletSnapshot> => {
  const completedJobs = await loadCompletedJobsFromStorage();
  return loadWalletSnapshot(completedJobs);
};

export const requestWalletPayout = async (
  completedJobs: Job[]
): Promise<WalletPayoutRequestResult> => {
  const [settingsRaw, transactions] = await Promise.all([
    AsyncStorage.getItem(WALLET_SETTINGS_KEY),
    loadTransactionsState(completedJobs),
  ]);

  const settings = sanitizeWalletSettings(settingsRaw ? JSON.parse(settingsRaw) : null);
  const snapshot = deriveSnapshot(transactions, settings);

  if (snapshot.payoutState !== 'ready') {
    return { ok: false, reason: snapshot.payoutState };
  }

  const amount = roundCurrency(snapshot.availableBalance);

  const nextTransactions = normalizeTransactions([
    ...transactions,
    {
      id: Date.now().toString(),
      type: 'payout',
      amount,
      status: 'pending',
      createdAt: new Date().toISOString(),
    },
  ]);

  await AsyncStorage.setItem(
    WALLET_TRANSACTIONS_KEY,
    JSON.stringify(nextTransactions)
  );

  return { ok: true, amount };
};

export const requestWalletPayoutFromStorage = async (): Promise<WalletPayoutRequestResult> => {
  const completedJobs = await loadCompletedJobsFromStorage();
  return requestWalletPayout(completedJobs);
};
