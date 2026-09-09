import { useEffect, useState, type ReactNode } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, I18nManager, type TextInputProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from './theme';
export { theme } from './theme';

const rtl = () => I18nManager.isRTL;
const T = ({ children, size = 16, weight = '400', color = theme.ink, mono = false, style = {} as object, ...p }: { children: ReactNode; size?: number; weight?: '400' | '600' | '700'; color?: string; mono?: boolean; style?: object; accessibilityRole?: 'header' | 'alert' }) =>
  <Text {...p} style={[{ fontSize: size, fontWeight: weight, color, lineHeight: theme.lineHeight(size, rtl()), fontFamily: mono ? theme.mono : undefined, textAlign: rtl() ? 'right' : 'left', writingDirection: rtl() ? 'rtl' : 'ltr' }, style]}>{children}</Text>;

export function Screen({ title, children }: { title: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return <ScrollView style={{ flex: 1, backgroundColor: theme.paper }} keyboardShouldPersistTaps="handled"
    contentContainerStyle={{ paddingTop: insets.top + theme.space(3), paddingBottom: insets.bottom + theme.space(5), paddingHorizontal: theme.space(5), gap: theme.space(3) }}>
    <T size={28} weight="700" accessibilityRole="header">{title}</T>{children}</ScrollView>;
}
export function Button({ children, onPress, tone = 'primary', disabled }: { children: ReactNode; onPress: () => void; tone?: 'primary' | 'ghost'; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} hitSlop={8}
    style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: theme.space(5), borderRadius: theme.radius, alignItems: 'center', justifyContent: 'center',
      backgroundColor: tone === 'primary' ? theme.violet : 'transparent', borderWidth: tone === 'ghost' ? 1 : 0, borderColor: theme.line, opacity: pressed || disabled ? 0.6 : 1 })}>
    <T weight="600" color={tone === 'primary' ? theme.paper : theme.violet}>{children}</T></Pressable>;
}
export function Field({ label, ...p }: { label: string } & TextInputProps) {
  return <View style={{ gap: 6 }}><T size={13} color={theme.ink2}>{label}</T>
    <TextInput accessibilityLabel={label} {...p} style={{ minHeight: 48, borderWidth: 1, borderColor: theme.line, borderRadius: theme.radius, paddingHorizontal: 14, fontSize: 16, textAlign: rtl() ? 'right' : 'left', color: theme.ink }} /></View>;
}
export function Segmented<V extends string>({ value, onChange, options }: { value: V; onChange: (v: V) => void; options: Array<{ value: V; label: string }> }) {
  return <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: theme.line, borderRadius: theme.radius, overflow: 'hidden' }}>
    {options.map((o) => <Pressable key={o.value} accessibilityRole="radio" accessibilityState={{ selected: o.value === value }} onPress={() => onChange(o.value)}
      style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: o.value === value ? theme.violet : 'transparent' }}>
      <T size={14} weight="600" color={o.value === value ? theme.paper : theme.ink}>{o.label}</T></Pressable>)}</View>;
}
export function ListRow({ title, subtitle, trailing, onPress }: { title: string; subtitle?: string; trailing?: ReactNode; onPress?: () => void }) {
  return <Pressable accessibilityRole={onPress ? 'button' : undefined} onPress={onPress} style={{ minHeight: 56, paddingVertical: 10, borderBottomWidth: 1, borderColor: theme.line, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
    <View style={{ flex: 1 }}><T weight="600">{title}</T>{subtitle ? <T size={13} color={theme.ink2}>{subtitle}</T> : null}</View>
    {typeof trailing === 'string' ? <T mono>{trailing}</T> : trailing}</Pressable>;
}
/** Price and pickup window may NEVER be cut; tabular figures so digits do not jitter. */
export function PriceTag({ price, was }: { price: string; was?: string }) {
  return <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
    <T size={24} weight="700" mono style={{ fontVariant: ['tabular-nums'] }}>{'⁨' + price + '⁩'}</T>
    {was ? <T size={14} color={theme.ink3} style={{ textDecorationLine: 'line-through' }}>{'⁨' + was + '⁩'}</T> : null}</View>;
}
export function BagCard({ title, store, price, value, left, leftLabel, window, onPress }: { title: string; store: string; price: string; value: string; left: number; leftLabel: string; window: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}, ${store}, ${price}, ${leftLabel}, ${window}`} onPress={onPress}
    style={{ borderWidth: 1, borderColor: theme.line, borderRadius: theme.radius, padding: theme.space(4), gap: 6, backgroundColor: theme.paper }}>
    <T size={13} color={theme.ink2}>{store}</T><T size={18} weight="600">{title}</T>
    <PriceTag price={price} was={value} />
    <View style={{ flexDirection: 'row', gap: 12 }}><T size={13} color={left <= 3 ? theme.violet : theme.ink2}>{leftLabel}</T><T size={13} color={theme.ink2}>{'⁨' + window + '⁩'}</T></View></Pressable>;
}
/** S-C-041: white ground, ≥ 48px mono, outdoor-legible. Codes are never converted to Arabic-Indic. */
export function RedemptionCode({ code }: { code: string }) {
  return <View accessibilityLabel={`code ${code.split('').join(' ')}`} style={{ backgroundColor: '#FFFFFF', padding: theme.space(6), borderRadius: theme.radius, borderWidth: 2, borderColor: theme.ink, alignItems: 'center' }}>
    <Text style={{ fontSize: 56, fontFamily: theme.mono, fontWeight: '700', letterSpacing: 4, color: '#111111', writingDirection: 'ltr', fontVariant: ['tabular-nums'] }}>{code}</Text></View>;
}
export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' | 'error' | 'success' }) {
  const color = tone === 'error' ? theme.danger : tone === 'warn' ? theme.warn : tone === 'success' ? theme.success : theme.ink2;
  return <View accessibilityRole={tone === 'error' ? 'alert' : undefined} style={{ padding: 12, borderRadius: theme.radius, backgroundColor: theme.surface, borderLeftWidth: 3, borderColor: color }}><T size={14} color={color}>{children}</T></View>;
}
export function Stat({ label, value }: { label: string; value: string }) { return <View style={{ gap: 2 }}><T size={12} color={theme.ink3}>{label}</T><T size={22} weight="700" mono style={{ fontVariant: ['tabular-nums'] }}>{value}</T></View>; }
export function Empty({ title }: { title: string }) { return <View style={{ padding: theme.space(8), alignItems: 'center' }}><T color={theme.ink2}>{title}</T></View>; }
/** Announced at 30, 10 and 5 minutes only — never re-announced every second (§a11y). */
export function Countdown({ until, label }: { until: Date; label: string }) {
  const [left, setLeft] = useState(Math.max(0, until.getTime() - Date.now()));
  useEffect(() => { const id = setInterval(() => setLeft(Math.max(0, until.getTime() - Date.now())), 1000); return () => clearInterval(id); }, [until]);
  const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
  const announce = [30, 10, 5].includes(m) && s === 0;
  return <View accessibilityLiveRegion={announce ? 'polite' : 'none'}><T size={13} color={theme.ink2}>{label}</T><T size={20} weight="600" mono style={{ fontVariant: ['tabular-nums'] }}>{`${m}:${String(s).padStart(2, '0')}`}</T></View>;
}
