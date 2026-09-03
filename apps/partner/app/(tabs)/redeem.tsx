// S-P-020..024 — redemption. Works with NO network: confirm immediately, queue, sync on reconnect.
import { useEffect, useState } from 'react'; import { Text } from 'react-native'; import NetInfo from '@react-native-community/netinfo';
import { redeemOffline } from '@bugsha/offline'; import { Screen, Field, Button, Notice, RedemptionCode } from '@bugsha/ui';
import { db } from '../../src/lib/supabase'; import { useStore } from '../../src/lib/store'; import { useSession } from '../../src/lib/session';
import { SqliteOfflineStore } from '../../src/offline/store'; import { drain, hashCode, refreshMirror } from '../../src/offline/sync';

export default function Redeem() {
  const { storeId } = useStore(); const { userId, online, set } = useSession();
  const [store, setStore] = useState<SqliteOfflineStore | null>(null); const [code, setCode] = useState(''); const [result, setResult] = useState<string | null>(null);
  useEffect(() => { SqliteOfflineStore.open().then(async (s) => { await s.load(); setStore(s); }); }, []);
  useEffect(() => NetInfo.addEventListener(async (n) => { const on = !!n.isConnected; set({ online: on }); if (on && store) { await drain(db, store); await refreshMirror(db, store, storeId); } }), [store, storeId]);
  useEffect(() => { if (store && online) refreshMirror(db, store, storeId); }, [store, online]);

  async function go() {
    if (!store) return; const hashed = await hashCode(code);
    const r = redeemOffline(store, { code, staffUserId: userId!, now: new Date(), hash: () => hashed });
    if (!r.ok) return setResult(r.code === 'BG110' ? 'Not found' : r.code === 'BG111' ? 'Window not open yet' : 'Window closed — use late redemption');
    setResult(r.alreadyRedeemed ? `Already collected — taken by ${r.redeemedBy}` : `CONFIRMED${r.lateGrace ? ' (late)' : ''}`);
    if (online) drain(db, store);
  }
  return <Screen title="Redeem">
    {!online && <Notice tone="warn">Offline — redemptions are confirmed here and sent when you reconnect.</Notice>}
    <Field label="Code" value={code} onChangeText={(v) => setCode(v.toUpperCase())} autoCapitalize="characters" />
    <Button onPress={go}>Collect</Button>
    {result && <Notice tone={result.startsWith('CONFIRMED') ? 'success' : 'warn'}>{result}</Notice>}
    {store && <Text style={{ opacity: 0.6 }}>{store.listQueue().length} queued</Text>}
  </Screen>;
}
