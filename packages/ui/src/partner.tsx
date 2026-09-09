import type { ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { Badge } from './core';
import { Icon } from './icon';
import { Caption, Label, Micro, Num, T } from './text';
import { color as C, radius, shadow, size, space } from './tokens';

/** One line on tonight's orders board. Readable from a metre away on a counter tablet. Cash orders carry a leading accent and the exact amount to collect. */
export function OrderRow({ code, customer, quantity = 1, pickupBy, status = 'waiting', bagLabel, statusLabel, actionLabel = 'Hand over', paymentMethod, paymentLabel, amountDue, currency = 'KD', decimals = 3, onCheckIn }: { code: string; customer: string; quantity?: number; pickupBy: string; status?: 'waiting' | 'late' | 'collected' | 'no_show'; bagLabel?: string; statusLabel?: string; actionLabel?: string; paymentMethod?: string; paymentLabel?: string; amountDue?: number | null; currency?: string; decimals?: number; onCheckIn?: () => void }) {
  const tone = status === 'collected' ? 'fresh' : status === 'late' ? 'urgent' : 'neutral'; const cash = paymentMethod === 'cash';
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[200], paddingVertical: space[150], paddingHorizontal: space[200], backgroundColor: C.raised, borderBottomWidth: 1, borderColor: C.borderSubtle, borderStartWidth: cash ? 3 : 0, borderStartColor: C.brand }}>
    <Num role="title" weight={700} tracking={1.2} style={{ minWidth: 96 }}>{code}</Num>
    <View style={{ flex: 1, minWidth: 0 }}><T weight={600}>{customer}</T><View style={{ flexDirection: 'row', gap: 4 }}><Num role="caption" color={C.textSecondary}>{String(quantity)}</Num><Caption>{`${bagLabel ?? (quantity > 1 ? 'bags' : 'bag')} ·`}</Caption><Num role="caption" color={C.textSecondary}>{pickupBy}</Num></View></View>
    {paymentMethod ? <View style={{ alignItems: 'flex-end', gap: 2 }}><Badge tone={cash ? 'deal' : 'fresh'}>{paymentLabel ?? (cash ? 'Cash' : 'Paid')}</Badge>{amountDue != null ? <Num weight={700}>{`${amountDue.toFixed(decimals)} ${currency}`}</Num> : null}</View> : null}
    <Badge tone={tone} uppercase>{statusLabel ?? status.replace('_', ' ')}</Badge>
    {status !== 'collected' ? <Pressable accessibilityRole="button" onPress={onCheckIn} style={({ pressed }) => ({ minHeight: size.controlMd, paddingHorizontal: space[200], justifyContent: 'center', backgroundColor: pressed ? C.brandPress : C.brand, borderRadius: radius.control })}><T weight={600} color={C.textOnBrand}>{actionLabel}</T></Pressable> : <Icon name="circle-check" size={22} color={C.fresh} />}
  </View>;
}
/** Dashboard KPI tile. Density over expressiveness — the partner side never decorates a number. */
export function PartnerStat({ label, value, sub, icon, tone = 'neutral', style }: { label: string; value: string; sub?: string; icon?: string; tone?: 'neutral' | 'fresh' | 'urgent'; style?: ViewStyle }) {
  return <View style={[{ gap: 6, padding: space[200], backgroundColor: C.raised, borderRadius: radius.card, borderWidth: 1, borderColor: C.borderSubtle, flex: 1 }, style]}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>{icon ? <Icon name={icon} size={14} color={C.textSecondary} /> : null}<Caption>{label}</Caption></View>
    <Num role="titleLg" weight={700} color={tone === 'fresh' ? C.fresh : tone === 'urgent' ? C.timeUrgent : C.text} numberOfLines={1}>{value}</Num>
    {sub ? <Num role="micro" color={C.textTertiary}>{sub}</Num> : null}</View>;
}
/** Weekly payout summary — the number a finance lead checks first. */
export function PayoutCard({ amount, currency = 'KD', decimals = 3, period, note, onPress }: { amount: number; currency?: string; decimals?: number; period: string; note?: string; onPress?: () => void }) {
  return <Pressable disabled={!onPress} onPress={onPress} style={{ gap: space[150], padding: space[300], backgroundColor: C.raised, borderRadius: radius.card, borderWidth: 1, borderColor: C.borderSubtle, ...shadow.card }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="banknote" size={18} color={C.textSecondary} /><Label color={C.textSecondary}>{period}</Label></View>
    <Num role="display" weight={700} style={{ lineHeight: 36 }}>{`${amount.toFixed(decimals)} ${currency}`}</Num>{note ? <Num role="caption" color={C.textSecondary}>{note}</Num> : null}</Pressable>;
}
/** One line of the regulator-facing compliance ledger. */
export function LedgerRow({ orderId, listedAt, windowEnd, collectedAt, attested, head }: { orderId: string; listedAt: string; windowEnd: string; collectedAt?: string | null; attested?: boolean; head?: boolean }) {
  const cell = (v: string, dim?: boolean) => head ? <Micro tracking={0.9} style={{ flex: 1 }}>{v.toUpperCase()}</Micro> : <Num role="caption" color={dim ? C.textSecondary : C.text} style={{ flex: 1 }}>{v}</Num>;
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[150], paddingVertical: space[100], paddingHorizontal: space[200], backgroundColor: head ? C.sunken : C.raised, borderBottomWidth: 1, borderColor: head ? C.border : C.borderSubtle }}>
    {head ? cell(orderId) : <Num role="caption" weight={600} style={{ flex: 1.1 }}>{orderId}</Num>}{cell(listedAt, true)}{cell(windowEnd, true)}{cell(collectedAt ?? (head ? '' : '—'), !collectedAt)}
    {head ? <View style={{ width: 16 }} /> : <Icon name={attested ? 'circle-check' : 'triangle-alert'} size={16} color={attested ? C.fresh : C.time} />}</View>;
}
/** One step of the 60-second listing flow. Big targets, one decision per step. */
export function ListingStep({ index, total, title, hint, children, done }: { index: number; total: number; title: string; hint?: string; children?: ReactNode; done?: boolean }) {
  return <View style={{ gap: space[150], padding: space[200], backgroundColor: C.raised, borderRadius: radius.card, borderWidth: 1, borderColor: done ? C.fresh : C.borderSubtle }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[150] }}>
      <View style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: radius.chip, backgroundColor: done ? C.fresh : C.sunken }}>{done ? <Icon name="check" size={15} color="#fff" /> : <Num role="caption" weight={700} color={C.textSecondary}>{String(index)}</Num>}</View>
      <View style={{ flex: 1 }}><T role="headline" weight={600}>{title}</T>{hint ? <Caption>{hint}</Caption> : null}</View><Num role="caption" color={C.textTertiary}>{`${index}/${total}`}</Num></View>
    {children}</View>;
}
