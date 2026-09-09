// Partner phone surface. After sign-in: pick the store you act on, then Today · Orders · Listings · More.
import { useEffect } from 'react'; import { Redirect, Tabs, router } from 'expo-router'; import { Pressable, View } from 'react-native'; import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMyStores, useOrdersBoard } from '@bugsha/api';
import { AppBar, Banner, Button, Caption, Icon, ListRow, Num, Screen, T, color } from '@bugsha/ui';
import { db } from '../../src/lib/supabase'; import { useSession } from '../../src/lib/session'; import { useStore } from '../../src/lib/store'; import { useL } from '../../src/lib/ui';
function Bar({ state, navigation }: any) {
  const insets = useSafeAreaInsets(); const { L } = useL(); const { storeId } = useStore(); const board = useOrdersBoard(db, storeId) as any;
  const waiting = ((board.data ?? []) as any[]).filter((o) => o.status === 'reserved').length;
  const items = [['index', 'house', L('Today', 'اليوم'), 0], ['orders', 'receipt', L('Orders', 'الطلبات'), waiting], ['listings', 'package', L('Listings', 'العروض'), 0], ['more', 'settings', L('More', 'المزيد'), 0]] as const;
  return <View style={{ flexDirection: 'row', backgroundColor: color.raised, borderTopWidth: 1, borderColor: color.borderSubtle, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 12), paddingHorizontal: 8 }}>
    {items.map(([name, icon, label, badge]) => { const on = state.routes[state.index].name === name; return <Pressable key={name} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => navigation.navigate(name)} style={{ flex: 1, alignItems: 'center', gap: 4, minHeight: 44 }}>
      <View><Icon name={icon} size={22} color={on ? color.text : color.textTertiary} />{badge ? <View style={{ position: 'absolute', top: -6, end: -10, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 999, backgroundColor: color.deal, alignItems: 'center', justifyContent: 'center' }}><Num role="micro" color={color.dealOn} style={{ fontSize: 10, lineHeight: 12 }}>{String(badge)}</Num></View> : null}</View>
      <T role="micro" weight={on ? 600 : 400} color={on ? color.text : color.textTertiary}>{label}</T></Pressable>; })}</View>;
}
export default function L_() {
  const { userId } = useSession(); const s = useStore(); const { L } = useL(); const q = useMyStores(db, !!userId);
  useEffect(() => { const only = (q.data ?? [])[0]; if (q.data?.length === 1 && only && !s.storeId) s.set({ storeId: only.store_id, partnerId: only.partner_id, role: only.role as any, storeName: only.display_name, tradingName: only.trading_name, market: only.market as any, timezone: only.timezone }); }, [q.data]);
  if (!userId) return <Redirect href="/signin" />;
  if (!s.storeId) { const rows = q.data ?? []; return <View style={{ flex: 1 }}><AppBar title={L('Choose a store', 'اختر متجراً')} back={false} />
    <Screen top={false} gap={0}>{q.isLoading ? <Caption>…</Caption> : rows.length === 0 ? <View style={{ gap: 12, paddingTop: 8 }}><Banner tone="info" title={L("This account isn't assigned to a store yet", 'هذا الحساب غير مرتبط بمتجر بعد')}>{L('Ask your owner to invite this email, or apply as a new partner.', 'اطلب من المالك دعوة هذا البريد، أو قدّم كشريك جديد.')}</Banner><Button variant="ghost" onPress={() => db.auth.signOut()}>{L('Sign out', 'تسجيل الخروج')}</Button></View>
      : rows.map((r) => <ListRow key={r.store_id} icon="store" label={r.display_name} sub={`${r.trading_name} · ${r.role}`} chevron onPress={() => s.set({ storeId: r.store_id, partnerId: r.partner_id, role: r.role as any, storeName: r.display_name, tradingName: r.trading_name, market: r.market as any, timezone: r.timezone })} />)}</Screen></View>; }
  return <Tabs tabBar={(p) => <Bar {...p} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.canvas } }}><Tabs.Screen name="index" /><Tabs.Screen name="orders" /><Tabs.Screen name="listings" /><Tabs.Screen name="more" /></Tabs>;
}
