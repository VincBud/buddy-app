import {
    calculatePriceBreakdown,
    formatPriceAmount,
    parsePriceInput,
    PriceBreakdown,
} from './pricing';

/**
 * Payment lifecycle for a single job escrow.
 *
 * none                 — initial; no payment action started yet
 * pending_authorization — owner accepted a buddy; payment authorization requested
 * reserved             — funds secured/escrowed; buddy payout guaranteed on completion
 * release_pending      — job completed; payout queued for release to buddy
 * paid                 — payout released to buddy; platform fee settled
 * cancelled            — payment voided; refund issued if funds were reserved
 */
export type PaymentStatus =
  | 'none'
  | 'pending_authorization'
  | 'reserved'
  | 'release_pending'
  | 'paid'
  | 'cancelled';

/**
 * Buddy payout lifecycle, tracked in parallel with PaymentStatus.
 *
 * not_ready — initial; payout not yet committed
 * reserved  — earnings secured in escrow (job matched)
 * pending   — release triggered; processing
 * paid      — payout sent to buddy
 * cancelled — payout voided (job cancelled/dispute)
 */
export type PayoutStatus =
  | 'not_ready'
  | 'reserved'
  | 'pending'
  | 'paid'
  | 'cancelled';

/**
 * Refund state for the requester when a job is cancelled after payment.
 *
 * none      — no refund needed
 * pending   — refund initiated; awaiting confirmation
 * processed — refund settled
 */
export type RefundStatus = 'none' | 'pending' | 'processed';

export type PaymentActorRole = 'auftraggeber' | 'buddy' | 'platform';

export type JobPaymentState = {
  currency: 'EUR';
  requesterPays: number;
  buddyEarnings: number;
  platformKeeps: number;
  paymentStatus: PaymentStatus;
  payoutStatus: PayoutStatus;
  refundStatus: RefundStatus;
  payerRole: 'auftraggeber';
  payeeRole: 'buddy';
  updatedAt: string;
  reservedAt?: string;
  authorizedAt?: string;
  paidAt?: string;
  releasedAt?: string;
  refundedAt?: string;
  failedAt?: string;
};

type PaymentJobStatus =
  | 'open'
  | 'paused'
  | 'matched'
  | 'active'
  | 'issue_reported'
  | 'completed'
  | 'cancelled'
  | 'expired';

type JobPricingShape = {
  price?: unknown;
  basePrice?: unknown;
  platformFee?: unknown;
  totalPrice?: unknown;
  payment?: Partial<JobPaymentState>;
};

const roundCurrency = (value: number): number => {
  return Math.round(value * 100) / 100;
};

const toPositiveNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return roundCurrency(value);
  }

  const parsed = parsePriceInput(value);
  if (parsed === null) return null;

  return roundCurrency(parsed);
};

const getBreakdownFromJob = (job: JobPricingShape): PriceBreakdown => {
  const fallbackBasePrice = toPositiveNumber(job.price) ?? 0;
  const fallback = calculatePriceBreakdown(fallbackBasePrice);

  const basePrice = toPositiveNumber(job.basePrice) ?? fallback.basePrice;
  const platformFee = toPositiveNumber(job.platformFee) ?? fallback.platformFee;
  const totalPrice = toPositiveNumber(job.totalPrice) ?? roundCurrency(basePrice + platformFee);

  return {
    basePrice,
    platformFee,
    totalPrice,
  };
};

const nowIso = (): string => new Date().toISOString();

export const createInitialPaymentState = (breakdown: PriceBreakdown): JobPaymentState => {
  const now = nowIso();
  return {
    currency: 'EUR',
    requesterPays: breakdown.totalPrice,
    buddyEarnings: breakdown.basePrice,
    platformKeeps: breakdown.platformFee,
    paymentStatus: 'none',
    payoutStatus: 'not_ready',
    refundStatus: 'none',
    payerRole: 'auftraggeber',
    payeeRole: 'buddy',
    updatedAt: now,
  };
};

export const ensureJobPaymentState = (job: JobPricingShape): JobPaymentState => {
  const breakdown = getBreakdownFromJob(job);
  const baseState = createInitialPaymentState(breakdown);

  const existing = job.payment;
  if (!existing) {
    return baseState;
  }

  return {
    ...baseState,
    ...existing,
    requesterPays: toPositiveNumber(existing.requesterPays) ?? baseState.requesterPays,
    buddyEarnings: toPositiveNumber(existing.buddyEarnings) ?? baseState.buddyEarnings,
    platformKeeps: toPositiveNumber(existing.platformKeeps) ?? baseState.platformKeeps,
    paymentStatus:
      existing.paymentStatus ?? baseState.paymentStatus,
    payoutStatus:
      existing.payoutStatus ?? baseState.payoutStatus,
    refundStatus:
      existing.refundStatus ?? baseState.refundStatus,
    updatedAt:
      typeof existing.updatedAt === 'string' && existing.updatedAt.trim().length > 0
        ? existing.updatedAt
        : baseState.updatedAt,
  };
};

