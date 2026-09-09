// S-P-001: after sign-in, load the stores this person can act on and pick one.
import { Tabs, Redirect } from 'expo-router';
import { Text } from 'react-native';
import { useEffect } from 'react';
import { useMyStores } from '@bugsha/api';
import { Screen, ListRow, Notice, Button } from '@bugsha/ui';
import { db } from '../../src/lib/supabase';
import { useSession } from '../../src/lib/session';
import { useStore } from '../../src/lib/store';

export default function L() {
  const { userId } = useSession(); const store = useStore();
  const q = useMyStores(db, !!userId);
  useEffect(() => {
    const rows = q.data ?? [];
    if (rows.length === 1 && !store.storeId) store.set({ storeId: rows[0].store_id, partnerId: rows[0].partner_id, role: rows[0].role as any, storeName: rows[0].display_name });
  }, [q.data]);
  if (!userId) return <Redirect href="/signin" />;
  if (q.isLoading) return <Screen title="Bugsha Partner"><Text>…</Text></Screen>;
  if (!store.storeId) {
    const rows = q.data ?? [];
    return <Screen title="Choose a store">
      {rows.length === 0 && <Notice tone="warn">This account isn't assigned to any store yet. Ask your owner for an invite, or apply as a new partner.</Notice>}
      {rows.map((r) => <ListRow key={r.store_id} title={r.display_name} subtitle={`${r.trading_name} · ${r.role}`}
        onPress={() => store.set({ storeId: r.store_id, partnerId: r.partner_id, role: r.role as any, storeName: r.display_name })} />)}
      <Button tone="ghost" onPress={() => db.auth.signOut()}>Sign out</Button>
    </Screen>;
  }
  return <Tabs screenOptions={{ headerShown: false }}>
    <Tabs.Screen name="index" options={{ title: 'Today' }} /><Tabs.Screen name="redeem" options={{ title: 'Redeem' }} />
    <Tabs.Screen name="listings" options={{ title: 'Listings' }} /><Tabs.Screen name="money" options={{ title: 'Money' }} /></Tabs>;
}
