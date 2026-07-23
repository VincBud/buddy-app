// ─── Canonical pricing domain (integer cents) ──────────────────────────────────
//
// This is the single source of truth for the Buddy service-fee model:
//
//   The Auftraggeber (job creator) pays the agreed job amount PLUS a Buddy
//   service fee. The Buddy receives the full agreed job amount — never reduced
//   by the fee. The fee is 10% of the job amount, minimum 2.99 EUR, no maximum.
//   The fee applies only to the job amount itself — never to expenses,
//   reimbursed purchases, materials, or tips (Buddy does not yet model those;
//   do not add them here).
//
// All money math happens in integer cents to avoid floating-point drift
// (0.1 + 0.2 !== 0.3). Nothing in this module — or any caller — should do
// currency arithmetic in floating-point euros.
//
// BACKEND BOUNDARY: this is a client-side PREVIEW calculation. The backend is
// intended to eventually be the authoritative source for the final job amount,
// service fee, total charge, payout amount, refunds, and accounting status —
// this module must stay pure/deterministic (no I/O) so a server implementation
// can mirror it exactly, and so the client calculation can later be replaced by
// a server-validated response without changing any call site's shape.

export const BUDDY_SERVICE_FEE_RATE = 0.1;
export const BUDDY_MINIMUM_SERVICE_FEE_CENTS = 299;

export type JobPricingInput = {
  jobAmountCents: number;
};

export type JobPricingBreakdown = {
  jobAmountCents: number;
  serviceFeeCents: number;
  totalAmountCents: number;
  // buddyEarningsCents is always equal to jobAmountCents — the Buddy is never
  // shown or paid an amount reduced by the service fee. Kept as a distinct
  // field (rather than reusing jobAmountCents) so call sites can express
  // "what the Buddy receives" and "what was agreed" as separate concepts, which
  // matters once refunds/cancellation fees are introduced later.
  buddyEarningsCents: number;
  // Renamed alias for platformRevenueCents = serviceFeeCents: the fee IS the
  // platform's revenue for this job today. Kept distinct (not just reused as
  // serviceFeeCents) so a future tax/accounting layer can diverge the two
  // (e.g. netServiceFeeCents after VAT) without touching the fee shown to users.
  platformRevenueCents: number;
  serviceFeeRate: number;
  minimumServiceFeeCents: number;
  currency: 'EUR';
};

/**
 * Raised by calculateJobPricing when the input cannot represent a real amount
 * of money. This is a programming/data-integrity error, not a normal user
 * input state — UI call sites should validate/guard user input BEFORE calling
 * this (see tryCalculateJobPricing) and show a stable fallback instead of
 * letting this throw during render.
 */
export class InvalidJobPricingInputError extends Error {
  constructor(jobAmountCents: unknown) {
    super(
      `calculateJobPricing: invalid jobAmountCents (${String(jobAmountCents)}). ` +
      'Must be a finite, non-negative integer number of cents.'
    );
    this.name = 'InvalidJobPricingInputError';
  }
}

/**
 * Computes the full price breakdown for a job amount, in integer cents.
 *
 * serviceFeeCents = max(BUDDY_MINIMUM_SERVICE_FEE_CENTS, round(jobAmountCents * BUDDY_SERVICE_FEE_RATE))
 * totalAmountCents = jobAmountCents + serviceFeeCents
 * buddyEarningsCents = jobAmountCents
 * platformRevenueCents = serviceFeeCents
 *
 * Throws InvalidJobPricingInputError for NaN, Infinity, negative values, or
 * fractional cents — this function never silently coerces invalid data into a
 * price. Use tryCalculateJobPricing at UI boundaries where a thrown error is
 * inconvenient.
 */
export function calculateJobPricing(input: JobPricingInput): JobPricingBreakdown {
  const jobAmountCents = input?.jobAmountCents;

  if (
    typeof jobAmountCents !== 'number' ||
    !Number.isFinite(jobAmountCents) ||
    !Number.isInteger(jobAmountCents) ||
    jobAmountCents < 0
  ) {
    throw new InvalidJobPricingInputError(jobAmountCents);
  }

  const serviceFeeCents = Math.max(
    BUDDY_MINIMUM_SERVICE_FEE_CENTS,
    Math.round(jobAmountCents * BUDDY_SERVICE_FEE_RATE),
  );

  const totalAmountCents = jobAmountCents + serviceFeeCents;

  return {
    jobAmountCents,
    serviceFeeCents,
    totalAmountCents,
    buddyEarningsCents: jobAmountCents,
    platformRevenueCents: serviceFeeCents,
    serviceFeeRate: BUDDY_SERVICE_FEE_RATE,
    minimumServiceFeeCents: BUDDY_MINIMUM_SERVICE_FEE_CENTS,
    currency: 'EUR',
  };
}

export type JobPricingResult =
  | { ok: true; breakdown: JobPricingBreakdown }
  | { ok: false; reason: 'invalid_amount' };

/**
 * Non-throwing wrapper around calculateJobPricing for UI call sites. Never
 * throws — callers use `ok` to decide whether to render the breakdown or a
 * stable "amount unavailable" fallback, and must not let a payment/job
 * confirmation proceed on `ok: false`.
 */
export function tryCalculateJobPricing(input: JobPricingInput): JobPricingResult {
  try {
    return { ok: true, breakdown: calculateJobPricing(input) };
  } catch {
    return { ok: false, reason: 'invalid_amount' };
  }
}

const EURO_LOCALE_BY_LANGUAGE = { de: 'de-DE', en: 'en-US' } as const;
type FormatLanguage = keyof typeof EURO_LOCALE_BY_LANGUAGE;

