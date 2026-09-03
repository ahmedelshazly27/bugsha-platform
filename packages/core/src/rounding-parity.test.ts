/**
 * L18 (second half): roundHalfUp must agree between TypeScript and plpgsql.
 *
 * The plpgsql twin is app.round_half_up in
 * supabase/migrations/20260903000700_app_foundation.sql. These checksums were
 * produced by running the SAME inputs through Postgres on bugsha-dev; if
 * either implementation drifts, the sums stop matching.
 *
 *   select sum(app.round_half_up(n, <factor>)) from generate_series(1,10000) n;
 */
import { describe, it, expect } from 'vitest';
import { roundHalfUp, commissionOf, money } from './money';

const sumOver = (factor: number) => {
  let total = 0n;
  for (let n = 1n; n <= 10_000n; n += 1n) total += roundHalfUp(n, factor);
  return total;
};

describe('TypeScript and plpgsql round identically', () => {
  it('L18: 22% of 1750 is 385 in both', () => {
    expect(roundHalfUp(1750n, 0.22)).toBe(385n);   // postgres: 385
  });

  it('agrees across 10,000 inputs at 22%', () => {
    expect(sumOver(0.22)).toBe(11_001_200n);       // postgres: 11001200
  });

  it('agrees on a factor with a trailing half at 18.75%', () => {
    expect(sumOver(0.1875)).toBe(9_376_250n);      // postgres: 9376250
  });

  it('agrees on a tiny factor where halves are common at 0.5%', () => {
    // 0.005 puts a .5 residue on every even n — the case where round-half-up
    // and round-half-to-even diverge, so this is the one that matters.
    expect(sumOver(0.005)).toBe(250_050n);         // postgres: 250050
  });

  it('commissionOf matches app.commission_of over the same range', () => {
    let total = 0n;
    for (let n = 1n; n <= 10_000n; n += 1n) total += commissionOf(money(n, 'KWD'), 2200).minor;
    expect(total).toBe(11_001_200n);               // postgres: 11001200
  });
});
