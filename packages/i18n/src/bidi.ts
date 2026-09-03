/**
 * i18n/bidi.ts — isolation for mixed-script strings.
 *
 * Every Latin run and every numeric run inside Arabic text is wrapped in an
 * isolate, so a currency symbol cannot flip to the wrong side of its number
 * and a full stop stays at the end of the line (docs/11-i18n.md §4).
 */
export const FSI = '⁨';  // FIRST STRONG ISOLATE
export const PDI = '⁩';  // POP DIRECTIONAL ISOLATE

/** Wrap a run so the surrounding paragraph direction cannot reorder it. */
export function isolate(run: string): string {
  return `${FSI}${run}${PDI}`;
}

export function isIsolated(s: string): boolean {
  return s.startsWith(FSI) && s.endsWith(PDI);
}

/**
 * Interpolate a template, isolating every substituted value. Callers pass the
 * already-formatted value (a price, a code, a time range) and get a string
 * that renders correctly in an RTL paragraph.
 */
export function interpolate(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = params[name];
    if (v === undefined) return whole;
    return isolate(String(v));
  });
}

/** Strip isolates — for tests, logs and anywhere a raw comparison is wanted. */
export function stripIsolates(s: string): string {
  return s.replaceAll(FSI, '').replaceAll(PDI, '');
}

export function isRtl(locale: string): boolean {
  return locale.startsWith('ar');
}

/**
 * Arabic script is connected: cutting mid-word produces a shape that reads as
 * a different letter. Latin may be cut at a character; Arabic may not
 * (docs/11-i18n.md §6).
 */
export function truncate(text: string, max: number, locale: string): string {
  if (text.length <= max) return text;
  if (!isRtl(locale)) return `${text.slice(0, Math.max(0, max - 1))}…`;
  const budget = Math.max(0, max - 1);
  const cut = text.slice(0, budget);
  const lastSpace = cut.lastIndexOf(' ');
  const whole = lastSpace > 0 ? cut.slice(0, lastSpace) : '';
  return `${whole}…`;
}
