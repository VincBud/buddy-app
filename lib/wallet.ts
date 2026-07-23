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
  // Backend-ready pricing metadata for 'earning' transactions — informational
  // only, never used in balance math (`amount` already equals jobAmountCents/100,
  // the Buddy's full job earning). Lets a future backend/analytics layer see the
  // service fee the Auftraggeber paid for this job without ever crediting that
  // fee to the Buddy or treating it as platform wallet balance.
  jobAmountCents?: number;
  serviceFeeCents?: number;
  totalAmountCents?: number;
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

// Minimum plausible transaction time. Anything before this — including the Unix
// epoch produced by the old `Number(uuid)` → NaN → `new Date(0)` bug — is treated
// as missing so it can never render as "1. Januar 1970".
export const MIN_VALID_TIMESTAMP_MS = Date.UTC(2015, 0, 1);

export const isValidWalletTimestamp = (value: string | null | undefined): boolean => {
  if (!value) return false;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) && ms >= MIN_VALID_TIMESTAMP_MS;
};

// Fields that can carry a reliable creation time for a job's earning.
type TimestampSource = Pick<Job, 'id'> &
  Partial<Pick<Job, 'review' | 'completionConfirmation' | 'updatedAt' | 'createdAt'>>;

// Derive a genuine historical timestamp from the job, or null if none exists.
// Priority: review time → completion-confirmation times → job updated/created →
// a legacy numeric (ms) job id. UUID ids are non-numeric and correctly skipped
// (that path was the source of the 1970 bug). Never returns the current time.
const deriveReliableTimestamp = (job: TimestampSource): string | null => {
  const candidates = [
    job.review?.reviewedAt,
    job.completionConfirmation?.buddyConfirmedAt,
    job.completionConfirmation?.ownerConfirmedAt,
    job.updatedAt,
    job.createdAt,
  ];
  for (const candidate of candidates) {
    if (isValidWalletTimestamp(candidate)) return candidate as string;
  }

  const parsedId = Number(job.id);
  if (Number.isFinite(parsedId) && parsedId >= MIN_VALID_TIMESTAMP_MS) {
    return new Date(parsedId).toISOString();
  }

  return null;
};

// For a NEW earning being recorded now, a reliable historical time is preferred;
// only as a genuine last resort do we stamp the current time. We never fall back
// to epoch 0.
const getFallbackTimestamp = (job: TimestampSource): string => {
  return deriveReliableTimestamp(job) ?? new Date().toISOString();
};

// The payout recipient is the job's ASSIGNED HELPER, derived from the job record:
// assignedBuddyId is the authoritative cross-device signal (set server-side by
// review_job_application); selectedApplicationId is the local mirror. It is never
// the user who pressed "complete" and never the owner. Because only the assigned
// helper's own device records the positive earning, the owner can never be
// credited — regardless of which screen triggered completion.
const isCurrentUserAssignedHelper = (
  job: Partial<Pick<Job, 'assignedBuddyId' | 'match'>>,
): boolean => {
  const assignedHelperId = job.assignedBuddyId ?? job.match?.selectedApplicationId;
  return !!assignedHelperId && assignedHelperId === getActiveUserId();
};

const getJobWalletEarningAmount = (job: Pick<Job, 'price'> & Partial<Pick<Job, 'payment'>>): number => {
  const payment = ensureJobPaymentState(job);
  const fromPayment = Number(payment.buddyEarnings);

  if (Number.isFinite(fromPayment) && fromPayment > 0) {
    return roundCurrency(fromPayment);
  }

  return roundCurrency(getSafeJobPriceNumber({ price: job.price }));
};

