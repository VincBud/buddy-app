// Tests for the centralized pricing domain (lib/pricing.ts).
//
// Run with: npm test (node --test lib/pricing.test.ts)
// Uses Node's built-in test runner + assert — no new dependency was introduced
// for this. Node's native TypeScript support (unflagged since Node 23.6) can
// execute this file directly; relative imports use an explicit `.ts` extension
// because Node's ESM resolver requires it (tsconfig's `allowImportingTsExtensions`
// makes this valid for `tsc --noEmit` too — see tsconfig.json).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUDDY_MINIMUM_SERVICE_FEE_CENTS,
  BUDDY_SERVICE_FEE_RATE,
  calculateJobPricing,
  calculatePriceBreakdown,
  formatEuroFromCents,
  InvalidJobPricingInputError,
  tryCalculateJobPricing,
} from './pricing.ts';

test('constants match the business model', () => {
  assert.equal(BUDDY_SERVICE_FEE_RATE, 0.1);
  assert.equal(BUDDY_MINIMUM_SERVICE_FEE_CENTS, 299);
});

test('calculateJobPricing: minimum fee applies below the 10% crossover', () => {
  // 0 EUR
  assert.deepEqual(
    calculateJobPricing({ jobAmountCents: 0 }),
    {
      jobAmountCents: 0,
      serviceFeeCents: 299,
      totalAmountCents: 299,
      buddyEarningsCents: 0,
      platformRevenueCents: 299,
      serviceFeeRate: 0.1,
      minimumServiceFeeCents: 299,
      currency: 'EUR',
    },
  );

  // 1 EUR
  assert.equal(calculateJobPricing({ jobAmountCents: 100 }).serviceFeeCents, 299);
  assert.equal(calculateJobPricing({ jobAmountCents: 100 }).totalAmountCents, 399);

  // 10 EUR → fee 2.99, total 12.99 (spec example)
  const t10 = calculateJobPricing({ jobAmountCents: 1000 });
  assert.equal(t10.serviceFeeCents, 299);
  assert.equal(t10.totalAmountCents, 1299);
  assert.equal(t10.buddyEarningsCents, 1000);
  assert.equal(t10.platformRevenueCents, 299);

  // 20 EUR → fee 2.99, total 22.99 (spec example)
  const t20 = calculateJobPricing({ jobAmountCents: 2000 });
  assert.equal(t20.serviceFeeCents, 299);
  assert.equal(t20.totalAmountCents, 2299);

  // 29.89 EUR → 10% = 298.9 → rounds to 299 → minimum still binds (tie)
  const t2989 = calculateJobPricing({ jobAmountCents: 2989 });
  assert.equal(t2989.serviceFeeCents, 299);
  assert.equal(t2989.totalAmountCents, 3288);

  // 29.90 EUR → 10% = 299.0 exactly → minimum still binds (tie)
  const t2990 = calculateJobPricing({ jobAmountCents: 2990 });
  assert.equal(t2990.serviceFeeCents, 299);
  assert.equal(t2990.totalAmountCents, 3289);
});

test('calculateJobPricing: exact transition where 10% first exceeds the 2.99 minimum', () => {
  // 29.94 EUR → 10% = 299.4 → rounds to 299 → minimum still binds
  assert.equal(calculateJobPricing({ jobAmountCents: 2994 }).serviceFeeCents, 299);

  // 29.95 EUR → 10% = 299.5 → rounds to 300 → percentage now exceeds the minimum
  assert.equal(calculateJobPricing({ jobAmountCents: 2995 }).serviceFeeCents, 300);
});

test('calculateJobPricing: percentage-driven fee above the crossover', () => {
  // 30 EUR → fee 3.00, total 33.00 (spec example)
  const t30 = calculateJobPricing({ jobAmountCents: 3000 });
  assert.equal(t30.serviceFeeCents, 300);
  assert.equal(t30.totalAmountCents, 3300);

  // 50 EUR → fee 5.00, total 55.00 (spec example)
  const t50 = calculateJobPricing({ jobAmountCents: 5000 });
  assert.equal(t50.serviceFeeCents, 500);
  assert.equal(t50.totalAmountCents, 5500);

  // 100 EUR → fee 10.00, total 110.00 (spec example)
  const t100 = calculateJobPricing({ jobAmountCents: 10000 });
  assert.equal(t100.serviceFeeCents, 1000);
  assert.equal(t100.totalAmountCents, 11000);

  // a very large valid amount — no maximum fee, no overflow
  const tLarge = calculateJobPricing({ jobAmountCents: 100_000_00 }); // 100,000 EUR
  assert.equal(tLarge.serviceFeeCents, 1_000_000);
  assert.equal(tLarge.totalAmountCents, 11_000_000);
});