export const applyPaymentStateForJobStatus = (
  payment: JobPaymentState,
  nextStatus: PaymentJobStatus
): JobPaymentState => {
  const now = nowIso();

  // Job re-opened — no buddy matched yet, reset payment to initial state
  if (nextStatus === 'open') {
    return {
      ...payment,
      paymentStatus: 'none',
      payoutStatus: 'not_ready',
      updatedAt: now,
    };
  }

  // Job paused — preserve existing payment/payout reservation so buddy earnings are not lost
  if (nextStatus === 'paused') {
    return { ...payment, updatedAt: now };
  }

  // Owner accepted one buddy → request authorization; buddy earnings are reserved
  if (nextStatus === 'matched') {
    return {
      ...payment,
      paymentStatus:
        payment.paymentStatus === 'none' ? 'pending_authorization' : payment.paymentStatus,
      payoutStatus:
        payment.payoutStatus === 'not_ready' ? 'reserved' : payment.payoutStatus,
      updatedAt: now,
    };
  }

  // Payment confirmed → funds secured in escrow; job execution begins
  if (nextStatus === 'active') {
    const alreadyReserved =
      payment.paymentStatus === 'reserved' ||
      payment.paymentStatus === 'release_pending';

    return {
      ...payment,
      paymentStatus: alreadyReserved ? payment.paymentStatus : 'reserved',
      payoutStatus: payment.payoutStatus === 'not_ready' ? 'reserved' : payment.payoutStatus,
      reservedAt: payment.reservedAt ?? now,
      authorizedAt: payment.authorizedAt ?? now,
      updatedAt: now,
    };
  }

  // Issue reported — freeze payment in current state; do not advance toward payout or refund.
  // Resolution (payout, refund, or cancellation) happens after support review.
  if (nextStatus === 'issue_reported') {
    return { ...payment, updatedAt: now };
  }

  // Job completed → payout queued; backend releases funds after confirmation
  if (nextStatus === 'completed') {
    return {
      ...payment,
      paymentStatus: 'release_pending',
      payoutStatus: 'pending',
      refundStatus: 'none',
      updatedAt: now,
    };
  }

  // Cancellation — void payment; trigger refund only if funds were already reserved
  if (nextStatus === 'cancelled' || nextStatus === 'expired') {
    const needsRefund =
      payment.paymentStatus === 'pending_authorization' ||
      payment.paymentStatus === 'reserved';

    return {
      ...payment,
      paymentStatus: 'cancelled',
      payoutStatus: 'cancelled',
      refundStatus: needsRefund ? 'pending' : 'none',
      updatedAt: now,
    };
  }

  return { ...payment, updatedAt: now };
};

export const getJobPaymentBreakdown = (job: JobPricingShape): PriceBreakdown => {
  return getBreakdownFromJob(job);
};

export const formatPriceLine = (value: number): string => `${formatPriceAmount(value)} €`;

/**
 * Returns true when payment has been authorized or confirmed reserved.
 * Use this to gate full job activation.
 */
export const isPaymentReadyForActivation = (payment: JobPaymentState): boolean => {
  return (
    payment.paymentStatus === 'pending_authorization' ||
    payment.paymentStatus === 'reserved'
  );
};

/**
 * Marks a locally confirmed payment reservation (mock for pre-backend flow).
 * In a real backend, this step is triggered by the payment provider webhook.
 */
export const confirmPaymentReservation = (payment: JobPaymentState): JobPaymentState => {
  if (payment.paymentStatus !== 'pending_authorization') return payment;

  return {
    ...payment,
    paymentStatus: 'reserved',
    reservedAt: payment.reservedAt ?? nowIso(),
    authorizedAt: payment.authorizedAt ?? nowIso(),
    updatedAt: nowIso(),
  };
};

/**
 * Releases escrowed payment to buddy after job completion.
 * In production this is triggered by a server-side webhook after confirmation.
 * Only valid from release_pending state.
 */
export const releasePaymentToBuddy = (payment: JobPaymentState): JobPaymentState => {
  if (payment.paymentStatus !== 'release_pending') return payment;

  const now = nowIso();
  return {
    ...payment,
    paymentStatus: 'paid',
    payoutStatus: 'paid',
    paidAt: payment.paidAt ?? now,
    updatedAt: now,
  };
};
