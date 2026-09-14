import { useEffect, useState, type ReactNode } from 'react';
import { Dimensions, Keyboard, Platform, Pressable, ScrollView, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton } from './core';
import { Caption, Headline, Num, T } from './text';
import { color as C, space } from './tokens';

/** Screen shell: canvas ground, safe-area aware. Consumer column caps at 420. */
export function Screen({ children, bg = C.canvas, pad = 14, gap = 12, scroll = true, style, top = true }: { children: ReactNode; bg?: string; pad?: number; gap?: number; scroll?: boolean; style?: ViewStyle; top?: boolean }) {
  const insets = useSafeAreaInsets();
  const body: ViewStyle = { padding: pad, gap, paddingTop: (top ? insets.top : 0) + pad, paddingBottom: insets.bottom + pad };
  return scroll
    ? <ScrollView style={{ flex: 1, backgroundColor: bg }} contentContainerStyle={[body, style]} keyboardShouldPersistTaps="handled">{children}</ScrollView>
    : <Pressable accessible={false} onPress={Keyboard.dismiss} style={[{ flex: 1, backgroundColor: bg }, body, style]}>{children}</Pressable>;
}
/** Height of the soft keyboard over the window (iOS; Android resizes the window itself). */
export function useKeyboardInset() {
  const [h, setH] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const on = (e: { endCoordinates: { screenY: number } }) => setH(Math.max(0, Math.round(Dimensions.get('window').height - e.endCoordinates.screenY)));
    const a = Keyboard.addListener('keyboardWillChangeFrame', on); const b = Keyboard.addListener('keyboardDidHide', () => setH(0));
    return () => { a.remove(); b.remove(); };
  }, []);
  return h;
}
/** Violet app bar used on brand-heavy screens (browse). Sits under the status bar. */
export function BrandBar({ children, style, color = C.brandSurface }: { children: ReactNode; style?: ViewStyle; color?: string }) {
  const insets = useSafeAreaInsets();
  return <View style={[{ backgroundColor: color, paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 14, gap: 10 }, style]}>{children}</View>;
}
/** Standard raised app bar: back, title, optional sub and trailing action. */
export function AppBar({ title, sub, back = true, onBack, action, backLabel = 'Back' }: { title: ReactNode; sub?: string; back?: boolean; onBack?: () => void; action?: ReactNode; backLabel?: string }) {
  const insets = useSafeAreaInsets();
  return <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 12, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.raised, borderBottomWidth: 1, borderColor: C.borderSubtle }}>
    {back ? <IconButton icon="arrow-left" mirror label={backLabel} onPress={onBack} /> : null}
    <View style={{ flex: 1, minWidth: 0 }}>{typeof title === 'string' ? <Headline numberOfLines={1}>{title}</Headline> : title}{sub ? (/^[\d\s:.,\-–—→\/]+$/.test(sub) ? <Num role="caption" color={C.textSecondary}>{sub}</Num> : <Caption>{sub}</Caption>) : null}</View>
    {action}
  </View>;
}
/** Footer with the one primary action, above the home indicator. */
export function Foot({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const insets = useSafeAreaInsets(); const kb = useKeyboardInset();
  // Rides above the keyboard so the primary action is always reachable (a number pad has no return key).
  return <View style={[{ padding: 14, paddingBottom: (kb > 0 ? 0 : insets.bottom) + 10, marginBottom: kb, gap: 8, borderTopWidth: 1, borderColor: C.borderSubtle, backgroundColor: C.raised }, style]}>{children}</View>;
}
export const Stack = ({ children, g = 10, style }: { children: ReactNode; g?: number; style?: ViewStyle }) => <View style={[{ gap: g }, style]}>{children}</View>;
export const Row = ({ children, g = 8, style }: { children: ReactNode; g?: number; style?: ViewStyle }) => <View style={[{ flexDirection: 'row', alignItems: 'center', gap: g }, style]}>{children}</View>;
export const Chips = ({ children }: { children: ReactNode }) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{children}</View>;
export const Rule = () => <View style={{ height: 1, backgroundColor: C.borderSubtle }} />;
/** Key / value line for receipts and summaries. */
export const Line = ({ k, v, strong }: { k: ReactNode; v: ReactNode; strong?: boolean }) => <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
  <T role={strong ? 'body' : 'label'} weight={strong ? 700 : 400} color={strong ? C.text : C.textSecondary}>{k}</T>{typeof v === 'string' ? <T role={strong ? 'body' : 'label'} weight={strong ? 700 : 400}>{v}</T> : v}</View>;
/** Section head: title + right meta. */
export const SecHead = ({ title, right }: { title: string; right?: ReactNode }) => <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, paddingVertical: 2 }}>
  <T role="headline" weight={700}>{title}</T>{typeof right === 'string' ? <Caption>{right}</Caption> : right}</View>;
export const Pp = ({ children, style }: { children: ReactNode; style?: object }) => <T role="label" color={C.textSecondary} style={[{ fontSize: 13.5, lineHeight: 21 }, style]}>{children}</T>;
export const Center = ({ children }: { children: ReactNode }) => <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[200] }}>{children}</View>;
