import { describe, it, expect } from 'vitest';
import { createMarketConfigAccessor, type MarketConfig } from './market';
import { money, zero } from './money';
import { AppError } from './types';

/** Launch values from docs/13-config.md §1. */
const KW_CONFIG: MarketConfig = {
  market: 'KW', currency: 'KWD', exponent: 3, timezone: 'Asia/Kuwait', observesDst: false,
  locales: ['en', 'ar-KW'], defaultLocale: 'ar-KW', numeralsDefault: 'western',
  paymentMethods: ['knet', 'apple_pay', 'card'], cashEnabled: false, defaultCommissionBp: 2200,
  vatApplies: false, vatBp: null, vatBase: null, regulatorName: 'PAFN',
  priceMinMinor: 500n, priceMaxMinor: 15000n, maxPriceFraction: 0.5,
  reservationCapDefault: 3, reservationCapNewUser: 2, reservationCapCash: 1,
  holdDurationMinutes: 10, cancelCutoffHours: 2, lateRedeemGraceMinutes: 30,
  undoRedeemSeconds: 120, payoutCadence: 'weekly', payoutMinMinor: 5000n,
  refundCapSupportMinor: 20000n,
};

/** Egypt operates a VAT regime, but decision 1 leaves the rate undecided. */
const EG_CONFIG: MarketConfig = {
  ...KW_CONFIG,
  market: 'EG', currency: 'EGP', exponent: 2, timezone: 'Africa/Cairo', observesDst: true,
  locales: ['en', 'ar-EG'], defaultLocale: 'ar-EG',
  paymentMethods: ['card', 'wallet', 'instapay', 'fawry', 'cash'], cashEnabled: true,
  vatApplies: true, vatBp: null, vatBase: null, regulatorName: 'NFSA',
  priceMinMinor: 2500n, priceMaxMinor: 75000n, payoutMinMinor: 25000n,
  refundCapSupportMinor: 100000n,
};

const cfg = createMarketConfigAccessor([KW_CONFIG, EG_CONFIG]);

describe('market config accessor', () => {
  it('returns the config for each market', () => {
    expect(cfg.get('KW').regulatorName).toBe('PAFN');
    expect(cfg.get('EG').regulatorName).toBe('NFSA');
  });

  it('raises for a market it has no config for, rather than guessing', () => {
    const partial = createMarketConfigAccessor([KW_CONFIG]);
    expect(() => partial.get('EG')).toThrow(AppError);
  });

  it('exposes currency and payment methods so features never branch on market', () => {
    expect(cfg.currencyOf('KW')).toBe('KWD');
    expect(cfg.currencyOf('EG')).toBe('EGP');
    expect(cfg.methodsFor('KW')).toContain('knet');
    expect(cfg.methodsFor('KW')).not.toContain('cash');   // cash is Egypt-only
    expect(cfg.methodsFor('EG')).toContain('cash');
  });

  it('returns a copy, so a caller cannot mutate shared config', () => {
    const methods = cfg.methodsFor('KW');
    methods.push('cash');
    expect(cfg.methodsFor('KW')).not.toContain('cash');
  });
});

describe('resolveTax — decision 1 must never become a silent zero', () => {
  it('Kuwait has no VAT regime, so tax is zero', () => {
    const t = cfg.resolveTax('KW', money(1750n, 'KWD'), new Date());
    expect(t).toEqual(zero('KWD'));
  });

  it('Egypt raises BG150 because the rate is undecided, not zero', () => {
    expect(() => cfg.resolveTax('EG', money(8900n, 'EGP'), new Date()))
      .toThrow(/BG150/);
    try {
      cfg.resolveTax('EG', money(8900n, 'EGP'), new Date());
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('BG150');
      expect((e as AppError).context.decision).toBe(1);
    }
  });

  it('once the rate is decided it computes on the configured base', () => {
    const decided = createMarketConfigAccessor([
      KW_CONFIG, { ...EG_CONFIG, vatBp: 1400, vatBase: 'commission' },
    ]);
    // 14% of 19.58 EGP commission = 2.74
    expect(decided.resolveTax('EG', money(1958n, 'EGP'), new Date()).minor).toBe(274n);
  });

  it('refuses a base that is not the market currency', () => {
    expect(() => cfg.resolveTax('KW', money(100n, 'EGP'), new Date())).toThrow(/currency/i);
  });
});
