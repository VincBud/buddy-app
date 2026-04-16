export const PLATFORM_FEE_RATE = 0.15;
export const PLATFORM_FEE_MIN = 1;
export const PLATFORM_FEE_MAX = 10;
export const MIN_JOB_BASE_PRICE = 10;

export type PriceBreakdown = {
  basePrice: number;
  platformFee: number;
  totalPrice: number;
};

export type PriceValidationResult = {
  parsedPrice: number | null;
  isValid: boolean;
  isBelowMinimum: boolean;
};

const roundCurrency = (value: number): number => {
  return Math.round(value * 100) / 100;
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
  minimum: number = MIN_JOB_BASE_PRICE
): PriceValidationResult => {
  const parsedPrice = parsePriceInput(input);

  if (parsedPrice === null) {
    return {
      parsedPrice: null,
      isValid: false,
      isBelowMinimum: false,
    };
  }

  const isBelowMinimum = parsedPrice < minimum;

  return {
    parsedPrice,
    isValid: !isBelowMinimum,
    isBelowMinimum,
  };
};

export const calculatePlatformFee = (basePrice: number): number => {
  if (!Number.isFinite(basePrice) || basePrice < 0) {
    return 0;
  }

  const fee = basePrice * PLATFORM_FEE_RATE;
  const clamped = Math.min(PLATFORM_FEE_MAX, Math.max(PLATFORM_FEE_MIN, fee));
  return roundCurrency(clamped);
};

export const calculatePriceBreakdown = (basePrice: number): PriceBreakdown => {
  const safeBase = roundCurrency(Math.max(0, basePrice));
  const platformFee = calculatePlatformFee(safeBase);
  const totalPrice = roundCurrency(safeBase + platformFee);

  return {
    basePrice: safeBase,
    platformFee,
    totalPrice,
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
