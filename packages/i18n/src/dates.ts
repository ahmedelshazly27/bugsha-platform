/**
 * i18n/dates.ts — Gregorian primary, Hijri secondary, Sunday-first weeks.
 *
 * Timezone abbreviation is rendered whenever ambiguity is possible and is
 * always resolved from the instant, never hardcoded (docs/11-i18n.md §7).
 */
import { tzAbbreviation, TIMEZONE } from '@bugsha/core';
import type { Market } from '@bugsha/core';
import type { LocaleCode } from './index';

export type Calendar = 'gregorian' | 'both';

/** Weekend is Friday–Saturday in both markets; the week starts Sunday. */
export const WEEK_STARTS_ON = 0;
export const WEEKEND_DAYS = [5, 6] as const;

export function isWeekend(weekday: number): boolean {
  return (WEEKEND_DAYS as readonly number[]).includes(weekday);
}

const BASE_LOCALE: Record<LocaleCode, string> = {
  en: 'en-GB', 'ar-KW': 'ar-KW', 'ar-EG': 'ar-EG',
};

export function formatDate(
  instant: Date,
  opts: { locale: LocaleCode; market: Market; calendar?: Calendar },
): string {
  const tz = TIMEZONE[opts.market];
  const gregorian = new Intl.DateTimeFormat(BASE_LOCALE[opts.locale], {
    timeZone: tz, day: 'numeric', month: 'short', year: 'numeric',
  }).format(instant);
  if (opts.calendar !== 'both') return gregorian;
  // Hijri is a SECONDARY line, shown during Ramadan and on Ramadan store
  // hours. Never primary.
  const hijri = new Intl.DateTimeFormat(`${BASE_LOCALE[opts.locale]}-u-ca-islamic-umalqura`, {
    timeZone: tz, day: 'numeric', month: 'short', year: 'numeric',
  }).format(instant);
  return `${gregorian} · ${hijri}`;
}

/** "21:00–22:00 AST" — the abbreviation resolved from the instant. */
export function formatWindow(
  startUtc: Date, endUtc: Date,
  opts: { locale: LocaleCode; market: Market; withZone?: boolean },
): string {
  const tz = TIMEZONE[opts.market];
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  const range = `${f.format(startUtc)}–${f.format(endUtc)}`;
  return opts.withZone === false ? range : `${range} ${tzAbbreviation(startUtc, opts.market)}`;
}

export function weekdayNames(locale: LocaleCode): string[] {
  const f = new Intl.DateTimeFormat(BASE_LOCALE[locale], { weekday: 'short', timeZone: 'UTC' });
  // 2026-01-04 is a Sunday: the week starts Sunday in both markets.
  return Array.from({ length: 7 }, (_, i) =>
    f.format(new Date(Date.UTC(2026, 0, 4 + i))));
}
