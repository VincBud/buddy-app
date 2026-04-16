import {
    calculatePriceBreakdown,
    formatPriceAmount,
    parsePriceInput,
    PriceBreakdown,
} from './pricing';

export type PaymentStatus =
  | 'unpaid'
  | 'pending'
  | 'pending_authorization'
  | 'reserved'
  | 'paid'
  | 'release_pending'
  | 'released'
  | 'refunded'
  | 'partially_refunded'
  | 'failed'
  | 'cancelled';

export type PayoutStatus =
  | 'not_ready'
  | 'on_hold'
  | 'pending'
  | 'scheduled'
  | 'paid'
  | 'failed';

export type RefundStatus = 'none' | 'pending' | 'partial' | 'full' | 'failed';

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
  | 'matched'
  | 'active'
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
    paymentStatus: 'unpaid',
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

  if (nextStatus === 'open') {
    return {
      ...payment,
      paymentStatus: 'unpaid',
      payoutStatus: 'not_ready',
      updatedAt: now,
    };
  }

  // Requester confirms match → request authorization (not yet reserved)
  if (nextStatus === 'matched') {
    return {
      ...payment,
      paymentStatus:
        payment.paymentStatus === 'unpaid' ? 'pending_authorization' : payment.paymentStatus,
      payoutStatus:
        payment.payoutStatus === 'not_ready' ? 'scheduled' : payment.payoutStatus,
      updatedAt: now,
    };
  }

  // Authorization confirmed → payment reserved, job becomes active
  if (nextStatus === 'active') {
    const isAlreadyReserved =
      payment.paymentStatus === 'reserved' ||
      payment.paymentStatus === 'paid' ||
      payment.paymentStatus === 'release_pending' ||
      payment.paymentStatus === 'released';

    return {
      ...payment,
      paymentStatus: isAlreadyReserved ? payment.paymentStatus : 'reserved',
      payoutStatus:
        payment.payoutStatus === 'not_ready' ? 'scheduled' : payment.payoutStatus,
      reservedAt: payment.reservedAt ?? now,
      authorizedAt: payment.authorizedAt ?? now,
      updatedAt: now,
    };
  }

  if (nextStatus === 'completed') {
    return {
      ...payment,
      paymentStatus: 'release_pending',
      payoutStatus: 'pending',
      refundStatus: 'none',
      releasedAt: now,
      updatedAt: now,
    };
  }

  if (nextStatus === 'cancelled') {
    const needsRefund =
      payment.paymentStatus === 'pending_authorization' ||
      payment.paymentStatus === 'reserved' ||
      payment.paymentStatus === 'paid' ||
      payment.paymentStatus === 'release_pending' ||
      payment.paymentStatus === 'released' ||
      payment.paymentStatus === 'pending';

    return {
      ...payment,
      paymentStatus: 'cancelled',
      payoutStatus: 'not_ready',
      refundStatus: needsRefund ? 'pending' : 'none',
      updatedAt: now,
    };
  }

  return {
    ...payment,
    updatedAt: now,
  };
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
    payment.paymentStatus === 'reserved' ||
    payment.paymentStatus === 'paid'
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
