import type { ReactNode } from 'react';
import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { arabic, color, type } from './tokens';
import { fontFor, isRTL, monoFor, type Weight } from './fonts';

type Role = keyof typeof type;
export interface TProps extends Omit<TextProps, 'children' | 'role'> { role?: Role; weight?: Weight; color?: string; mono?: boolean; align?: 'auto' | 'left' | 'right' | 'center'; tracking?: number; children?: ReactNode }
/** One text primitive. Arabic runs at 0.96× size and 1.18× line-height (typography.css). Numbers use Plex Mono, tabular, LTR. */
export function T({ role = 'body', weight = 400, color: c = color.text, mono, align = 'auto', tracking, style, children, ...rest }: TProps) {
  const rtl = isRTL(); const [s, l] = type[role];
  const base: TextStyle = mono
    ? { fontFamily: monoFor(weight), fontSize: s, lineHeight: l, fontVariant: ['tabular-nums'], writingDirection: 'ltr', color: c }
    : { fontFamily: fontFor(weight, rtl), fontSize: rtl ? Math.round(s * arabic.sizeScale) : s, lineHeight: rtl ? Math.round(l * arabic.lineScale) : l, color: c, writingDirection: rtl ? 'rtl' : 'ltr' };
  const ta = align === 'auto' ? (rtl ? 'right' : 'left') : align;
  return <RNText {...rest} style={[base, { textAlign: ta, letterSpacing: tracking ?? (!rtl && (role === 'display' || role === 'displayXl' || role === 'titleLg') ? -0.4 : 0) }, style]}>{children}</RNText>;
}
/** Numeric span: Plex Mono, tabular figures, always LTR — prices, times, codes, counts. Western digits in both languages. */
export const Num = (p: TProps) => <T mono {...p} />;
export const Display = (p: TProps) => <T role="display" weight={700} {...p} />;
export const Title = (p: TProps) => <T role="title" weight={700} {...p} />;
export const TitleLg = (p: TProps) => <T role="titleLg" weight={700} {...p} />;
export const Headline = (p: TProps) => <T role="headline" weight={600} {...p} />;
export const Body = (p: TProps) => <T role="body" {...p} />;
export const Label = (p: TProps) => <T role="label" weight={500} {...p} />;
export const Caption = (p: TProps) => <T role="caption" color={color.textSecondary} {...p} />;
export const Micro = (p: TProps) => <T role="micro" color={color.textTertiary} {...p} />;
/** Mono uppercase section label. */
export const Eyebrow = (p: TProps) => <Num role="micro" color={color.textTertiary} tracking={1.2} {...p}>{typeof p.children === 'string' ? p.children.toUpperCase() : p.children}</Num>;
