import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { T } from './text';
import { fontFor } from './fonts';

/** The Kerchief: a square of cloth, one corner turned back (assets/mark.svg). The fold is a lighter plane, never a hole. */
export function Mark({ size = 32, color = '#5B21B6', fold = '#FFFFFF', foldOpacity = 0.42 }: { size?: number; color?: string; fold?: string; foldOpacity?: number }) {
  return <Svg viewBox="0 0 48 48" width={size} height={size}>
    <Path fill={color} d="M24 2.5 45.5 24 24 45.5 2.5 24 24 2.5Z" />
    <Path fill={fold} fillOpacity={foldOpacity} d="M12.5 14h23L24 25.5 12.5 14Z" />
  </Svg>;
}
/** Lockup: mark + wordmark in live type (Archivo 600 / Alexandria). One colour only. */
export function Logo({ lockup = 'horizontal', lang = 'en', size = 32, color = '#5B21B6', fold, foldOpacity }: { lockup?: 'horizontal' | 'stacked' | 'mark'; lang?: 'en' | 'ar'; size?: number; color?: string; fold?: string; foldOpacity?: number }) {
  const ar = lang === 'ar'; const word = ar ? 'بقشة' : 'Bugsha';
  const mark = <Mark size={size} color={color} fold={fold ?? '#FFFFFF'} foldOpacity={foldOpacity ?? 0.42} />;
  if (lockup === 'mark') return mark;
  const stacked = lockup === 'stacked';
  return <View accessibilityRole="image" accessibilityLabel={word} style={{ flexDirection: stacked ? 'column' : 'row', alignItems: 'center', gap: stacked ? size * 0.3 : size * 0.4 }}>
    {mark}
    <T style={{ fontFamily: fontFor(600, ar), fontSize: size * (ar ? 1.1 : 1.24), lineHeight: size * 1.4, color, letterSpacing: ar ? 0 : -size * 0.03, writingDirection: ar ? 'rtl' : 'ltr' }}>{word}</T>
  </View>;
}