/**
 * Formats an integer cent amount as a localized EUR string (German locale by
 * default, matching Buddy's German-first product). Never renders "NaN €" or
 * "undefined €" — non-finite input returns a neutral placeholder instead, so a
 * missing/invalid amount can never be mistaken for a real (possibly zero)
 * price.
 */
export function formatEuroFromCents(cents: number, language: FormatLanguage = 'de'): string {
  if (!Number.isFinite(cents)) {
    return '–';
  }

  const amount = cents / 100;

  try {
    return new Intl.NumberFormat(EURO_LOCALE_BY_LANGUAGE[language], {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Defensive fallback only — Intl.NumberFormat with a currency style is
    // already proven to work in this app's Hermes runtime (see app/wallet.tsx).
    const sign = amount < 0 ? '-' : '';
    return `${sign}${Math.abs(amount).toFixed(2).replace('.', ',')} €`;
  }
}

// ─── Legacy euro-float API ──────────────────────────────────────────────────
//
// The existing Job/JobPaymentState model (lib/jobs.ts, lib/payments.ts,
// app/(tabs)/create.tsx) stores prices as euro floats (job.price, job.basePrice,
// job.platformFee, job.totalPrice, payment.buddyEarnings, ...). Rewriting that
// storage model to integer cents is out of scope here. Instead this euro-facing
// API is now a thin wrapper around calculateJobPricing — the ONLY place the fee
// formula is implemented — so every existing call site (job creation, payment
// cards, wallet earnings) automatically gets the correct 10%/2.99 model with no
// duplicated logic and no per-screen changes to the calculation itself.
//
// Unlike calculateJobPricing, this wrapper never throws (existing callers do
// not expect exceptions from it): invalid/negative input is treated as 0,
// matching its previous (pre-fix) clamping behavior.

export const MIN_JOB_BASE_PRICE = 10;
export const MAX_JOB_BASE_PRICE = 500;

export type PriceBreakdown = {
  basePrice: number;
  platformFee: number;
  totalPrice: number;
};

export type PriceValidationResult = {
  parsedPrice: number | null;
  isValid: boolean;
  isBelowMinimum: boolean;
  isAboveMaximum: boolean;
};

const roundCurrency = (value: number): number => {
  return Math.round(value * 100) / 100;
};

const euroToCents = (euros: number): number => {
  // Guard NaN/Infinity explicitly — Math.max(0, NaN) is NaN, not 0, so a
  // non-finite input would otherwise propagate straight into calculateJobPricing
  // and throw, breaking this wrapper's "never throws, clamps instead" contract.
  const safeEuros = Number.isFinite(euros) ? euros : 0;
  return Math.round(roundCurrency(Math.max(0, safeEuros)) * 100);
};

const normalizeNumericString = (raw: string): string => {
  const cleaned = raw
    .trim()
    .replace(/\s+/g, '')
    .replace(/[€$£¥₣₤]/g, '')
    .replace(/[^0-9,.-]/g, '');

  if (!cleaned) return '';

  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');

  if (hasComma && hasDot) {
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      return cleaned.replace(/\./g, '').replace(',', '.');
    }
    return cleaned.replace(/,/g, '');
  }

  if (hasComma) {
    const lastCommaIndex = cleaned.lastIndexOf(',');
    const normalized = cleaned.replace(/,/g, (match, offset) => {
      return offset === lastCommaIndex ? '.' : '';
    });
    return normalized;
  }

  if (hasDot) {
    const lastDotIndex = cleaned.lastIndexOf('.');
    const normalized = cleaned.replace(/\./g, (match, offset) => {
      return offset === lastDotIndex ? '.' : '';
    });
    return normalized;
  }

  return cleaned;
};

export const parsePriceInput = (input: unknown): number | null => {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) return null;
    return roundCurrency(input);
  }

  if (typeof input !== 'string') {
    return null;
  }

  const normalized = normalizeNumericString(input);
  if (!normalized) return null;

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;

  return roundCurrency(parsed);
};

export const validateJobBasePrice = (
  input: unknown,
  minimum: number = MIN_JOB_BASE_PRICE,
  maximum: number = MAX_JOB_BASE_PRICE
): PriceValidationResult => {
  const parsedPrice = parsePriceInput(input);

  if (parsedPrice === null) {
    return {
      parsedPrice: null,
      isValid: false,
      isBelowMinimum: false,
      isAboveMaximum: false,
    };
  }

  const isBelowMinimum = parsedPrice < minimum;
  const isAboveMaximum = parsedPrice > maximum;

  return {
    parsedPrice,
    isValid: !isBelowMinimum && !isAboveMaximum,
    isBelowMinimum,
    isAboveMaximum,
  };
};

/** @deprecated Fee is no longer flat — use calculateJobPricing/calculatePriceBreakdown. Kept only so this euro-float wrapper has a single internal call path. */
export const calculatePlatformFee = (basePrice: number): number => {
  return calculatePriceBreakdown(basePrice).platformFee;
};

export const calculatePriceBreakdown = (basePrice: number): PriceBreakdown => {
  const jobAmountCents = euroToCents(basePrice);
  const breakdown = calculateJobPricing({ jobAmountCents });

  return {
    basePrice: breakdown.jobAmountCents / 100,
    platformFee: breakdown.serviceFeeCents / 100,
    totalPrice: breakdown.totalAmountCents / 100,
  };
};

export const formatPriceAmount = (value: number): string => {
  return roundCurrency(value).toFixed(2);
};

export const toStoredPriceValue = (value: number): string => {
  const rounded = roundCurrency(value);
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }
  return rounded.toFixed(2);
};
