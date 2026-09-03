import { describe, it, expect } from 'vitest';
import {
  money, zero, add, sub, isNegative, roundHalfUp, commissionOf,
  formatMoney, toArabicIndic, EXPONENT, CURRENCY_OF,
} from './money';

describe('money construction', () => {
  it('accepts bigint, number and string minor units', () => {
    expect(money(1750n, 'KWD').minor).toBe(1750n);
    expect(money(1750, 'KWD').minor).toBe(1750n);
    expect(money('1750', 'KWD').minor).toBe(1750n);
  });

  it('maps each market to its currency and exponent', () => {
    expect(CURRENCY_OF.KW).toBe('KWD');
    expect(CURRENCY_OF.EG).toBe('EGP');
    expect(EXPONENT.KWD).toBe(3);   // 1.750 KWD = 1750
    expect(EXPONENT.EGP).toBe(2);   // 89.50 EGP = 8950
  });

  it('zero carries its currency', () => {
    expect(zero('EGP')).toEqual(money(0n, 'EGP'));
  });
});

describe('arithmetic refuses cross-currency (05-money.md §1.6, ledger L19)', () => {
  it('adds within a currency', () => {
    expect(add(money(1000n, 'KWD'), money(750n, 'KWD')).minor).toBe(1750n);
  });
  it('subtracts within a currency', () => {
    expect(sub(money(1750n, 'KWD'), money(385n, 'KWD')).minor).toBe(1365n);
  });
  it('throws rather than implicitly converting KWD and EGP', () => {
    expect(() => add(money(1n, 'KWD'), money(1n, 'EGP'))).toThrow(/currency mismatch/);
    expect(() => sub(money(1n, 'EGP'), money(1n, 'KWD'))).toThrow(/currency mismatch/);
  });
  it('recognises a negative balance without throwing', () => {
    expect(isNegative(money(-1n, 'KWD'))).toBe(true);
    expect(isNegative(zero('KWD'))).toBe(false);
  });
});

describe('roundHalfUp — THE rounding function (05-money.md §1.5)', () => {
  it('L18: 22% of 1750 is 385', () => {
    expect(roundHalfUp(1750n, 0.22)).toBe(385n);
    expect(commissionOf(money(1750n, 'KWD'), 2200).minor).toBe(385n);
  });

  it('rounds a half up, never down or to even', () => {
    // 1.5 -> 2, not 1 and not 2-by-banker's-luck
    expect(roundHalfUp(3n, 0.5)).toBe(2n);
    expect(roundHalfUp(1n, 0.5)).toBe(1n);
    expect(roundHalfUp(5n, 0.5)).toBe(3n);
  });

  it('is exact at the minor unit for the EGP launch price', () => {
    // 22% of 89.00 EGP = 19.58
    expect(commissionOf(money(8900n, 'EGP'), 2200).minor).toBe(1958n);
  });

  it('never loses precision to floating point across the whole price band', () => {
    for (let base = 500; base <= 75000; base += 137) {
      const got = commissionOf(money(BigInt(base), 'EGP'), 2200).minor;
      const expected = BigInt(Math.floor((base * 2200 + 5000) / 10000));
      expect(got).toBe(expected);
    }
  });
});

describe('formatMoney — the only place Money becomes a string', () => {
  it('L2: EGP renders with two decimals, never one', () => {
    expect(formatMoney(money(8950n, 'EGP'), 'en', 'western')).toBe('89.50 EGP');
    expect(formatMoney(money(8950n, 'EGP'), 'en', 'western')).not.toBe('895.0 EGP');
  });

  it('KWD renders with three decimals', () => {
    expect(formatMoney(money(1750n, 'KWD'), 'en', 'western')).toBe('1.750 KWD');
  });

  it('pads the fraction so 1.050 never renders as 1.5', () => {
    expect(formatMoney(money(1050n, 'KWD'), 'en', 'western')).toBe('1.050 KWD');
    expect(formatMoney(money(5n, 'EGP'), 'en', 'western')).toBe('0.05 EGP');
  });

  it('uses the Arabic currency symbol in Arabic locales', () => {
    expect(formatMoney(money(1750n, 'KWD'), 'ar-KW', 'western')).toBe('1.750 د.ك');
    expect(formatMoney(money(8950n, 'EGP'), 'ar-EG', 'western')).toBe('89.50 ج.م');
  });

  it('renders Arabic-Indic numerals when the user setting asks for them', () => {
    expect(formatMoney(money(1750n, 'KWD'), 'ar-KW', 'arabic_indic')).toBe('١.٧٥٠ د.ك');
    expect(toArabicIndic('0123456789')).toBe('٠١٢٣٤٥٦٧٨٩');
  });

  it('marks a negative with a real minus sign, not a hyphen', () => {
    expect(formatMoney(money(-1750n, 'KWD'), 'en', 'western')).toBe('−1.750 KWD');
  });

  it('00-product.md: every price renders in 4 to 12 characters', () => {
    const cases = [
      money(500n, 'KWD'), money(15000n, 'KWD'),
      money(2500n, 'EGP'), money(75000n, 'EGP'),
    ];
    for (const m of cases) {
      for (const numerals of ['western', 'arabic_indic'] as const) {
        const s = formatMoney(m, 'en', numerals).replace(/ .*$/, '');
        expect(s.length).toBeGreaterThanOrEqual(4);
        expect(s.length).toBeLessThanOrEqual(12);
      }
    }
  });
});
