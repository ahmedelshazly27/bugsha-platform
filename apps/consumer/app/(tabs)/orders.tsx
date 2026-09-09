// S-C-050 — order history, filtered. Active bags first; the tab badge counts them.
import { useState } from 'react'; import { router } from 'expo-router'; import { View } from 'react-native';
import { useMyOrders } from '@bugsha/api';
import { AppBar, EmptyState, ListRow, Num, Screen, SegmentedControl, T, color } from '@bugsha/ui';
import { db } from '../../src/lib/supabase'; import { useSession } from '../../src/lib/session'; import { money, useL } from '../../src/lib/ui';
export default function Orders() {
  const { market } = useSession(); const { L } = useL(); const q = useMyOrders(db); const [f, setF] = useState<'active' | 'collected' | 'other'>('active');
  const all = (q.data ?? []) as any[];
  const rows = all.filter((o) => f === 'active' ? ['held', 'reserved'].includes(o.status) : f === 'collected' ? o.status === 'redeemed' : !['held', 'reserved', 'redeemed'].includes(o.status));
  const status: Record<string, string> = { held: L('Held', 'محجوزة مؤقتاً'), reserved: L('Reserved', 'محجوزة'), redeemed: L('Collected', 'مستلمة'), no_show: L('Missed', 'فائتة'), cancelled_consumer: L('Cancelled', 'ملغاة'), cancelled_partner: L('Cancelled by store', 'ألغاها المتجر'), refunded: L('Refunded', 'مستردة') };
  return <View style={{ flex: 1 }}><AppBar title={L('Orders', 'الطلبات')} back={false} />
    <View style={{ paddingHorizontal: 14, paddingTop: 10 }}><SegmentedControl value={f} onChange={setF} options={[{ value: 'active', label: L('Active', 'الحالية') }, { value: 'collected', label: L('Collected', 'مستلمة') }, { value: 'other', label: L('Past', 'السابقة') }]} /></View>
    <Screen top={false} gap={0}>{rows.length === 0 ? <EmptyState icon="receipt" title={f === 'active' ? L('No bag reserved tonight', 'لا توجد بقشة محجوزة الليلة') : L('Nothing here yet', 'لا شيء هنا بعد')} body={f === 'active' ? L('Reserve one from Browse and your code will live here.', 'احجز واحدة من التصفّح وسيظهر رمزك هنا.') : undefined} actionLabel={f === 'active' ? L("Browse tonight's bags", 'تصفّح بقش الليلة') : undefined} onAction={() => router.navigate('/(tabs)')} />
      : rows.map((o) => <ListRow key={o.order_id} icon="receipt" label={<T role="label" weight={600}>{o.title_snapshot}</T>} sub={<View style={{ flexDirection: 'row', gap: 4 }}><Num role="caption" color={color.textSecondary}>{o.code}</Num><T role="caption" color={color.textSecondary}>{`· ${status[o.status] ?? o.status}`}</T></View>} value={<Num role="label" weight={600}>{money(o.total_minor, market)}</Num>} chevron onPress={() => router.push(`/order/${o.order_id}`)} />)}</Screen></View>;
}
