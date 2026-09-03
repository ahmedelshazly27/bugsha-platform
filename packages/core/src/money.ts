/**
 * core/money.ts — the ONLY money representation in the codebase.
 *
 * Minor units as bigint plus an explicit currency. No floats, no decimal
 * strings, no bare numbers. Formatting and rounding live here and nowhere else
 * (docs/01-architecture.md §2, docs/05-money.md §1).
 */
import type { LocaleCode, Market, NumeralSystem } from './types';

declare const MoneyBrand: unique symbol;
export type Currency = 'KWD' | 'EGP';
export type Money = {
  readonly minor: bigint;
  readonly currency: Currency;
  readonly [MoneyBrand]: true;
};

/** KWD is a 3-decimal currency: 1.750 KWD is 1750 minor units. */
export const EXPONENT: Record<Currency, number> = { KWD: 3, EGP: 2 };
export const CURRENCY_OF: Record<Market, Currency> = { KW: 'KWD', EG: 'EGP' };

export function money(minor: bigint | number | string, currency: Currency): Money {
  const v = typeof minor === 'bigint' ? minor : BigInt(minor);
  return { minor: v, currency } as Money;
}

export function zero(currency: Currency): Money {
  return money(0n, currency);
}

/**
 * Cross-currency arithmetic is always a bug: there is no implicit FX, and a
 * consolidated figure needs a stored rate and rate date (05-money.md §1.6).
 */
function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.minor + b.minor, a.currency);
}

export function sub(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.minor - b.minor, a.currency);
}

export function mul(a: Money, factor: number): Money {
  return money(roundHalfUp(a.minor, factor), a.currency);
}

export function isNegative(a: Money): boolean {
  return a.minor < 0n;
}

/**
 * THE rounding function. Round-half-up at the minor unit.
 *
 * Mirrored exactly by app.round_half_up() in plpgsql — change both or neither.
 * All arithmetic is integer: `factor` is scaled to a bigint before it touches
 * the amount, so no intermediate float ever holds a money value.
 *
 * Rounding residue on commission is absorbed by the PLATFORM side and never
 * silently redistributed across partners (05-money.md §1.5).
 */
export function roundHalfUp(minor: bigint, factor: number): bigint {
  const scale = 1_000_000n;
  const f = BigInt(Math.round(factor * 1_000_000));
  const product = minor * f;
  const q = product / scale;
  const r = product % scale;
  return r * 2n >= scale ? q + 1n : q;
}

/**
 * Commission from basis points. The base is gross or discounted depending on
 * who funds a promotion (05-money.md §3.8) — the caller decides which, because
 * that distinction is a business rule, not an arithmetic one.
 */
export function commissionOf(base: Money, bp: number): Money {
  return money(roundHalfUp(base.minor, bp / 10_000), base.currency);
}

const CURRENCY_SYMBOL_AR: Record<Currency, string> = { KWD: 'د.ك', EGP: 'ج.م' };

/** Locale-aware formatting. The only place a Money becomes a string. */
export function formatMoney(m: Money, locale: LocaleCode, numerals: NumeralSystem): string {
  const exp = EXPONENT[m.currency];
  const neg = m.minor < 0n;
  const abs = neg ? -m.minor : m.minor;
  const unit = 10n ** BigInt(exp);
  const whole = (abs / unit).toString();
  const frac = (abs % unit).toString().padStart(exp, '0');
  const symbol = locale === 'en' ? m.currency : CURRENCY_SYMBOL_AR[m.currency];
  let out = `${whole}.${frac} ${symbol}`;
  if (numerals === 'arabic_indic') out = toArabicIndic(out);
  // U+2212 MINUS SIGN, not a hyphen: it aligns with the digits at every size.
  return neg ? `−${out}` : out;
}

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';

export function toArabicIndic(s: string): string {
  return s.replace(/[0-9]/g, (d) => ARABIC_INDIC[Number(d)] as string);
}
