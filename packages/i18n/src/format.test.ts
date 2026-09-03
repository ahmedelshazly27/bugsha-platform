import { describe, it, expect } from 'vitest';
import {
  formatNumber, formatIdentifier, toArabicIndic, toWestern,
  isolate, isIsolated, interpolate, stripIsolates, isRtl, truncate,
  formatDate, formatWindow, weekdayNames, isWeekend, WEEK_STARTS_ON,
  t, errorMessage, refundTimingMessage, resolveLocale,
} from './index';

describe('numerals (§3)', () => {
  it('groups thousands in both systems', () => {
    expect(formatNumber(1750, { numerals: 'western' })).toBe('1,750');
    expect(formatNumber(1750, { numerals: 'arabic_indic' })).toBe('١٬٧٥٠');
  });
  it('uses the Arabic decimal separator, not a full stop', () => {
    expect(formatNumber(1.5, { numerals: 'arabic_indic', fractionDigits: 1 })).toBe('١٫٥');
  });
  it('round-trips digits', () => {
    expect(toWestern(toArabicIndic('4K7-92'))).toBe('4K7-92');
  });
  it('NEVER converts an identifier — staff read codes aloud against Latin text', () => {
    expect(formatIdentifier('4K7-92')).toBe('4K7-92');
    expect(formatIdentifier(toArabicIndic('4K7-92'))).toBe('4K7-92');
  });
});

describe('bidi isolation (§4)', () => {
  it('wraps a run in FSI…PDI', () => {
    expect(isIsolated(isolate('Sadu Bakehouse'))).toBe(true);
    expect(stripIsolates(isolate('Sadu Bakehouse'))).toBe('Sadu Bakehouse');
  });

  it('isolates every interpolated value so currency cannot flip sides', () => {
    const s = interpolate('السعر {price} بدلاً من {was}.', { price: '1.750 KWD', was: '6.000 KWD' });
    expect(s).toBe('السعر ⁨1.750 KWD⁩ بدلاً من ⁨6.000 KWD⁩.');
    // The full stop stays outside the isolate, at the end of the paragraph.
    expect(s.endsWith('.')).toBe(true);
  });

  it('keeps a code and a time range each in their own run', () => {
    const s = interpolate('رمزك {code} ووقت الاستلام {window}.', { code: '4K7-92', window: '21:00–22:00' });
    expect(s).toBe('رمزك ⁨4K7-92⁩ ووقت الاستلام ⁨21:00–22:00⁩.');
  });

  it('leaves an unknown placeholder visible rather than printing "undefined"', () => {
    expect(interpolate('Pay {amount}', {})).toBe('Pay {amount}');
  });

  it('knows which locales are RTL', () => {
    expect(isRtl('ar-KW')).toBe(true);
    expect(isRtl('ar-EG')).toBe(true);
    expect(isRtl('en')).toBe(false);
  });
});

describe('truncation (§6) — Arabic is never cut mid-word', () => {
  it('Latin may be cut at a character', () => {
    expect(truncate('Sadu Bakehouse and Patisserie', 12, 'en')).toBe('Sadu Bakeho…');
  });
  it('Arabic truncates at the last whole word', () => {
    const name = 'مخبز السدو للحلويات والمعجنات';
    const out = truncate(name, 14, 'ar-KW');
    expect(out.endsWith('…')).toBe(true);
    // Whatever survived must be a prefix ending on a word boundary.
    const kept = out.slice(0, -1);
    expect(name.startsWith(kept)).toBe(true);
    expect(name[kept.length] === ' ' || kept.length === 0).toBe(true);
  });
  it('leaves a short string alone in both scripts', () => {
    expect(truncate('Qout', 30, 'en')).toBe('Qout');
    expect(truncate('مخبز السدو', 30, 'ar-KW')).toBe('مخبز السدو');
  });
  it('handles a 40-character Latin and 30-character Arabic store name (§6)', () => {
    expect(truncate('A'.repeat(60), 40, 'en').length).toBe(40);
    expect(truncate('مخبز '.repeat(12), 30, 'ar-EG').length).toBeLessThanOrEqual(30);
  });
});

describe('dates and windows (§7)', () => {
  const start = new Date('2026-09-03T18:00:00Z');
  const end = new Date('2026-09-03T19:00:00Z');

  it('renders the Kuwait window in local time with AST', () => {
    expect(formatWindow(start, end, { locale: 'en', market: 'KW' })).toBe('21:00–22:00 AST');
  });
  it('renders Egypt with EEST in summer and EET in winter', () => {
    expect(formatWindow(start, end, { locale: 'en', market: 'EG' })).toBe('21:00–22:00 EEST');
    const w = new Date('2026-01-15T19:00:00Z');
    expect(formatWindow(w, new Date('2026-01-15T20:00:00Z'), { locale: 'en', market: 'EG' }))
      .toBe('21:00–22:00 EET');
  });
  it('can omit the zone where there is no ambiguity', () => {
    expect(formatWindow(start, end, { locale: 'en', market: 'KW', withZone: false })).toBe('21:00–22:00');
  });
  it('shows Hijri only as a secondary line, never alone', () => {
    const g = formatDate(start, { locale: 'en', market: 'KW' });
    const both = formatDate(start, { locale: 'en', market: 'KW', calendar: 'both' });
    expect(both.startsWith(g)).toBe(true);
    expect(both).toContain('·');
  });
  it('weeks start Sunday and the weekend is Friday–Saturday in both markets', () => {
    expect(WEEK_STARTS_ON).toBe(0);
    expect(weekdayNames('en')[0]).toBe('Sun');
    expect(isWeekend(5)).toBe(true);
    expect(isWeekend(6)).toBe(true);
    expect(isWeekend(0)).toBe(false);
  });
});

describe('copy resolution', () => {
  it('resolves a key per locale', () => {
    expect(t('browse.header.title', 'en')).toBe('Tonight near you');
    expect(t('browse.header.title', 'ar-EG')).toBe('النهاردة جنبك');
  });
  it('interpolates and isolates', () => {
    expect(stripIsolates(t('bag.left', 'ar-KW', { count: 3 }))).toBe('باقي 3');
  });
  it('returns the key for a missing string rather than crashing a screen', () => {
    expect(t('nope.not.here', 'en')).toBe('nope.not.here');
  });
  it('maps a server code to a message, never a raw string', () => {
    expect(errorMessage('BG110', 'en')).toBe('Someone got the last one');
    expect(errorMessage('BG113', 'en', { cap: 2 })).toContain('2');
  });
  it('states refund timing per market and destination', () => {
    expect(refundTimingMessage('KW', 'knet', 'en')).toMatch(/working days/);
    expect(refundTimingMessage('KW', 'wallet', 'en')).toMatch(/Instantly/);
  });
  it('falls back to the market default locale', () => {
    expect(resolveLocale(null, 'ar-KW')).toBe('ar-KW');
    expect(resolveLocale('ar-EG', 'ar-KW')).toBe('ar-EG');
    expect(resolveLocale('fr', 'ar-KW')).toBe('ar-KW');
  });
});
