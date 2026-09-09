import type { ComponentType } from 'react';
import * as LUCIDE from 'lucide-react-native';
import { View } from 'react-native';
import { isRTL } from './fonts';
import { color as C } from './tokens';

const pascal = (n: string) => n.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('');
export type IconName = string;
export interface IconProps { name: IconName; size?: number; color?: string; strokeWidth?: number; mirror?: boolean; fill?: string }
/** Lucide glyph at the system stroke (2). `mirror` flips directional glyphs in RTL — arrows, chevrons, navigation. Clocks, logos and stars never flip. */
export function Icon({ name, size = 20, color = C.text, strokeWidth = 2, mirror = false, fill = 'none' }: IconProps) {
  const Cmp = (LUCIDE as unknown as Record<string, ComponentType<any>>)[pascal(name)] ?? (LUCIDE as unknown as Record<string, ComponentType<any>>)['Package']!;
  const el = <Cmp size={size} color={color} strokeWidth={strokeWidth} fill={fill} />;
  return mirror && isRTL() ? <View style={{ transform: [{ scaleX: -1 }] }}>{el}</View> : el;
}
