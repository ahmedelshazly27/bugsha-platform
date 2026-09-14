import { useRef, useState, type ReactNode } from 'react';
import { Animated, Image, PanResponder, Pressable, View, type ViewStyle } from 'react-native';
import { Badge } from './core';
import { Icon } from './icon';
import { Caption, Headline, Label, Num, T, Title } from './text';
import { color as C, radius, shadow, size, space } from './tokens';
import { isRTL } from './fonts';

const GLYPH: Record<string, string> = { bakery: 'croissant', cafe: 'coffee', meals: 'utensils', grocery: 'shopping-bag', sweets: 'croissant', other: 'package' };
/** Imagery policy in one component: a real partner photo when one exists, otherwise an honest category plate. Never stock food. */
export function CoverPlate({ src, category = 'other', height = 140, label, radius: r = radius.image, children, style }: { src?: string | null; category?: string; height?: number; label?: string; radius?: number; children?: ReactNode; style?: ViewStyle }) {
  return <View style={[{ height, borderRadius: r, overflow: 'hidden', backgroundColor: src ? C.sunken : C.brandTint, alignItems: 'center', justifyContent: 'center' }, style]}>
    {src ? <Image source={{ uri: src }} accessibilityLabel={label} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
      : <View style={{ alignItems: 'center', gap: 6 }}><Icon name={GLYPH[category] ?? 'package'} size={28} color={C.textSecondary} />{label ? <T role="micro" color={C.textSecondary} tracking={0.9}>{label.toUpperCase()}</T> : null}</View>}
    {children}
  </View>;
}
/** Deal price with struck original. KD always shows three decimals — the fils are the proof. Always LTR. */
export function PriceTag({ now, was, currency = 'KD', decimals = 3, size: sz = 'md', showPercent = true }: { now: number; was?: number | null; currency?: string; decimals?: number; size?: 'md' | 'lg'; showPercent?: boolean }) {
  const fmt = (n: number) => `${currency} ${n.toFixed(decimals)}`; const pct = was ? Math.round((1 - now / was) * 100) : null;
  return <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: space[100], direction: 'ltr' }}>
    <Num role={sz === 'lg' ? 'numericXl' : 'title'} weight={700} style={{ lineHeight: sz === 'lg' ? 36 : 24 }}>{fmt(now)}</Num>
    {was != null ? <Num role="label" color={C.textTertiary} style={{ textDecorationLine: 'line-through' }}>{fmt(was)}</Num> : null}
    {showPercent && pct != null ? <Num role="caption" weight={600} color={C.deal}>{`−${pct}%`}</Num> : null}
  </View>;
}
/** Time-remaining pill. Tone escalates by real time only: >60 neutral · 15–60 time · <15 urgent. */
export function CountdownPill({ minutesLeft, label, format, state = 'browse', style }: { minutesLeft?: number | null; label?: string; format?: (m: number) => string; state?: 'browse' | 'reserved'; style?: ViewStyle }) {
  const m = minutesLeft ?? null; const urgent = m != null && m <= 15; const soon = m != null && m <= 60;
  const [bg, fg] = urgent ? [C.timeUrgentTint, C.timeUrgent] : soon ? [C.timeTint, C.time] : state === 'reserved' ? [C.freshTint, C.fresh] : [C.sunken, C.textSecondary];
  const txt = label ?? (m == null ? '' : format ? format(m) : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m} min left`);
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space[75], paddingVertical: 4, paddingHorizontal: space[100], borderRadius: radius.chip, backgroundColor: bg, alignSelf: 'flex-start' }, style]}>
    <Icon name={state === 'reserved' ? 'timer' : 'clock'} size={13} color={fg} /><Num role="caption" weight={600} color={fg}>{txt}</Num></View>;
}
/** Collect-between display. The window is a promise: always shown in full, never truncated. */
export function PickupWindow({ day = 'Tonight', from, to, note, size: sz = 'md' }: { day?: string; from: string; to: string; note?: string; size?: 'md' | 'lg' }) {
  const big = sz === 'lg';
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[100] }}>
    <Icon name="clock" size={big ? 20 : 16} color={C.textSecondary} />
    <View><View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}><T role={big ? 'bodyLg' : 'label'} weight={600}>{day}</T><Num role={big ? 'bodyLg' : 'label'} weight={600}>{`${from}–${to}`}</Num></View>{note ? <Caption>{note}</Caption> : null}</View></View>;
}
export interface BagCardProps { partner: string; title?: string; category?: string; cover?: string | null; priceNow: number; priceWas?: number | null; currency?: string; decimals?: number; day?: string; from: string; to: string; distanceKm?: number | null; bagsLeft?: number | null; leftFormat?: (n: number) => string; rating?: number | null; ratingCount?: number | null; tags?: string[]; minutesLeft?: number | null; countdownFormat?: (m: number) => string; saved?: boolean; layout?: 'card' | 'row' | 'hero'; onPress?: () => void; onSave?: () => void; style?: ViewStyle }
/** The core object of the marketplace. Reading order: partner → bag type → window → distance → price against worth → bags left. */
export function BagCard({ partner, title = 'Surprise bag', category = 'other', cover, priceNow, priceWas, currency = 'KD', decimals = 3, day, from, to, distanceKm, bagsLeft, leftFormat, rating, ratingCount, tags = [], minutesLeft, countdownFormat, saved, layout = 'card', onPress, onSave, style }: BagCardProps) {
  const row = layout === 'row', hero = layout === 'hero';
  const meta = <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[150], flexWrap: 'wrap' }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Icon name="clock" size={13} color={C.textSecondary} /><Num role="caption" color={C.textSecondary}>{`${from}–${to}`}</Num></View>
    {distanceKm != null ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Icon name="map-pin" size={13} color={C.textSecondary} /><Num role="caption" color={C.textSecondary}>{`${distanceKm.toFixed(1)} km`}</Num></View> : null}
    {rating != null ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Icon name="star" size={13} color={C.textSecondary} fill={C.textSecondary} /><Num role="caption" color={C.textSecondary}>{rating.toFixed(1) + (ratingCount ? ` (${ratingCount})` : '')}</Num></View> : null}
  </View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${partner}, ${title}, ${currency} ${priceNow.toFixed(decimals)}, ${from} to ${to}`} onPress={onPress}
    style={({ pressed }) => [{ flexDirection: row ? 'row' : 'column', gap: row ? space[150] : 0, backgroundColor: C.raised, borderRadius: radius.card, overflow: 'hidden', borderWidth: 1, borderColor: C.borderSubtle, opacity: pressed ? 0.93 : 1, ...shadow.card }, style]}>
    <CoverPlate src={cover} category={category} label={!cover ? category : undefined} height={row ? 96 : hero ? 200 : 132} radius={0} style={{ width: row ? 96 : undefined }}>
      <View style={{ position: 'absolute', top: 8, start: 8, flexDirection: 'row', gap: 6 }}>
        {bagsLeft != null && bagsLeft <= 3 ? <Badge tone="urgent">{leftFormat ? leftFormat(bagsLeft) : `${bagsLeft} left`}</Badge> : null}
        {day && !row ? <Badge tone="neutral">{day}</Badge> : null}</View>
      {saved != null && !row ? <Pressable onPress={onSave} accessibilityLabel="Save" style={{ position: 'absolute', top: 8, end: 8, width: 32, height: 32, borderRadius: 999, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center' }}><Icon name="heart" size={16} color={saved ? C.deal : C.textSecondary} fill={saved ? C.deal : 'none'} /></Pressable> : null}
    </CoverPlate>
    <View style={{ flex: 1, minWidth: 0, padding: space[150], paddingStart: row ? 0 : space[150], gap: space[75] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[100] }}>
        <T role={hero ? 'title' : 'headline'} weight={600} numberOfLines={row ? 2 : 1} style={{ flex: 1, minWidth: 0 }}>{partner}</T>
        {minutesLeft != null ? <View style={{ flexShrink: 0 }}><CountdownPill minutesLeft={minutesLeft} format={countdownFormat} /></View> : null}</View>
      <Label color={C.textSecondary}>{title}</Label>
      {meta}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: space[100], marginTop: 2 }}>
        <PriceTag now={priceNow} was={priceWas} currency={currency} decimals={decimals} size={hero ? 'lg' : 'md'} />
        <View style={{ flexDirection: 'row', gap: 4 }}>{tags.slice(0, 2).map((t) => <Badge key={t} tone="neutral">{t}</Badge>)}</View></View>
    </View>
  </Pressable>;
}
const PM: Record<string, [string, string, string]> = { knet: ['KNET', 'credit-card', "Opens your bank's page"], apple_pay: ['Apple Pay', 'wallet', 'Face ID'], card: ['Visa / Mastercard', 'credit-card', 'Saved card'], cash: ['Cash on pickup', 'banknote', 'Pay the store when you collect'], wallet: ['Mobile wallet', 'wallet', 'Vodafone Cash, Orange, Etisalat'], instapay: ['InstaPay', 'credit-card', 'Bank transfer'], fawry: ['Fawry', 'receipt', 'Pay at any Fawry point'], wallet_credit: ['Bugsha credit', 'wallet', 'Applied automatically'] };
/** Payment selector. KNET first and it always says it redirects — the redirect is not a failure state. Cash is a first-class row, same weight. */
export function PaymentMethodRow({ method, selected, onSelect, label, hint, detail }: { method: string; selected?: boolean; onSelect?: () => void; label?: string; hint?: string; detail?: string }) {
  const [dl, icon, dh] = PM[method] ?? PM.card!;
  return <Pressable accessibilityRole="radio" accessibilityState={{ selected: !!selected }} onPress={onSelect}
    style={{ minHeight: size.controlLg, padding: space[150], flexDirection: 'row', alignItems: 'center', gap: space[150], backgroundColor: C.raised, borderRadius: radius.control, borderWidth: 1.5, borderColor: selected ? C.focus : C.border }}>
    <Icon name={icon} size={20} /><View style={{ flex: 1 }}><T weight={600}>{label ?? dl}</T><Caption>{detail ?? hint ?? dh}</Caption></View>{selected ? <Icon name="check" size={18} color={C.brand} /> : null}</Pressable>;
}
/** The pickup screen. White ground, big mono code, legible at arm's length; the confirm gesture is a deliberate slide, never a tap. */
export function RedemptionCode({ code, partner, window: win, quantity = 1, state = 'ready', onRedeem, bagLabel, slideLabel = 'Slide when staff is ready', doneLabel = 'Collected' }: { code: string; partner: string; window: string; quantity?: number; state?: 'ready' | 'redeemed'; onRedeem?: () => void; bagLabel?: string; slideLabel?: string; doneLabel?: string }) {
  const done = state === 'redeemed';
  return <View style={{ alignItems: 'center', gap: space[200], padding: space[300], backgroundColor: done ? C.freshTint : '#FFFFFF', borderRadius: radius.card, borderWidth: 1, borderColor: C.borderSubtle, ...shadow.card }}>
    <Label color={C.textSecondary}>{partner}</Label>
    <Num role="code" weight={700} tracking={4} style={{ fontSize: 44, lineHeight: 52, color: '#17141F' }}>{code}</Num>
    <View style={{ flexDirection: 'row', gap: 6 }}><Caption>{`${quantity} ${bagLabel ?? (quantity > 1 ? 'bags' : 'bag')}`}</Caption><Caption>·</Caption><Num role="caption" color={C.textSecondary}>{win}</Num></View>
    {done ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="circle-check" size={22} color={C.fresh} /><T weight={600} color={C.fresh}>{doneLabel}</T></View> : <SlideToConfirm label={slideLabel} onConfirm={onRedeem} />}
  </View>;
}
/** Slide-to-confirm control: 52pt track, knob travels the full width before firing. */
export function SlideToConfirm({ label, onConfirm }: { label: string; onConfirm?: () => void }) {
  const x = useRef(new Animated.Value(0)).current; const [w, setW] = useState(0); const knob = 40; const max = Math.max(0, w - knob - 12); const dir = isRTL() ? -1 : 1;
  const pan = useRef(PanResponder.create({ onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (_, g) => x.setValue(Math.min(max, Math.max(0, g.dx * dir))),
    onPanResponderRelease: (_, g) => { if (g.dx * dir >= max * 0.85 && max > 0) { onConfirm?.(); Animated.timing(x, { toValue: 0, duration: 200, useNativeDriver: true }).start(); } else Animated.spring(x, { toValue: 0, useNativeDriver: true }).start(); } })).current;
  return <View onLayout={(e) => setW(e.nativeEvent.layout.width)} accessibilityRole="adjustable" accessibilityLabel={label} style={{ alignSelf: 'stretch', height: size.controlLg, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, backgroundColor: C.brand, borderRadius: radius.control, borderWidth: 1, borderColor: C.borderStrong }}>
    <Animated.View {...pan.panHandlers} style={{ width: knob, height: knob, borderRadius: radius.control, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center', transform: [{ translateX: Animated.multiply(x, dir) }] }}><Icon name="arrow-right" size={18} mirror /></Animated.View>
    <T weight={600} color={C.textOnBrand} align="center" style={{ flex: 1 }}>{label}</T></View>;
}
/** Post-pickup satisfaction, not a lecture. Facts only. */
export function ImpactStat({ icon = 'leaf', value, unit, label, tone = 'fresh', style }: { icon?: string; value: string; unit?: string; label: string; tone?: 'fresh' | 'brand'; style?: ViewStyle }) {
  return <View style={[{ gap: 4, padding: space[200], borderRadius: radius.card, backgroundColor: tone === 'fresh' ? C.freshTint : C.brandTint, borderWidth: 1, borderColor: C.borderSubtle }, style]}>
    <Icon name={icon} size={20} color={tone === 'fresh' ? C.fresh : C.brand} />
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}><Num role="numericXl" weight={700} style={{ lineHeight: 36 }}>{value}</Num>{unit ? <T>{unit}</T> : null}</View><Caption>{label}</Caption></View>;
}
export function MapPin({ price, currency = 'KD', decimals = 3, selected, soldOut }: { price: number; currency?: string; decimals?: number; selected?: boolean; soldOut?: boolean }) {
  return <View style={{ paddingVertical: 6, paddingHorizontal: space[150], borderRadius: radius.pill, backgroundColor: soldOut ? C.sunken : selected ? C.inverse : C.raised, borderWidth: 1.5, borderColor: selected ? C.borderStrong : C.border, ...shadow.card }}>
    <Num role="label" weight={700} color={soldOut ? C.textTertiary : selected ? C.textInverse : C.text} style={{ textDecorationLine: soldOut ? 'line-through' : 'none' }}>{`${currency} ${price.toFixed(decimals)}`}</Num></View>;
}
export { Headline as BagHeadline, Title as BagTitle };
