// §4.2 Orders board on the phone: grouped by window; hand over from the row.
import { router } from 'expo-router'; import { View } from 'react-native';
import { useOrdersBoard } from '@bugsha/api';
import { AppBar, Badge, EmptyState, Eyebrow, OrderRow, Screen, color, radius } from '@bugsha/ui';
import { db } from '../../src/lib/supabase'; import { useSession } from '../../src/lib/session'; import { useStore } from '../../src/lib/store'; import { hm, major, useL, CUR } from '../../src/lib/ui';
export default function Orders() {
  const s = useStore(); const { online } = useSession(); const { L } = useL(); const q = useOrdersBoard(db, s.storeId); const rows = (q.data ?? []) as any[];
  const groups = new Map<string, any[]>(); rows.forEach((o) => { const k = `${hm(o.window_start_utc, s.timezone)}–${hm(o.window_end_utc, s.timezone)}`; groups.set(k, [...(groups.get(k) ?? []), o]); });
  const st = (o: any) => (o.status === 'redeemed' ? 'collected' : o.status === 'no_show' ? 'no_show' : new Date(o.window_end_utc) < new Date() ? 'late' : 'waiting');
  return <View style={{ flex: 1 }}><AppBar title={L('Orders board', 'لوحة الطلبات')} sub={s.storeName} back={false} action={online ? <Badge tone="fresh">{L('Live', 'مباشر')}</Badge> : <Badge tone="urgent">{L('Offline — cached', 'غير متصل — مخزّن')}</Badge>} />
    <Screen top={false} gap={14}>{rows.length === 0 ? <EmptyState icon="package" title={L('No orders yet tonight', 'لا طلبات الليلة بعد')} body={L("Orders land here the second they're reserved.", 'تظهر الطلبات هنا فور حجزها.')} /> :
      [...groups.entries()].map(([win, list]) => <View key={win} style={{ gap: 8 }}><Eyebrow>{`${win} · ${list.length}`}</Eyebrow><View style={{ borderRadius: radius.card, overflow: 'hidden', borderWidth: 1, borderColor: color.borderSubtle }}>
        {list.map((o) => <OrderRow key={o.order_id} code={o.code} customer={o.customer_first_name ?? '—'} quantity={o.quantity} pickupBy={hm(o.window_end_utc, s.timezone)} status={st(o) as any} bagLabel={L(o.quantity > 1 ? 'bags' : 'bag', 'بقشة')} statusLabel={st(o) === 'collected' ? L('Collected', 'استُلمت') : st(o) === 'late' ? L('Late', 'متأخر') : st(o) === 'no_show' ? L('No-show', 'لم يحضر') : L('Waiting', 'بالانتظار')} actionLabel={L('Hand over', 'تسليم')} paymentMethod={o.method === 'cash' ? 'cash' : 'card'} paymentLabel={o.method === 'cash' ? L('Cash', 'نقدي') : L('Paid', 'مدفوع')} amountDue={o.method === 'cash' ? major(o.amount_due_minor, s.market) : null} currency={CUR[s.market].code} decimals={CUR[s.market].dp} onCheckIn={() => router.push({ pathname: '/redeem', params: { code: o.code } })} />)}</View></View>)}</Screen></View>;
}
