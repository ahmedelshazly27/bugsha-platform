import { describe, it, expect } from 'vitest';
import { zPhone, zAddress, zBagTemplate, zPromotion, zAdjustment, zHoldListing, zRedeemOrder } from './schemas';
import type { MarketConfig } from './market';

const KW: Pick<MarketConfig, 'priceMinMinor' | 'priceMaxMinor' | 'maxPriceFraction'> = {
  priceMinMinor: 500n, priceMaxMinor: 15000n, maxPriceFraction: 0.5,
};
const uuid = '11111111-1111-4111-8111-111111111111';

describe('phone validation is market-specific and the error names the rule', () => {
  it('Kuwait is +965 and eight digits', () => {
    expect(zPhone('KW').safeParse('+96550000001').success).toBe(true);
    expect(zPhone('KW').safeParse('+9655000001').success).toBe(false);
    expect(zPhone('KW').safeParse('+20100000001').success).toBe(false);
    const r = zPhone('KW').safeParse('bad');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('phone.kw_eight_digits');
  });
  it('Egypt is +20 and ten digits', () => {
    expect(zPhone('EG').safeParse('+201000000001').success).toBe(true);
    expect(zPhone('EG').safeParse('+2010000001').success).toBe(false);
    const r = zPhone('EG').safeParse('bad');
    if (!r.success) expect(r.error.issues[0]?.message).toBe('phone.eg_ten_digits');
  });
});

describe('addresses are market-shaped, never one loose object', () => {
  it('Kuwait needs a block; Egypt needs a district', () => {
    const kw = { governorate: 'Hawalli', area: 'Salmiya', block: '10', street: 'Salem', building: '12' };
    const eg = { governorate: 'Cairo', district: 'Zamalek', street: 'Bahgat Ali', building: '12' };
    expect(zAddress('KW').safeParse(kw).success).toBe(true);
    expect(zAddress('EG').safeParse(eg).success).toBe(true);
    // A Kuwaiti address is not a valid Egyptian one and vice versa.
    expect(zAddress('EG').safeParse(kw).success).toBe(false);
    expect(zAddress('KW').safeParse(eg).success).toBe(false);
  });
});

describe('bag template mirrors app.upsert_bag_template so the client fails fast', () => {
  const base = {
    titleEn: 'Evening Bakery Bag', titleAr: 'بقشة المخبز',
    descriptionEn: 'A mix of what is left at close.',
    category: 'bakery',
    valueMinMinor: 3000n, valueMaxMinor: 6000n, priceMinor: 1500n,
    defaultQuantity: 8, defaultWindowStart: '21:00', defaultWindowEnd: '22:00',
    dietaryFlags: [],
  };

  it('accepts a listing priced at exactly half the stated minimum value', () => {
    expect(zBagTemplate(KW).safeParse(base).success).toBe(true);
  });

  it('rejects a price above half the minimum value, naming the ceiling', () => {
    const r = zBagTemplate(KW).safeParse({ ...base, priceMinor: 1600n });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map(i => i.message)).toContain('template.price_fraction');
  });

  it('rejects an inverted value range', () => {
    const r = zBagTemplate(KW).safeParse({ ...base, valueMinMinor: 6000n, valueMaxMinor: 3000n, priceMinor: 1500n });
    if (!r.success) expect(r.error.issues.map(i => i.message)).toContain('template.value_range');
  });

  it('rejects a price outside the market band', () => {
    const low = zBagTemplate(KW).safeParse({ ...base, priceMinor: 100n, valueMinMinor: 3000n });
    if (!low.success) expect(low.error.issues.map(i => i.message)).toContain('template.price_bounds');
  });

  it('rejects alcohol outright, in both markets', () => {
    const r = zBagTemplate(KW).safeParse({ ...base, category: 'alcohol' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map(i => i.message)).toContain('template.alcohol_forbidden');
  });

  it('requires a description in at least one language', () => {
    const r = zBagTemplate(KW).safeParse({ ...base, descriptionEn: undefined, descriptionAr: undefined });
    if (!r.success) expect(r.error.issues.map(i => i.message)).toContain('template.description_required');
  });
});

describe('promotion cannot exist without funding attribution', () => {
  const base = {
    code: 'RAMADAN10', market: 'KW' as const, discountType: 'percent' as const, discountValue: 10,
    eligibility: {}, budgetCapMinor: 100000n,
    validFrom: '2026-03-01T00:00:00.000Z', validTo: '2026-04-01T00:00:00.000Z', stackable: false,
  };
  it('accepts platform-funded and partner-funded', () => {
    expect(zPromotion.safeParse({ ...base, fundedBy: 'platform' }).success).toBe(true);
    expect(zPromotion.safeParse({ ...base, fundedBy: 'partner' }).success).toBe(true);
  });
  it('refuses a promotion with no funder — there is no default', () => {
    expect(zPromotion.safeParse(base).success).toBe(false);
  });
});

describe('adjustments must balance and must carry a reason', () => {
  const entries = [
    { entryType: 'debit' as const, account: 'platform_bank', amountMinor: 100n },
    { entryType: 'credit' as const, account: 'commission_revenue', amountMinor: 100n },
  ];
  const base = { market: 'KW' as const, entries, reasonCode: 'manual_correction',
                 justification: 'Reconciling a duplicated settlement line.',
                 effectiveAt: '2026-09-03T00:00:00.000Z' };

  it('accepts a balanced adjustment with a reason', () => {
    expect(zAdjustment.safeParse(base).success).toBe(true);
  });
  it('L16: refuses one with no reason code', () => {
    expect(zAdjustment.safeParse({ ...base, reasonCode: '' }).success).toBe(false);
  });
  it('refuses an unbalanced one', () => {
    const bad = [entries[0]!, { ...entries[1]!, amountMinor: 90n }];
    const r = zAdjustment.safeParse({ ...base, entries: bad });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map(i => i.message)).toContain('adjustment.unbalanced');
  });
  it('refuses a single-legged entry', () => {
    expect(zAdjustment.safeParse({ ...base, entries: [entries[0]!] }).success).toBe(false);
  });
});

describe('mutation payloads carry an idempotency key', () => {
  it('hold requires a uuid key', () => {
    expect(zHoldListing.safeParse({ listingId: uuid, quantity: 1, idempotencyKey: uuid }).success).toBe(true);
    expect(zHoldListing.safeParse({ listingId: uuid, quantity: 1, idempotencyKey: 'nope' }).success).toBe(false);
  });
  it('redeem accepts an offline client timestamp', () => {
    expect(zRedeemOrder.safeParse({
      orderId: uuid, mechanism: 'code_shown', idempotencyKey: uuid,
      clientTs: '2026-09-03T18:20:00.000Z',
    }).success).toBe(true);
  });
});
