// §4.3 Redeem — code entry with fuzzy match, confirm (cash due shown), done with 120 s undo. Works with NO network via the offline mirror.
import { useEffect, useState } from 'react'; import { router, useLocalSearchParams } from 'expo-router'; import { Pressable, TextInput, View } from 'react-native'; import NetInfo from '@react-native-community/netinfo';
import { redeemOffline } from '@bugsha/offline'; import { useLookupOrder, useCollectCash, useUndoRedemption } from '@bugsha/api';
import { AppBar, Badge, Banner, Button, Caption, Card, Eyebrow, Foot, Icon, Num, Pp, Rule, Screen, T, color, radius } from '@bugsha/ui';
import { db } from '../src/lib/supabase'; import { useSession } from '../src/lib/session'; import { useStore } from '../src/lib/store'; import { SqliteOfflineStore } from '../src/offline/store'; import { drain, hashCode, refreshMirror } from '../src/offline/sync'; import { major, money, useL, CUR } from '../src/lib/ui';
const norm = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); const fmt = (v: string) => (v.length > 3 ? `${v.slice(0, 3)}-${v.slice(3)}` : v);
export default function Redeem() {
  const params = useLocalSearchParams<{ code?: string }>(); const s = useStore(); const { userId, online, set } = useSession(); const { L } = useL();
  const [store, setStore] = useState<SqliteOfflineStore | null>(null); const [code, setCode] = useState(norm(params.code ?? '')); const [stage, setStage] = useState<'entry' | 'confirm' | 'done'>(params.code ? 'confirm' : 'entry'); const [result, setResult] = useState<any>(null); const [undoLeft, setUndoLeft] = useState(120);
  const lookup = useLookupOrder(db, s.storeId, fmt(code)); const cash = useCollectCash(db); const undo = useUndoRedemption(db);
  useEffect(() => { SqliteOfflineStore.open().then(async (st) => { await st.load(); setStore(st); if (online) refreshMirror(db, st, s.storeId).catch(() => {}); }); }, []);
  useEffect(() => NetInfo.addEventListener(async (n) => { const on = !!n.isConnected; set({ online: on }); if (on && store) { await drain(db, store).catch(() => {}); refreshMirror(db, store, s.storeId).catch(() => {}); } }), [store]);
  useEffect(() => { if (stage !== 'done') return; const t = setInterval(() => setUndoLeft((n) => Math.max(0, n - 1)), 1000); return () => clearInterval(t); }, [stage]);
  const cached = store?.getCachedOrder(fmt(code)); const matches = ((lookup.data as any[]) ?? []);
  async function confirm() {
    if (!store) return; const hashed = await hashCode(fmt(code));
    const r = redeemOffline(store, { code: fmt(code), staffUserId: userId!, now: new Date(), hash: () => hashed });
    if (!r.ok) return setResult({ error: r.code === 'BG110' ? L('No order with that code', 'لا يوجد طلب بهذا الرمز') : r.code === 'BG111' ? L('Window not open yet', 'لم يبدأ وقت الاستلام') : L('Window closed — use late redemption from the board', 'انتهى الوقت — استخدم الاستلام المتأخر') });
    if (cached?.method === 'cash' && !r.alreadyRedeemed) cash.mutateAsync({ orderId: cached.orderId, collectedMinor: cached.amountDueMinor }).catch(() => {});
    setResult(r); setStage('done'); setUndoLeft(120); if (online) drain(db, store).catch(() => {});
  }
  if (stage === 'done' && result) return <View style={{ flex: 1 }}><Screen scroll={false} style={{ alignItems: 'center', justifyContent: 'center', gap: 14, padding: 18 }}>
    <View style={{ width: 56, height: 56, borderRadius: 99, backgroundColor: color.brandTint, alignItems: 'center', justifyContent: 'center' }}><Icon name="check" size={28} color={color.brand} /></View>
    <T role="titleLg" weight={700} align="center">{result.alreadyRedeemed ? L('Already handed over', 'سُلّمت مسبقاً') : L('Handed over', 'تم التسليم')}</T>
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><Num>{fmt(code)}</Num><Pp>{`· ${cached?.customerFirstName ?? ''} ·`}</Pp><Num>{String(cached?.quantity ?? 1)}</Num><Pp>{L('bag', 'بقشة')}</Pp></View>
    {result.alreadyRedeemed ? <Banner tone="info" title={L(`Taken earlier by ${result.redeemedBy ?? L('a colleague', 'زميل')}`, `استلمها سابقاً ${result.redeemedBy ?? 'زميل'}`)}>{L("Don't hand over a second bag.", 'لا تسلّم بقشة ثانية.')}</Banner> : <Caption align="center">{online ? L('Recorded', 'سُجّل') : L('Recorded on this device — syncs when online', 'سُجّل على هذا الجهاز — يُزامن عند الاتصال')}</Caption>}</Screen>
    <Foot>{!result.alreadyRedeemed && undoLeft > 0 && cached ? <Button variant="ghost" fullWidth onPress={() => undo.mutateAsync(cached.orderId).finally(() => { setStage('entry'); setCode(''); setResult(null); })}>{L(`Undo (${Math.floor(undoLeft / 60)}:${String(undoLeft % 60).padStart(2, '0')})`, `تراجع (${Math.floor(undoLeft / 60)}:${String(undoLeft % 60).padStart(2, '0')})`)}</Button> : null}
      <Button size="lg" fullWidth iconStart="scan-line" onPress={() => { setStage('entry'); setCode(''); setResult(null); }}>{L('Next order', 'الطلب التالي')}</Button></Foot></View>;
  if (stage === 'confirm') return <View style={{ flex: 1 }}><AppBar title={L('Confirm', 'تأكيد')} onBack={() => setStage('entry')} />
    <Screen top={false} scroll={false} style={{ justifyContent: 'center', padding: 16 }}><Card><View style={{ alignItems: 'center', gap: 8 }}>
      <Num weight={700} style={{ fontSize: 34, lineHeight: 40 }}>{fmt(code)}</Num><T role="headline" weight={600}>{cached?.customerFirstName ?? L('Unknown order', 'طلب غير معروف')}</T>
      {cached?.method === 'cash' ? <Badge tone="deal">{L('Cash on pickup', 'نقداً عند الاستلام')}</Badge> : cached ? <Badge tone="fresh">{L('Paid', 'مدفوع')}</Badge> : null}<Rule />
      <Caption>{L('Hand over', 'سلّم')}</Caption><Num weight={700} style={{ fontSize: 26, lineHeight: 32 }}>{`${cached?.quantity ?? 1} ${L('bag', 'بقشة')}`}</Num>
      {cached?.method === 'cash' ? <><Caption>{L('Collect', 'حصّل')}</Caption><Num weight={700} color={color.brand} style={{ fontSize: 30, lineHeight: 36 }}>{money(cached.amountDueMinor, s.market)}</Num></> : null}
      {result?.error ? <Banner tone="error" title={result.error} /> : null}</View></Card></Screen>
    <Foot><Button size="lg" fullWidth onPress={confirm}>{cached?.method === 'cash' ? L('Cash received — hand over', 'استلمت النقد — سلّم') : L('Hand over', 'سلّم')}</Button></Foot></View>;
  return <View style={{ flex: 1 }}><AppBar title={L('Redeem an order', 'استلام طلب')} onBack={() => router.back()} action={!online ? <Badge tone="urgent">{L('Offline', 'غير متصل')}</Badge> : undefined} />
    <Screen top={false} gap={14}>
      <Pressable style={{ flexDirection: 'row', gap: 8, justifyContent: 'center', direction: 'ltr' }}>{[0, 1, 2, 3, 4].map((i) => <View key={i} style={{ width: 44, height: 58, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center', backgroundColor: color.raised, borderWidth: 1.5, borderColor: code[i] ? color.brand : color.border, marginStart: i === 3 ? 10 : 0 }}><Num weight={700} style={{ fontSize: 24, lineHeight: 30 }}>{code[i] ?? ''}</Num></View>)}</Pressable>
      <TextInput value={code} onChangeText={(v) => setCode(norm(v))} autoFocus autoCapitalize="characters" autoCorrect={false} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
      <Eyebrow>{L('Matches', 'التطابقات')}</Eyebrow>
      {(online ? matches : (cached ? [{ order_id: cached.orderId, code: cached.code, customer_first_name: cached.customerFirstName, quantity: cached.quantity }] : [])).map((m: any) => <Card key={m.order_id} onPress={() => { setCode(norm(m.code)); setStage('confirm'); }}><View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><Num weight={700} style={{ fontSize: 18, lineHeight: 24 }}>{m.code}</Num><View style={{ flex: 1 }}><T weight={600}>{m.customer_first_name}</T><Caption>{`${m.quantity} ${L('bag', 'بقشة')}`}</Caption></View><Icon name="chevron-right" size={17} mirror /></View></Card>)}
      {code.length === 5 ? <Button fullWidth onPress={() => setStage('confirm')}>{L('Continue', 'متابعة')}</Button> : null}
      {store ? <Caption align="center">{L(`${store.listQueue().length} queued for sync`, `${store.listQueue().length} بانتظار المزامنة`)}</Caption> : null}</Screen></View>;
}
