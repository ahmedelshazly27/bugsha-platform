// S-C-030 — bag detail. Price stated as a win next to what it's worth; the window is a promise; contents are never promised.
import { useState } from 'react'; import { router, useLocalSearchParams } from 'expo-router'; import { View } from 'react-native';
import { useHold, useListing, RpcError } from '@bugsha/api'; import { errorMessage } from '@bugsha/i18n';
import { Badge, Banner, Button, Caption, Card, Chip, Chips, CountdownPill, CoverPlate, Foot, Icon, IconButton, Num, PickupWindow, Pp, PriceTag, RatingStars, Rule, Screen, Stepper, T, color, space } from '@bugsha/ui';
import { db } from '../../src/lib/supabase'; import { useSession } from '../../src/lib/session'; import { bagTitle, cdFmt, major, minutesLeft, useL, CUR } from '../../src/lib/ui';
export default function Listing() {
  const { id } = useLocalSearchParams<{ id: string }>(); const { market, locale } = useSession(); const { L, ar } = useL();
  const q = useListing(db, id!); const hold = useHold(db); const [qty, setQty] = useState(1); const [err, setErr] = useState<string | null>(null);
  const l = ((q.data as any[]) ?? [])[0]; if (!l) return <Screen><Caption>…</Caption></Screen>;
  const cur = CUR[market]; const mins = minutesLeft(l.window_end_utc); const from = new Date(l.window_start_utc), to = new Date(l.window_end_utc);
  const hm = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: l.timezone });
  const total = major(l.price_minor, market) * qty; const soldOut = l.quantity_remaining <= 0;
  async function reserve() { try { const o = (await hold.mutateAsync({ listingId: id!, quantity: qty })) as any; router.push(`/order/${o.order_id}`); } catch (e) { setErr(errorMessage((e as RpcError).code, locale)); } }
  return <View style={{ flex: 1, backgroundColor: color.canvas }}>
    <CoverPlate category={l.category} height={190} radius={0} label={undefined}>
      <View style={{ position: 'absolute', top: 54, start: 8 }}><IconButton icon="arrow-left" mirror variant="solid" label={L('Back', 'رجوع')} onPress={() => router.back()} /></View>
      <View style={{ position: 'absolute', top: 54, end: 8, flexDirection: 'row', gap: 6 }}><IconButton icon="heart" variant="solid" label={L('Save', 'حفظ')} /><IconButton icon="share-2" variant="solid" label={L('Share', 'مشاركة')} /></View>
      {soldOut ? <View style={{ position: 'absolute', inset: 0 as any, backgroundColor: color.overlay, alignItems: 'center', justifyContent: 'center' }}><Badge tone="neutral" uppercase>{L('Sold out tonight', 'نفدت الليلة')}</Badge></View> : null}
    </CoverPlate>
    <Screen top={false} gap={12}>
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><T role="title" weight={700} style={{ flex: 1 }}>{l.store_name}</T>{mins <= 60 ? <CountdownPill minutesLeft={mins} format={cdFmt(ar)} /> : null}</View>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Badge tone="fresh">{L('Verified', 'موثّق')}</Badge>{Number(l.rating) ? <RatingStars value={Number(l.rating)} count={Number(l.rating_count)} /> : null}</View>
        <Caption>{`${bagTitle(l.category, ar)} · ${l.quantity_remaining <= 1 ? L('Last one', 'الأخيرة') : L(`${l.quantity_remaining} left`, `باقي ${l.quantity_remaining}`)}`}</Caption></View>
      <Card><View style={{ gap: 10 }}>
        <PickupWindow day={L('Tonight', 'الليلة')} from={hm(from)} to={hm(to)} size="lg" />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="navigation" size={15} color={color.textSecondary} /><T role="label" color={color.textSecondary} style={{ flex: 1 }}>{ar ? l.pickup_point_ar : l.pickup_point_en}</T></View>
        <Caption>{L('Show your code at the counter inside the pickup window.', 'أظهر رمزك عند الكاشير ضمن وقت الاستلام.')}</Caption></View></Card>
      <View style={{ gap: 8 }}><T role="headline" weight={700}>{L("What's in the bag", 'ما الذي في البقشة')}</T>
        <Pp>{l.description || L("Whatever the kitchen made today and didn't sell. Contents change nightly — that's the point. Ask at the counter for allergens on any item.", 'ما صنعه المطبخ اليوم ولم يُبع. المحتويات تتغير كل ليلة — هذه الفكرة. اسأل عند الكاشير عن مسببات الحساسية.')}</Pp>
        {(l.dietary_flags ?? []).length ? <Chips>{(l.dietary_flags as string[]).map((f) => <Chip key={f}>{f.replace(/_/g, ' ')}</Chip>)}</Chips> : null}</View>
      <Rule />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[150] }}><PriceTag now={major(l.price_minor, market)} was={l.value_min_minor ? major(l.value_min_minor, market) : null} currency={cur.code} decimals={cur.dp} size="lg" /><Stepper value={qty} min={1} max={Math.max(1, Math.min(3, l.quantity_remaining))} onChange={setQty} /></View>
      {err ? <Banner tone="error" title={err} /> : null}
    </Screen>
    <Foot><Button size="lg" fullWidth disabled={soldOut} loading={hold.isPending} onPress={reserve}>{L(`Reserve for ${cur.code} ${total.toFixed(cur.dp)}`, `احجز بـ ${cur.code} ${total.toFixed(cur.dp)}`)}</Button>
      <Caption align="center">{L('Nothing is charged yet. You have 10 minutes to pay.', 'لا يُخصم شيء بعد. لديك 10 دقائق للدفع.')}</Caption></Foot></View>;
}
