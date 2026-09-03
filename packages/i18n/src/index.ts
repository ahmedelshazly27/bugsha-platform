/**
 * @bugsha/i18n — locale resolution, interpolation and the copy register.
 *
 * Three locales, and the two Arabic ones are authored separately for their
 * markets. Never machine-translate between them (docs/11-i18n.md).
 */
import common from '../copy/common.json' with { type: 'json' };
import errors from '../copy/errors.json' with { type: 'json' };
import refundTiming from '../copy/refund-timing.json' with { type: 'json' };
import { interpolate } from './bidi';

export * from './numerals';
export * from './bidi';
export * from './dates';

export const LOCALES = ['en', 'ar-KW', 'ar-EG'] as const;
export type LocaleCode = (typeof LOCALES)[number];

export type LocalisedString = Record<LocaleCode, string>;

const REGISTERS: Record<string, Record<string, unknown>> = {
  common: common as Record<string, unknown>,
  errors: errors as Record<string, unknown>,
  'refund-timing': refundTiming as Record<string, unknown>,
};

export function isLocale(v: string): v is LocaleCode {
  return (LOCALES as readonly string[]).includes(v);
}

/** The market's default locale, overridden by the user's own setting. */
export function resolveLocale(userLocale: string | null, marketDefault: LocaleCode): LocaleCode {
  return userLocale && isLocale(userLocale) ? userLocale : marketDefault;
}

function lookup(register: string, key: string): LocalisedString | undefined {
  const entry = REGISTERS[register]?.[key];
  if (!entry || typeof entry !== 'object') return undefined;
  return entry as LocalisedString;
}

/**
 * Resolve a key. A missing key returns the key itself rather than throwing —
 * a screen with one untranslated label is recoverable, a screen that crashes
 * is not. CI is what stops a missing key ever shipping.
 */
export function t(
  key: string,
  locale: LocaleCode,
  params: Record<string, string | number> = {},
  register = 'common',
): string {
  const entry = lookup(register, key);
  if (!entry) return key;
  return interpolate(entry[locale] ?? entry.en, params);
}

/** The server raises a code; the client never displays a raw server string. */
export function errorMessage(code: string, locale: LocaleCode, params: Record<string, string | number> = {}): string {
  const entry = lookup('errors', code);
  if (!entry) return t('errors.unknown', locale, {}, 'common');
  return interpolate(entry[locale] ?? entry.en, params);
}

/** Rule 8: refund timing is stated at the moment of refund, keyed (market, destination). */
export function refundTimingMessage(market: string, destination: string, locale: LocaleCode): string {
  const entry = lookup('refund-timing', `${market}.${destination}`);
  return entry ? (entry[locale] ?? entry.en) : '';
}
