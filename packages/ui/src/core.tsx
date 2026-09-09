import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View, type PressableProps, type TextInputProps, type ViewStyle } from 'react-native';
import { Icon } from './icon';
import { Caption, Headline, Label, Micro, Num, T, Title } from './text';
import { color as C, radius, shadow, size, space } from './tokens';
import { fontFor, isRTL } from './fonts';

type Variant = 'primary' | 'secondary' | 'ghost' | 'deal' | 'danger';
const H = { sm: size.controlSm, md: size.controlMd, lg: size.controlLg } as const;
const PAD = { sm: space[150], md: space[250], lg: space[300] } as const;
const TONE: Record<Variant, { bg: string; fg: string; border: string }> = {
  primary: { bg: C.brand, fg: C.textOnBrand, border: C.borderStrong }, secondary: { bg: C.raised, fg: C.text, border: C.border },
  ghost: { bg: 'transparent', fg: C.text, border: 'transparent' }, deal: { bg: C.deal, fg: C.dealOn, border: C.borderStrong }, danger: { bg: C.error, fg: '#fff', border: 'transparent' },
};
export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> { variant?: Variant; size?: 'sm' | 'md' | 'lg'; fullWidth?: boolean; iconStart?: string; iconEnd?: string; loading?: boolean; disabled?: boolean; children?: ReactNode; style?: ViewStyle }
/** The full button hierarchy. Primary is the single reserve/pay action per screen. Press = scale(0.97). */
export function Button({ variant = 'primary', size: sz = 'md', fullWidth, iconStart, iconEnd, loading, disabled, children, style, ...rest }: ButtonProps) {
  const t = TONE[variant]; const fs = sz === 'sm' ? 13 : sz === 'lg' ? 17 : 15;
  return <Pressable accessibilityRole="button" disabled={disabled || loading} {...rest}
    style={({ pressed }) => [{ minHeight: H[sz], paddingHorizontal: PAD[sz], alignSelf: fullWidth ? 'stretch' : 'flex-start', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[100],
      backgroundColor: pressed && variant === 'primary' ? C.brandPress : t.bg, borderWidth: 1, borderColor: t.border, borderRadius: radius.control, opacity: disabled ? 0.45 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }, style]}>
    {iconStart ? <Icon name={iconStart} size={sz === 'sm' ? 16 : 20} color={t.fg} /> : null}
    <T weight={600} color={t.fg} style={{ fontSize: fs, lineHeight: fs + 8, opacity: loading ? 0.6 : 1 }} align="center">{loading ? '…' : children}</T>
    {iconEnd ? <Icon name={iconEnd} size={sz === 'sm' ? 16 : 20} color={t.fg} mirror /> : null}
  </Pressable>;
}
/** Square 44pt-minimum icon-only control. */
export function IconButton({ icon, label, variant = 'ghost', size: sz = 44, mirror, color: fg, bg, onPress, style }: { icon: string; label: string; variant?: 'ghost' | 'solid' | 'outline'; size?: number; mirror?: boolean; color?: string; bg?: string; onPress?: () => void; style?: ViewStyle }) {
  const tone = variant === 'solid' ? { bg: C.inverse, fg: C.textInverse, bw: 0 } : variant === 'outline' ? { bg: C.raised, fg: C.text, bw: 1 } : { bg: 'transparent', fg: C.text, bw: 0 };
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={4}
    style={({ pressed }) => [{ width: sz, height: sz, alignItems: 'center', justifyContent: 'center', borderRadius: radius.control, backgroundColor: bg ?? tone.bg, borderWidth: tone.bw, borderColor: C.border, opacity: pressed ? 0.7 : 1 }, style]}>
    <Icon name={icon} size={Math.round(sz * 0.45)} color={fg ?? tone.fg} mirror={mirror} /></Pressable>;
}
/** Filter / cuisine / dietary chip. Selected is filled ink, never merely tinted (glare legibility). */
export function Chip({ children, selected, icon, count, onPress, style }: { children: ReactNode; selected?: boolean; icon?: string; count?: number; onPress?: () => void; style?: ViewStyle }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: !!selected }} onPress={onPress}
    style={[{ height: 36, paddingHorizontal: space[150], flexDirection: 'row', alignItems: 'center', gap: space[75], borderRadius: radius.chip, backgroundColor: selected ? C.inverse : C.raised, borderWidth: 1, borderColor: selected ? C.borderStrong : C.border }, style]}>
    {icon ? <Icon name={icon} size={14} color={selected ? C.textInverse : C.text} /> : null}
    <Label color={selected ? C.textInverse : C.text}>{children}</Label>
    {count != null ? <Num role="label" color={selected ? C.textInverse : C.textSecondary}>{count}</Num> : null}
  </Pressable>;
}
const BADGE: Record<string, [string, string]> = { neutral: [C.sunken, C.textSecondary], fresh: [C.freshTint, C.fresh], time: [C.timeTint, C.time], urgent: [C.timeUrgentTint, C.timeUrgent], deal: [C.deal, C.dealOn], info: [C.infoTint, C.info], error: [C.errorTint, C.error], brand: [C.brandTint, C.brand] };
/** Small status label. Tone carries meaning: fresh = quality, time = window, urgent = last 15 min. */
export function Badge({ tone = 'neutral', children, uppercase, style }: { tone?: keyof typeof BADGE; children: ReactNode; uppercase?: boolean; style?: ViewStyle }) {
  const [bg, fg] = BADGE[tone] ?? BADGE.neutral!;
  return <View style={[{ alignSelf: 'flex-start', paddingVertical: 3, paddingHorizontal: space[100], borderRadius: radius.chip, backgroundColor: bg }, style]}>
    <T role="micro" weight={600} color={fg} tracking={uppercase ? 0.9 : 0}>{uppercase && typeof children === 'string' ? children.toUpperCase() : children}</T></View>;
}
export interface InputProps extends TextInputProps { label?: string; icon?: string; hint?: string; error?: string; suffix?: string; containerStyle?: ViewStyle }
/** Text / search / numeric field. Label always visible — placeholder-only fields fail in Arabic. */
export function Input({ label, icon, hint, error, suffix, containerStyle, style, ...rest }: InputProps) {
  const [focus, setFocus] = useState(false);
  return <View style={[{ gap: space[75] }, containerStyle]}>
    {label ? <Label color={C.textSecondary}>{label}</Label> : null}
    <View style={{ minHeight: size.controlMd, paddingHorizontal: space[150], flexDirection: 'row', alignItems: 'center', gap: space[100], backgroundColor: C.raised, borderRadius: radius.control, borderWidth: focus ? 2 : 1, borderColor: error ? C.error : focus ? C.focus : C.border }}>
      {icon ? <Icon name={icon} size={18} color={C.textTertiary} /> : null}
      <TextInput accessibilityLabel={label} placeholderTextColor={C.textTertiary} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} {...rest}
        style={[{ flex: 1, minWidth: 0, fontFamily: fontFor(400), fontSize: 15, color: C.text, paddingVertical: 10, textAlign: isRTL() ? 'right' : 'left' }, style]} />
      {suffix ? <Label color={C.textTertiary}>{suffix}</Label> : null}
    </View>
    {hint || error ? <Caption color={error ? C.error : C.textTertiary}>{error || hint}</Caption> : null}
  </View>;
}
/** Neutral surface container: hairline + 1px shadow, never a floating slab. */
export function Card({ children, padded = true, onPress, style }: { children: ReactNode; padded?: boolean; onPress?: () => void; style?: ViewStyle }) {
  const s: ViewStyle = { backgroundColor: C.raised, borderRadius: radius.card, borderWidth: 1, borderColor: C.borderSubtle, padding: padded ? space[200] : 0, overflow: 'hidden', ...shadow.card };
  return onPress ? <Pressable onPress={onPress} style={({ pressed }) => [s, { opacity: pressed ? 0.92 : 1 }, style]}>{children}</Pressable> : <View style={[s, style]}>{children}</View>;
}
/** One row of a settings / account list. */
export function ListRow({ icon, label, sub, value, chevron, onPress, style }: { icon?: string; label: ReactNode; sub?: ReactNode; value?: ReactNode; chevron?: boolean; onPress?: () => void; style?: ViewStyle }) {
  return <Pressable accessibilityRole={onPress ? 'button' : undefined} onPress={onPress} disabled={!onPress}
    style={({ pressed }) => [{ minHeight: 52, paddingVertical: space[150], paddingHorizontal: space[200], flexDirection: 'row', alignItems: 'center', gap: space[150], borderBottomWidth: 1, borderColor: C.borderSubtle, backgroundColor: pressed ? C.sunken : 'transparent' }, style]}>
    {icon ? <Icon name={icon} size={18} color={C.textSecondary} /> : null}
    <View style={{ flex: 1, minWidth: 0 }}>{typeof label === 'string' ? <Label>{label}</Label> : label}{sub ? (typeof sub === 'string' ? <Caption>{sub}</Caption> : sub) : null}</View>
    {typeof value === 'string' ? <Label color={C.textSecondary}>{value}</Label> : value}
    {chevron ? <Icon name="chevron-right" size={16} color={C.textTertiary} mirror /> : null}
  </Pressable>;
}
/** Two-to-three way switch: list/map, EN/AR, tonight/tomorrow. */
export function SegmentedControl<V extends string>({ options, value, onChange, fullWidth = true, style }: { options: Array<{ value: V; label: string }>; value: V; onChange: (v: V) => void; fullWidth?: boolean; style?: ViewStyle }) {
  return <View accessibilityRole="tablist" style={[{ flexDirection: 'row', padding: 3, gap: 2, backgroundColor: C.sunken, borderRadius: radius.control, borderWidth: 1, borderColor: C.borderSubtle, alignSelf: fullWidth ? 'stretch' : 'flex-start' }, style]}>
    {options.map((o) => { const active = o.value === value; return <Pressable key={o.value} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => onChange(o.value)}
      style={[{ flex: fullWidth ? 1 : undefined, minHeight: 38, paddingHorizontal: space[200], alignItems: 'center', justifyContent: 'center', borderRadius: radius.control, backgroundColor: active ? C.raised : 'transparent' }, active ? shadow.card : null]}>
      <Label weight={600} color={active ? C.text : C.textSecondary} align="center">{o.label}</Label></Pressable>; })}
  </View>;
}
const BANNER: Record<string, [string, string, string]> = { info: ['info', C.infoTint, C.info], fresh: ['circle-check', C.freshTint, C.fresh], time: ['clock', C.timeTint, C.time], offline: ['wifi-off', C.sunken, C.textSecondary], error: ['triangle-alert', C.errorTint, C.error] };
/** Persistent inline message: offline, location off, pickup window changed. */
export function Banner({ tone = 'info', title, children, action, onAction, style }: { tone?: keyof typeof BANNER; title?: string; children?: ReactNode; action?: string; onAction?: () => void; style?: ViewStyle }) {
  const [icon, bg, fg] = BANNER[tone] ?? BANNER.info!;
  return <View style={[{ flexDirection: 'row', gap: space[150], padding: space[150], backgroundColor: bg, borderRadius: radius.card, borderWidth: 1, borderColor: C.borderSubtle }, style]}>
    <View style={{ marginTop: 2 }}><Icon name={icon} size={20} color={fg} /></View>
    <View style={{ flex: 1, gap: 2 }}>{title ? <Label weight={600}>{title}</Label> : null}{children ? <T role="caption" color={C.textSecondary} style={{ lineHeight: 18 }}>{children}</T> : null}</View>
    {action ? <Pressable onPress={onAction} style={{ alignSelf: 'center' }}><Label weight={600} color={fg}>{action}</Label></Pressable> : null}
  </View>;
}
/** No results, sold out, no reservations. Always offers one concrete next move. */
export function EmptyState({ icon = 'shopping-bag', title, body, actionLabel, onAction }: { icon?: string; title: string; body?: string; actionLabel?: string; onAction?: () => void }) {
  return <View style={{ alignItems: 'center', gap: space[150], paddingVertical: space[600], paddingHorizontal: space[300] }}>
    <View style={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: radius.card, backgroundColor: C.sunken }}><Icon name={icon} size={26} color={C.textTertiary} /></View>
    <Title align="center">{title}</Title>{body ? <T align="center" color={C.textSecondary} style={{ maxWidth: 280 }}>{body}</T> : null}
    {actionLabel ? <Button variant="secondary" onPress={onAction} style={{ marginTop: space[100] }}>{actionLabel}</Button> : null}
  </View>;
}
/** Quantity control. Never exceeds bagsLeft. */
export function Stepper({ value, min = 1, max = 9, onChange }: { value: number; min?: number; max?: number; onChange: (v: number) => void }) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[100], borderWidth: 1, borderColor: C.border, borderRadius: radius.control, padding: 2, alignSelf: 'flex-start' }}>
    <IconButton icon="minus" label="Decrease quantity" size={40} onPress={() => set(value - 1)} /><Num role="bodyLg" weight={600} style={{ minWidth: 24, textAlign: 'center' }}>{value}</Num><IconButton icon="plus" label="Increase quantity" size={40} onPress={() => set(value + 1)} /></View>;
}
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <Pressable accessibilityRole="switch" accessibilityState={{ checked, disabled }} accessibilityLabel={label} disabled={disabled} onPress={() => onChange(!checked)}
    style={{ width: 46, height: 28, padding: 3, borderRadius: radius.pill, backgroundColor: checked ? C.brand : C.border, opacity: disabled ? 0.5 : 1, alignItems: checked ? 'flex-end' : 'flex-start' }}>
    <View style={{ width: 22, height: 22, borderRadius: radius.pill, backgroundColor: '#fff', ...shadow.card }} /></Pressable>;
}
export function RatingStars({ value = 0, count, size: sz = 14, onRate }: { value?: number; count?: number; size?: number; onRate?: (n: number) => void }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
    {[1, 2, 3, 4, 5].map((i) => { const on = i <= Math.round(value); return <Pressable key={i} disabled={!onRate} onPress={() => onRate?.(i)} style={{ padding: onRate ? 6 : 0 }}><Icon name="star" size={sz} color={on ? C.rating : C.textTertiary} fill={on ? C.rating : 'none'} /></Pressable>; })}
    {count != null ? <Num role="caption" color={C.textSecondary} style={{ marginStart: 6 }}>{`${value.toFixed(1)} (${count})`}</Num> : null}
  </View>;
}
export function Skeleton({ width = '100%' as number | `${number}%`, height = 16, radius: r = 4, style }: { width?: number | `${number}%`; height?: number; radius?: number; style?: ViewStyle }) { return <View style={[{ width, height, borderRadius: r, backgroundColor: C.skeleton }, style]} />; }
const TOAST_ICON: Record<string, [string, string]> = { success: ['circle-check', '#C4B5FD'], info: ['info', '#C4B5FD'], warning: ['triangle-alert', '#C4B5FD'], error: ['triangle-alert', '#F6E4EA'] };
/** Transient confirmation. Bottom-anchored above the tab bar, never blocks the primary action. */
export function Toast({ tone = 'success', children, action, onAction, style }: { tone?: keyof typeof TOAST_ICON; children: ReactNode; action?: string; onAction?: () => void; style?: ViewStyle }) {
  const [icon, fg] = TOAST_ICON[tone] ?? TOAST_ICON.success!;
  return <View accessibilityLiveRegion="polite" style={[{ flexDirection: 'row', alignItems: 'center', gap: space[150], paddingVertical: space[150], paddingHorizontal: space[200], backgroundColor: C.inverse, borderRadius: radius.card, ...shadow.raised }, style]}>
    <Icon name={icon} size={20} color={fg} /><T color={C.textInverse} style={{ flex: 1 }}>{children}</T>{action ? <Pressable onPress={onAction}><Label weight={600} color="#C4B5FD">{action}</Label></Pressable> : null}</View>;
}
/** Modal sheet: drag handle + explicit close; never dismiss-only-by-drag. */
export function BottomSheet({ open, title, onClose, children, footer, height }: { open: boolean; title?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; height?: `${number}%` | number }) {
  return <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
    <Pressable style={{ flex: 1, backgroundColor: C.overlay }} onPress={onClose} />
    <View style={{ backgroundColor: C.raised, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, maxHeight: height ?? '92%', paddingBottom: 24 }}>
      <View style={{ width: 38, height: 4, borderRadius: 99, backgroundColor: C.border, alignSelf: 'center', marginTop: 8 }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space[150], paddingHorizontal: space[200], borderBottomWidth: 1, borderColor: C.borderSubtle }}>
        <Title>{title ?? ''}</Title><IconButton icon="x" label="Close" onPress={onClose} /></View>
      <ScrollView contentContainerStyle={{ padding: space[200], gap: space[150] }}>{children}</ScrollView>
      {footer ? <View style={{ padding: space[200], borderTopWidth: 1, borderColor: C.borderSubtle }}>{footer}</View> : null}
    </View></Modal>;
}
/** Centred confirm dialog — cancellations, refunds, running late. */
export function Dialog({ open, title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'primary', onConfirm, onCancel }: { open: boolean; title: string; body?: string; confirmLabel?: string; cancelLabel?: string; tone?: Variant; onConfirm: () => void; onCancel: () => void }) {
  return <Modal visible={open} transparent animationType="fade" onRequestClose={onCancel}>
    <View style={{ flex: 1, backgroundColor: C.overlay, alignItems: 'center', justifyContent: 'center', padding: space[300] }}>
      <View style={{ width: '100%', maxWidth: 340, backgroundColor: C.raised, borderRadius: radius.card, borderWidth: 1, borderColor: C.borderSubtle, padding: space[300], gap: space[200], ...shadow.raised }}>
        <Title>{title}</Title>{body ? <T color={C.textSecondary}>{body}</T> : null}
        <View style={{ flexDirection: 'row', gap: space[100] }}><Button variant="secondary" style={{ flex: 1 }} onPress={onCancel}>{cancelLabel}</Button><Button variant={tone} style={{ flex: 1 }} onPress={onConfirm}>{confirmLabel}</Button></View>
      </View></View></Modal>;
}
export { Headline, Micro };