test('calculateJobPricing: buddy earnings are never reduced by the fee', () => {
  for (const cents of [0, 1000, 2999, 3000, 100000]) {
    const breakdown = calculateJobPricing({ jobAmountCents: cents });
    assert.equal(breakdown.buddyEarningsCents, cents);
    assert.equal(breakdown.platformRevenueCents, breakdown.serviceFeeCents);
    assert.equal(breakdown.totalAmountCents, breakdown.jobAmountCents + breakdown.serviceFeeCents);
  }
});

test('calculateJobPricing: rejects invalid input instead of silently accepting it', () => {
  assert.throws(() => calculateJobPricing({ jobAmountCents: Number.NaN }), InvalidJobPricingInputError);
  assert.throws(() => calculateJobPricing({ jobAmountCents: Number.POSITIVE_INFINITY }), InvalidJobPricingInputError);
  assert.throws(() => calculateJobPricing({ jobAmountCents: Number.NEGATIVE_INFINITY }), InvalidJobPricingInputError);
  assert.throws(() => calculateJobPricing({ jobAmountCents: -1 }), InvalidJobPricingInputError);
  assert.throws(() => calculateJobPricing({ jobAmountCents: -1000 }), InvalidJobPricingInputError);
  assert.throws(() => calculateJobPricing({ jobAmountCents: 10.5 }), InvalidJobPricingInputError);
  assert.throws(() => calculateJobPricing({ jobAmountCents: undefined as unknown as number }), InvalidJobPricingInputError);
  assert.throws(() => calculateJobPricing({ jobAmountCents: '1000' as unknown as number }), InvalidJobPricingInputError);
});

test('tryCalculateJobPricing: never throws, reports ok:false for invalid input', () => {
  const valid = tryCalculateJobPricing({ jobAmountCents: 3000 });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.breakdown.serviceFeeCents, 300);
  }

  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -5, 10.5]) {
    const result = tryCalculateJobPricing({ jobAmountCents: bad });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'invalid_amount');
    }
  }
});

test('formatEuroFromCents: German locale formatting matches the spec examples', () => {
  // Intl.NumberFormat('de-DE', ...) inserts U+00A0 (non-breaking space) before
  // the currency symbol -- normalize to a regular space before comparing.
  const normalize = (s: string) => s.replace(/\u00A0/g, ' ');
  assert.equal(normalize(formatEuroFromCents(299)), '2,99 €');
  assert.equal(normalize(formatEuroFromCents(3000)), '30,00 €');
  assert.equal(normalize(formatEuroFromCents(3300)), '33,00 €');
});

test('formatEuroFromCents: never renders NaN/undefined for invalid input', () => {
  const result = formatEuroFromCents(Number.NaN);
  assert.doesNotMatch(result, /NaN/);
  assert.doesNotMatch(result, /undefined/);
});

test('legacy calculatePriceBreakdown (euro floats) delegates to the same formula', () => {
  const b30 = calculatePriceBreakdown(30);
  assert.equal(b30.basePrice, 30);
  assert.equal(b30.platformFee, 3);
  assert.equal(b30.totalPrice, 33);

  const b10 = calculatePriceBreakdown(10);
  assert.equal(b10.platformFee, 2.99);
  assert.equal(b10.totalPrice, 12.99);

  // Never throws for legacy callers, even with unusual input — clamps instead.
  assert.doesNotThrow(() => calculatePriceBreakdown(Number.NaN));
  assert.doesNotThrow(() => calculatePriceBreakdown(-5));
  assert.equal(calculatePriceBreakdown(-5).basePrice, 0);
});
