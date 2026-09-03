/**
 * core/market.ts — the market config accessor.
 *
 * Every market-varying value is read from here. NEVER branch inline on
 * `market === 'KW'` in a feature file — add a field to MarketConfig instead
 * (docs/01-architecture.md §2, docs/10-types.md).
 *
 * Config rows live in the database (`market_config`) and are approved with
 * four eyes; this module is the typed read side of them.
 */
import { commissionOf, zero, type Currency, type Money } from './money';
import { AppError, type LocaleCode, type Market, type NumeralSystem, type PaymentMethod } from './types';

export interface MarketConfig {
  market: Market;
  currency: Currency;
  exponent: number;
  timezone: string;
  observesDst: boolean;
  locales: LocaleCode[];
  defaultLocale: LocaleCode;
  numeralsDefault: NumeralSystem;
  paymentMethods: PaymentMethod[];
  cashEnabled: boolean;
  defaultCommissionBp: number;
  /** null means UNDECIDED. Never coerce to 0 — resolveTax() throws instead. */
  vatApplies: boolean;
  vatBp: number | null;
  vatBase: 'commission' | 'gross' | null;
  regulatorName: string;
  priceMinMinor: bigint;
  priceMaxMinor: bigint;
  maxPriceFraction: number;
  reservationCapDefault: number;
  reservationCapNewUser: number;
  reservationCapCash: number;
  holdDurationMinutes: number;
  cancelCutoffHours: number;
  lateRedeemGraceMinutes: number;
  undoRedeemSeconds: number;
  payoutCadence: 'weekly' | 'biweekly';
  payoutMinMinor: bigint;
  refundCapSupportMinor: bigint;
}

export interface MarketConfigAccessor {
  get(market: Market): MarketConfig;
  currencyOf(market: Market): Currency;
  methodsFor(market: Market): PaymentMethod[];
  /** Throws BG150 when vatApplies is true but the rate is undecided. */
  resolveTax(market: Market, base: Money, at: Date): Money;
}

export function createMarketConfigAccessor(configs: readonly MarketConfig[]): MarketConfigAccessor {
  const byMarket = new Map<Market, MarketConfig>(configs.map((c) => [c.market, c]));

  function get(market: Market): MarketConfig {
    const c = byMarket.get(market);
    // A missing config is a deployment fault. Guessing one would mean guessing
    // a commission rate and a currency.
    if (!c) throw new AppError('config.market_missing', { market });
    return c;
  }

  return {
    get,
    currencyOf: (market) => get(market).currency,
    // Copy: config is shared, and a caller that mutates it corrupts every
    // later read in the process.
    methodsFor: (market) => [...get(market).paymentMethods],

    resolveTax(market, base, _at) {
      const c = get(market);
      if (base.currency !== c.currency) {
        throw new AppError('tax.currency_mismatch', { market, expected: c.currency, got: base.currency });
      }
      if (!c.vatApplies) return zero(c.currency);
      if (c.vatBp === null || c.vatBase === null) {
        // Decision 1. Do NOT return zero — an accidental zero-rate is a tax
        // liability nobody discovers until an audit (13-config.md §2).
        throw new AppError('BG150', { market, decision: 1, reason: 'vat rate undecided' });
      }
      return commissionOf(base, c.vatBp);
    },
  };
}
