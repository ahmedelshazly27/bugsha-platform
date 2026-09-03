/**
 * i18n/numerals.ts — Western and Arabic-Indic digits.
 *
 * A user-facing setting with a market default (docs/11-i18n.md §3). Every
 * numeric component renders both.
 */
export type NumeralSystem = 'western' | 'arabic_indic';

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
/** U+066B ARABIC DECIMAL SEPARATOR, U+066C ARABIC THOUSANDS SEPARATOR. */
const AR_DECIMAL = '٫';
const AR_THOUSANDS = '٬';

export function toArabicIndic(s: string): string {
  return s.replace(/[0-9]/g, (d) => ARABIC_INDIC[Number(d)] as string);
}

export function toWestern(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)));
}

/** 1750 -> "1,750" | "١٬٧٥٠" */
export function formatNumber(
  n: number | bigint,
  opts: { numerals: NumeralSystem; fractionDigits?: number } = { numerals: 'western' },
): string {
  const fd = opts.fractionDigits ?? 0;
  const fixed = typeof n === 'bigint' ? n.toString() : n.toFixed(fd);
  const [whole = '0', frac] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const western = frac ? `${grouped}.${frac}` : grouped;
  if (opts.numerals === 'western') return western;
  return toArabicIndic(western).replace(/,/g, AR_THOUSANDS).replace(/\./g, AR_DECIMAL);
}

/**
 * Identifiers are NEVER converted. Staff read an order code aloud against a
 * printed Latin string, and a code rendered in Arabic-Indic cannot be matched
 * against it (docs/11-i18n.md §3).
 */
export function formatIdentifier(code: string): string {
  return toWestern(code);
}
