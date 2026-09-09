// S-C-040..047 — held: pay within the hold. Reserved: the code, legible at arm's length, works with no signal. Redeemed: review.
import { useEffect, useState } from 'react'; import { router, useLocalSearchParams } from 'expo-router'; import { View } from 'react-native';
import { useCancelOrder, useOrder, useReleaseHold, useSubmitReview } from '@bugsha/api'; import { refundTimingMessage } from '@bugsha/i18n';
import { AppBar, Banner, Button, Caption, Card, CountdownPill, Dialog, Foot, Icon, IconButton, Num, PickupWindow, RatingStars, RedemptionCode, Screen, T, color } from '@bugsha/ui';
import { db } from '../../src/lib/supabase'; import { useSession } from '../../src/lib/session'; import { cdFmt, minutesLeft, money, useL } from '../../src/lib/ui';
export default function Order() {
  const { id } = useLocalSearchParams<{ id: string }>(); const { market, locale } = useSession(); const { L, ar } = useL();
  const q = useOrder(db, id!); const release = useReleaseHold(db); const cancel = useCancelOrder(db); const review = useSubmitReview(db);
  const [confirm, setConfirm] = useState(false); const [tick, setTick] = useState(0); useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);
  const d = q.data as any; if (!d) return <Screen><Caption>…</Caption></Screen>;
  const o = d.order, st = d.store; const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: st.timezone });
  const win = `${hm(o.window_start_utc)}–${hm(o.window_end_utc)}`; const mins = minutesLeft(o.window_end_utc); void tick;
  const canCancel = o.status === 'reserved' && new Date() < new Date(d.cancellation_cutoff_at);
  const pickupCard = <Card><View style={{ gap: 10 }}><PickupWindow day={L('Tonight', 'الليلة')} from={hm(o.window_start_utc)} to={hm(o.window_end_utc)} size="lg" />
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="navigation" size={15} color={color.textSecondary} /><T role="label" color={color.textSecondary} style={{ flex: 1 }}>{ar ? st.pickup_point_ar : st.pickup_point_en}</T></View></View></Card>;
  if (o.status === 'held') return <View style={{ flex: 1 }}><AppBar title={L('Complete your reservation', 'أكمل حجزك')} onBack={() => router.back()} />
    <Screen top={false} pad={16}><Banner tone="time" title={L('Held for 10 minutes', 'محجوزة لعشر دقائق')}>{L('Pay to confirm. The bag goes back on the shelf if the hold expires.', 'ادفع للتأكيد. تعود البقشة للعرض إذا انتهى وقت الحجز.')}</Banner>
      <Card><View style={{ gap: 6 }}><T weight={600}>{o.title_snapshot}</T><Caption>{st.display_name}</Caption><View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T role="label" color={color.textSecondary}>{L('Total', 'الإجمالي')}</T><Num weight={700}>{money(o.total_minor, market)}</Num></View></View></Card>{pickupCard}</Screen>
    <Foot><Button size="lg" fullWidth onPress={() => router.push({ pathname: '/pay', params: { order: id } })}>{L(`Pay ${money(o.total_minor, market)}`, `ادفع ${money(o.total_minor, market)}`)}</Button><Button variant="ghost" fullWidth onPress={() => release.mutateAsync(id!).then(() => router.back())}>{L('Release the bag', 'إلغاء الحجز')}</Button></Foot></View>;
  const reserved = o.status === 'reserved', redeemed = o.status === 'redeemed';
  return <View style={{ flex: 1 }}><AppBar title={redeemed ? L('Collected', 'تم الاستلام') : reserved ? L('Reserved', 'محجوزة') : L('Order', 'الطلب')} onBack={() => router.back()} action={<IconButton icon="info" label={L('Help', 'مساعدة')} />} />
    <Screen top={false} pad={16} gap={14}>
      {reserved || redeemed ? <>
        <T align="center" color={color.textSecondary}>{redeemed ? L('Enjoy it.', 'بالعافية.') : L('Show this at the counter', 'أظهر هذا عند الكاشير')}</T>
        <RedemptionCode code={o.code} partner={st.display_name} window={win} quantity={o.quantity} state={redeemed ? 'redeemed' : 'ready'} bagLabel={o.quantity > 1 ? L('bags', 'بقش') : L('bag', 'بقشة')} slideLabel={L('Staff confirms on their device', 'الموظف يؤكد من جهازه')} doneLabel={L('Collected', 'تم الاستلام')} />
        {reserved ? <View style={{ alignItems: 'center' }}><CountdownPill state="reserved" minutesLeft={mins} format={cdFmt(ar)} /></View> : null}
        {pickupCard}
        {reserved ? <Card style={{ backgroundColor: color.brandTint, borderColor: 'transparent' }}><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><Icon name="clock" size={22} color={color.brand} /><View style={{ flex: 1 }}><T weight={600}>{L('Running late?', 'متأخر؟')}</T><Caption>{L(`Call the store on ${st.contact_phone} — they can hold your bag a little longer.`, `اتصل بالمتجر على ${st.contact_phone} — يمكنهم الاحتفاظ ببقشتك قليلاً.`)}</Caption></View></View></Card> : null}
        {redeemed && !d.review ? <Card><View style={{ gap: 8, alignItems: 'center' }}><T weight={600}>{L('How was the bag?', 'كيف كانت البقشة؟')}</T><RatingStars value={0} size={28} onRate={(n) => review.mutateAsync({ orderId: id!, rating: n }).then(() => q.refetch())} /></View></Card> : null}
      </> : null}
      {o.status === 'no_show' ? <Banner tone="info" title={L('Not collected', 'لم تُستلم')}>{L('The window closed before pickup. No refund is due for a missed bag.', 'انتهى الوقت قبل الاستلام. لا يُسترد مبلغ البقشة الفائتة.')}</Banner> : null}
      {['cancelled_consumer', 'cancelled_partner', 'refunded'].includes(o.status) ? <Banner tone="info" title={L('Cancelled', 'ملغاة')}>{refundTimingMessage(market, String(d.refund_timing_key ?? '').split('.')[1] ?? o.method, locale)}</Banner> : null}
      {canCancel ? <Button variant="ghost" fullWidth onPress={() => setConfirm(true)}>{L('Cancel bag', 'إلغاء البقشة')}</Button> : null}
    </Screen>
    <Dialog open={confirm} title={L('Cancel this bag?', 'إلغاء هذه البقشة؟')} body={L('The bag goes back on sale and your payment is refunded to where it came from.', 'تعود البقشة للبيع ويُسترد المبلغ إلى وسيلة الدفع.')} confirmLabel={L('Cancel bag', 'إلغاء البقشة')} cancelLabel={L('Keep it', 'الإبقاء عليها')} tone="danger" onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); cancel.mutateAsync({ orderId: id!, reasonCode: 'consumer_request' }).then(() => q.refetch()); }} /></View>;
}
