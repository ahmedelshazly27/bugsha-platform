// Consumer tab bar: Browse · Orders · Saved · Account (consumer kit Nav). Badge only for state the user must act on.
import { Redirect, Tabs } from 'expo-router'; import { Pressable, View } from 'react-native'; import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMyOrders } from '@bugsha/api';
import { Icon, Num, T, color } from '@bugsha/ui';
import { db } from '../../src/lib/supabase'; import { useSession } from '../../src/lib/session'; import { useL } from '../../src/lib/ui';
function Bar({ state, navigation }: any) {
  const insets = useSafeAreaInsets(); const { L } = useL(); const { userId } = useSession(); const orders = useMyOrders(db, !!userId) as any;
  const active = ((orders.data ?? []) as any[]).filter((o) => o.status === 'reserved' || o.status === 'held').length;
  const items = [['index', 'house', L('Browse', 'تصفّح'), 0], ['orders', 'receipt', L('Orders', 'طلباتي'), active], ['saved', 'heart', L('Saved', 'المحفوظة'), 0], ['account', 'user', L('Account', 'حسابي'), 0]] as const;
  return <View style={{ flexDirection: 'row', backgroundColor: color.raised, borderTopWidth: 1, borderColor: color.borderSubtle, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 12), paddingHorizontal: 8, gap: 2 }}>
    {items.map(([name, icon, label, badge]) => { const on = state.routes[state.index].name === name; return <Pressable key={name} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => navigation.navigate(name)} style={{ flex: 1, alignItems: 'center', gap: 4, minHeight: 44 }}>
      <View><Icon name={icon} size={22} color={on ? color.text : color.textTertiary} />{badge ? <View style={{ position: 'absolute', top: -6, end: -10, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 999, backgroundColor: color.deal, alignItems: 'center', justifyContent: 'center' }}><Num role="micro" color={color.dealOn} style={{ fontSize: 10, lineHeight: 12 }}>{String(badge)}</Num></View> : null}</View>
      <T role="micro" weight={on ? 600 : 400} color={on ? color.text : color.textTertiary}>{label}</T></Pressable>; })}</View>;
}
export default function TabLayout() { const { userId } = useSession(); if (!userId) return <Redirect href="/" />; return <Tabs tabBar={(p) => <Bar {...p} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.canvas } }}><Tabs.Screen name="index" /><Tabs.Screen name="orders" /><Tabs.Screen name="saved" /><Tabs.Screen name="account" /></Tabs>; }