// Euro-cent pricing metadata for an earning transaction, reusing the job's
// already-computed payment breakdown (lib/payments.ts, itself backed by the
// single canonical lib/pricing.ts formula) — no second fee calculation here.
const getEarningPricingMetadata = (
  job: Pick<Job, 'price'> & Partial<Pick<Job, 'payment'>>,
): { jobAmountCents: number; serviceFeeCents: number; totalAmountCents: number } => {
  const payment = ensureJobPaymentState(job);
  return {
    jobAmountCents: Math.round(payment.buddyEarnings * 100),
    serviceFeeCents: Math.round(payment.platformKeeps * 100),
    totalAmountCents: Math.round(payment.requesterPays * 100),
  };
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

    // Optional pricing metadata — informational only (never fed into balance
    // math), so a missing/invalid value here just means older stored entries
    // predate this field; it never invalidates the transaction itself.
    const safeCents = (value: unknown): number | undefined =>
      typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
        ? value
        : undefined;

    return [
      {
        id: String(candidate.id),
        type,
        amount: roundCurrency(amount),
        status: normalizedStatus,
        createdAt,
        jobId: candidate.jobId ? String(candidate.jobId) : undefined,
        jobTitle: typeof candidate.jobTitle === 'string' ? candidate.jobTitle.trim() : undefined,
        jobAmountCents: safeCents(candidate.jobAmountCents),
        serviceFeeCents: safeCents(candidate.serviceFeeCents),
        totalAmountCents: safeCents(candidate.totalAmountCents),
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

type CompletedJobForEarning = Pick<Job, 'id' | 'problem' | 'price'> &
  Partial<Pick<Job, 'review' | 'completionConfirmation' | 'updatedAt' | 'createdAt' | 'assignedBuddyId' | 'match' | 'payment'>>;

// Backfill earnings for the current user's completed jobs. Only jobs where the
// current user is the assigned helper are credited — the owner is never credited
// even if their completed jobs are passed in.
const ensureCompletedJobEarnings = (
  transactions: WalletTransaction[],
  completedJobs: CompletedJobForEarning[]
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

    // Authoritative payout gate: only the assigned helper is ever credited.
    if (!isCurrentUserAssignedHelper(job)) {
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
      ...getEarningPricingMetadata(job),
    });

    existingEarningJobIds.add(String(job.id));
    changed = true;
  }

  return {
    nextTransactions: next,
    changed,
  };
};

// Repair earnings whose stored createdAt is invalid/epoch-0 (from the old 1970
// bug) by re-deriving a genuine historical time from the matching completed job.
// Only upgrades when a reliable timestamp exists — it never stamps "now" and
// never touches already-valid dates, so legitimate history is preserved.
const repairEarningTimestamps = (
  transactions: WalletTransaction[],
  completedJobs: CompletedJobForEarning[]
): { nextTransactions: WalletTransaction[]; changed: boolean } => {
  if (transactions.length === 0) return { nextTransactions: transactions, changed: false };

  const jobById = new Map(completedJobs.map((job) => [String(job.id), job]));
  let changed = false;

  const next = transactions.map((tx) => {
    if (tx.type !== 'earning' || isValidWalletTimestamp(tx.createdAt)) return tx;
    const job = tx.jobId ? jobById.get(String(tx.jobId)) : undefined;
    const derived = job ? deriveReliableTimestamp(job) : null;
    if (derived) {
      console.warn(`[wallet] repairing invalid earning date: id=${tx.id} old="${tx.createdAt}" new="${derived}"`);
      changed = true;
      return { ...tx, createdAt: derived };
    }
    return tx;
  });

  return { nextTransactions: next, changed };
};

const loadTransactionsState = async (
  completedJobs: CompletedJobForEarning[]
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
  const repaired = repairEarningTimestamps(withEarnings.nextTransactions, completedJobs);
  const normalized = normalizeTransactions(repaired.nextTransactions);

  const wasChanged =
    migration.changed ||
    withEarnings.changed ||
    repaired.changed ||
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
  job: CompletedJobForEarning
): Promise<void> => {
  // Single authoritative payout gate: the positive earning is recorded ONLY on
  // the assigned helper's device, with the recipient derived from the job record
  // (never from who pressed "complete", never the owner). This is what prevents
  // the double-credit — the owner's device records nothing here.
  if (!isCurrentUserAssignedHelper(job)) {
    return;
  }

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
      ...getEarningPricingMetadata(job),
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
