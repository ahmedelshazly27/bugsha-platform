/**
 * The design system's tokens, resolved for React Native. Violet + white, two
 * colours only; states resolve to violet or the ink ramp (design system
 * SKILL.md). Values come from @bugsha/tokens, never typed here.
 */
import { resolve, cssVars } from '@bugsha/tokens';
const v = (name: string, fallback: string) => resolve((cssVars as Record<string, string>)[name] ?? fallback);
export const theme = {
  violet: v('--color-brand', '#5B21B6'), ink: v('--color-ink', '#111111'), paper: v('--color-paper', '#FFFFFF'),
  ink2: v('--color-ink-2', '#4B4B55'), ink3: v('--color-ink-3', '#8A8A94'), line: v('--color-line', '#E6E6EA'), surface: v('--color-surface-1', '#F6F5FA'),
  danger: v('--color-danger', '#B91C1C'), success: v('--color-success', '#166534'), warn: v('--color-warn', '#92400E'),
  radius: 12, space: (n: number) => n * 4,
  // Arabic line height is ×1.18 relative to Latin at the same nominal size (11-i18n.md §6).
  lineHeight: (size: number, rtl: boolean) => Math.round(size * (rtl ? 1.18 * 1.3 : 1.3)),
  fontLatin: 'Archivo', fontArabic: 'Alexandria', mono: 'JetBrainsMono',
} as const;
