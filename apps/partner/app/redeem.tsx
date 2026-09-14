// §4.3 Redeem — QR scan or 5-character code entry, confirm (cash due shown), done with a 60 s undo.
// Works with NO network via the offline mirror. Past the 30-minute grace an online staff member can
// still record a late redemption (redeem_order_late) instead of turning the customer away.
import { useEffect, useRef, useState } from 'react'; import { router, useLocalSearchParams } from 'expo-router'; import { Pressable, TextInput, View } from 'react-native'; import NetInfo from '@react-native-community/netinfo';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { redeemOffline } from '@bugsha/offline'; import { useLookupOrder, useCollectCash, useUndoRedemption, useRedeemLate } from '@bugsha/api';
import { AppBar, Badge, Banner, Button, Caption, Card, Eyebrow, Foot, Icon, Num, Pp, Rule, Screen, T, color, radius } from '@bugsha/ui';
import { db } from '../src/lib/supabase'; import { useSession } from '../src/lib/session'; import { useStore } from '../src/lib/store'; import { SqliteOfflineStore } from '../src/offline/store'; import { drain, hashCode, refreshMirror } from '../src/offline/sync'; import { money, useL } from '../src/lib/ui';
const norm = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); const fmt = (v: string) => (v.length > 3 ? `${v.slice(0, 3)}-${v.slice(3)}` : v);
const UNDO_SECONDS = 60; const GRACE_MINUTES = 30; const LATE_LIMIT_HOURS = 24;
/** Accepts `bugsha://redeem/R3D-9F`, `https://bugsha.app/r/R3D9F` or a bare code. */
export const parseScan = (raw: string): string | null => { const m = raw.trim().match(/(?:redeem\/|\/r\/)?([A-Z0-9]{3})-?([A-Z0-9]{2})\s*$/i); return m ? norm(m[1]! + m[2]!) : null; };
export default function Redeem() {
  const params = useLocalSearchParams<{ code?: string; late?: string }>(); const s = useStore(); const { userId, online, set } = useSession(); const { L } = useL();
  const [store, setStore] = useState<SqliteOfflineStore | null>(null); const [code, setCode] = useState(norm(params.code ?? '')); const [mechanism, setMechanism] = useState<'code_shown' | 'qr_scanned'>('code_shown');
  const [stage, setStage] = useState<'entry' | 'scan' | 'confirm' | 'done'>(params.code ? 'confirm' : 'entry'); const [result, setResult] = useState<any>(null); const [undoLeft, setUndoLeft] = useState(UNDO_SECONDS); const [busy, setBusy] = useState(false);
  const [perm, requestPerm] = useCameraPermissions(); const scanned = useRef(false);
  const lookup = useLookupOrder(db, s.storeId, fmt(code)); const cash = useCollectCash(db); const undo = useUndoRedemption(db); const late = useRedeemLate(db);
  useEffect(() => { SqliteOfflineStore.open().then(async (st) => { await st.load(); setStore(st); if (online) refreshMirror(db, st, s.storeId).catch(() => {}); }); }, []);
  useEffect(() => NetInfo.addEventListener(async (n) => { const on = !!n.isConnected; set({ online: on }); if (on && store) { await drain(db, store).catch(() => {}); refreshMirror(db, store, s.storeId).catch(() => {}); } }), [store]);
  useEffect(() => { if (stage !== 'done') return; const t = setInterval(() => setUndoLeft((n) => Math.max(0, n - 1)), 1000); return () => clearInterval(t); }, [stage]);
  const cached = store?.getCachedOrder(fmt(code)); const matches = ((lookup.data as any[]) ?? []);
  const now = Date.now(); const end = cached ? Date.parse(cached.windowEndUtc) : NaN; const minutesPastEnd = cached ? (now - end) / 60_000 : 0;
  const pastGrace = !!cached && cached.status !== 'redeemed' && minutesPastEnd >= GRACE_MINUTES; const lateAllowed = pastGrace && online && minutesPastEnd < LATE_LIMIT_HOURS * 60;
  const reset = () => { setStage('entry'); setCode(''); setResult(null); setMechanism('code_shown'); scanned.current = false; };
  async function confirm() {
    if (!store || busy) return; setBusy(true);
    try {
      if (pastGrace) {
        if (!lateAllowed) return setResult({ error: online ? L('Window closed more than a day ago — ask support', 'انتهى الوقت منذ أكثر من يوم — تواصل مع الدعم') : L('Late redemption needs a connection', 'الاستلام المتأخر يحتاج اتصالاً') });
        const r: any = await late.mutateAsync({ orderId: cached!.orderId });
        store.putCachedOrder({ ...cached!, status: 'redeemed', redeemedBy: userId!, redeemedAt: new Date().toISOString() });
        if (cached!.method === 'cash') cash.mutateAsync({ orderId: cached!.orderId, collectedMinor: cached!.amountDueMinor }).catch(() => {});
        setResult({ ok: true, alreadyRedeemed: !!r?.already_redeemed, late: true }); setStage('done'); setUndoLeft(UNDO_SECONDS); return;
      }
      const hashed = await hashCode(fmt(code));
      const r = redeemOffline(store, { code: fmt(code), staffUserId: userId!, now: new Date(), hash: () => hashed, mechanism, graceMinutes: GRACE_MINUTES });
      if (!r.ok) return setResult({ error: r.code === 'BG110' ? L('No order with that code', 'لا يوجد طلب بهذا الرمز') : r.code === 'BG111' ? L('Window not open yet', 'لم يبدأ وقت الاستلام') : L('Window closed', 'انتهى الوقت') });
      if (cached?.method === 'cash' && !r.alreadyRedeemed) cash.mutateAsync({ orderId: cached.orderId, collectedMinor: cached.amountDueMinor }).catch(() => {});
      setResult(r); setStage('done'); setUndoLeft(UNDO_SECONDS); if (online) drain(db, store).catch(() => {});
    } catch (e: any) { setResult({ error: e?.message ?? L('Could not record — try again', 'تعذّر التسجيل — حاول مجدداً') }); } finally { setBusy(false); }
  }
  if (stage === 'done' && result) return <View style={{ flex: 1 }}><Screen scroll={false} style={{ alignItems: 'center', justifyContent: 'center', gap: 14, padding: 18 }}>
    <View style={{ width: 56, height: 56, borderRadius: 99, backgroundColor: color.brandTint, alignItems: 'center', justifyContent: 'center' }}><Icon name="check" size={28} color={color.brand} /></View>
    <T role="titleLg" weight={700} align="center">{result.alreadyRedeemed ? L('Already handed over', 'سُلّمت مسبقاً') : result.late ? L('Handed over (late)', 'تم التسليم (متأخر)') : L('Handed over', 'تم التسليم')}</T>
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><Num>{fmt(code)}</Num><Pp>{`· ${cached?.customerFirstName ?? ''} ·`}</Pp><Num>{String(cached?.quantity ?? 1)}</Num><Pp>{(cached?.quantity ?? 1) > 1 ? L('bags', 'بقش') : L('bag', 'بقشة')}</Pp></View>
    {result.alreadyRedeemed ? <Banner tone="info" title={L(`Taken earlier by ${result.redeemedBy ?? L('a colleague', 'زميل')}`, `استلمها سابقاً ${result.redeemedBy ?? 'زميل'}`)}>{L("Don't hand over a second bag.", 'لا تسلّم بقشة ثانية.')}</Banner>
      : result.lateGrace ? <Banner tone="time" title={L('Recorded inside the grace window', 'سُجّل ضمن فترة السماح')}>{L('Counts as on time for the customer.', 'يُحتسب في الوقت للعميل.')}</Banner>
      : <Caption align="center">{online ? L(mechanism === 'qr_scanned' ? 'Recorded · QR' : 'Recorded', 'سُجّل') : L('Recorded on this device — syncs when online', 'سُجّل على هذا الجهاز — يُزامن عند الاتصال')}</Caption>}</Screen>
    <Foot>{!result.alreadyRedeemed && undoLeft > 0 && cached ? <Button variant="ghost" fullWidth onPress={() => undo.mutateAsync(cached.orderId).finally(() => { store?.putCachedOrder({ ...cached, status: 'reserved', redeemedBy: undefined, redeemedAt: undefined }); reset(); })}>{L(`Undo (0:${String(undoLeft).padStart(2, '0')})`, `تراجع (0:${String(undoLeft).padStart(2, '0')})`)}</Button> : null}
      <Button size="lg" fullWidth iconStart="scan-line" onPress={reset}>{L('Next order', 'الطلب التالي')}</Button></Foot></View>;
  if (stage === 'confirm') return <View style={{ flex: 1 }}><AppBar title={L('Confirm', 'تأكيد')} onBack={() => setStage('entry')} />
    <Screen top={false} scroll={false} style={{ justifyContent: 'center', padding: 16 }}><Card><View style={{ alignItems: 'center', gap: 8 }}>
      <Num weight={700} style={{ fontSize: 34, lineHeight: 40 }}>{fmt(code)}</Num><T role="headline" weight={600}>{cached?.customerFirstName ?? L('Unknown order', 'طلب غير معروف')}</T>
      <View style={{ flexDirection: 'row', gap: 6 }}>{cached?.method === 'cash' ? <Badge tone="deal">{L('Cash on pickup', 'نقداً عند الاستلام')}</Badge> : cached ? <Badge tone="fresh">{L('Paid', 'مدفوع')}</Badge> : null}{mechanism === 'qr_scanned' ? <Badge tone="info">{L('QR', 'QR')}</Badge> : null}{cached?.status === 'redeemed' ? <Badge tone="neutral">{L('Already collected', 'استُلمت')}</Badge> : null}</View><Rule />
      <Caption>{L('Hand over', 'سلّم')}</Caption><Num weight={700} style={{ fontSize: 26, lineHeight: 32 }}>{`${cached?.quantity ?? 1} ${(cached?.quantity ?? 1) > 1 ? L('bags', 'بقش') : L('bag', 'بقشة')}`}</Num>
      {cached?.method === 'cash' ? <><Caption>{L('Collect', 'حصّل')}</Caption><Num weight={700} color={color.brand} style={{ fontSize: 30, lineHeight: 36 }}>{money(cached.amountDueMinor, s.market)}</Num></> : null}
      {pastGrace ? <Banner tone="urgent" title={L(`Window ended ${Math.round(minutesPastEnd)} min ago`, `انتهى الوقت قبل ${Math.round(minutesPastEnd)} دقيقة`)}>{lateAllowed ? L('Recording a late hand-over is logged for the customer and ops.', 'يُسجَّل التسليم المتأخر للعميل وللعمليات.') : online ? L('Too late to record here — contact support.', 'تأخر كثيراً — تواصل مع الدعم.') : L('Go online to record a late hand-over.', 'اتصل بالإنترنت لتسجيل تسليم متأخر.')}</Banner> : null}
      {result?.error ? <Banner tone="error" title={result.error} /> : null}</View></Card></Screen>
    <Foot><Button size="lg" fullWidth loading={busy} disabled={pastGrace && !lateAllowed} onPress={confirm}>{pastGrace ? L('Record late hand-over', 'سجّل تسليماً متأخراً') : cached?.method === 'cash' ? L('Cash received — hand over', 'استلمت النقد — سلّم') : L('Hand over', 'سلّم')}</Button></Foot></View>;
  if (stage === 'scan') return <View style={{ flex: 1, backgroundColor: '#000' }}><AppBar title={L('Scan QR', 'امسح رمز QR')} onBack={() => setStage('entry')} />
    {perm?.granted ? <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => { if (scanned.current) return; const c = parseScan(String(data)); if (!c) return; scanned.current = true; setCode(c); setMechanism('qr_scanned'); setStage('confirm'); }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: 220, height: 220, borderRadius: radius.card, borderWidth: 3, borderColor: color.brand }} /><Caption color="#FFFFFF" style={{ marginTop: 16 }}>{L("Point at the customer's QR code", 'وجّه الكاميرا نحو رمز العميل')}</Caption></View></CameraView>
      : <Screen style={{ justifyContent: 'center', gap: 12 }}><Banner tone="info" title={L('Camera access needed', 'نحتاج إذن الكاميرا')}>{L('Only used to read the pickup QR. Nothing is recorded.', 'يُستخدم فقط لقراءة رمز الاستلام. لا يُسجَّل شيء.')}</Banner><Button onPress={() => requestPerm()}>{L('Allow camera', 'السماح بالكاميرا')}</Button><Button variant="ghost" onPress={() => setStage('entry')}>{L('Type the code instead', 'اكتب الرمز بدلاً من ذلك')}</Button></Screen>}</View>;
  return <View style={{ flex: 1 }}><AppBar title={L('Redeem an order', 'استلام طلب')} onBack={() => router.back()} action={!online ? <Badge tone="urgent">{L('Offline', 'غير متصل')}</Badge> : undefined} />
    <Screen top={false} gap={14}>
      <Button variant="secondary" fullWidth iconStart="scan-line" onPress={() => { scanned.current = false; if (!perm?.granted) requestPerm(); setStage('scan'); }}>{L('Scan QR code', 'مسح رمز QR')}</Button>
      <Eyebrow>{L('Or type the code', 'أو اكتب الرمز')}</Eyebrow>
      <Pressable style={{ flexDirection: 'row', gap: 8, justifyContent: 'center', direction: 'ltr' }}>{[0, 1, 2, 3, 4].map((i) => <View key={i} style={{ width: 44, height: 58, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center', backgroundColor: color.raised, borderWidth: 1.5, borderColor: code[i] ? color.brand : color.border, marginStart: i === 3 ? 10 : 0 }}><Num weight={700} style={{ fontSize: 24, lineHeight: 30 }}>{code[i] ?? ''}</Num></View>)}</Pressable>
      <TextInput value={code} onChangeText={(v) => { setCode(norm(v)); setMechanism('code_shown'); }} autoFocus autoCapitalize="characters" autoCorrect={false} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
      <Eyebrow>{L('Matches', 'التطابقات')}</Eyebrow>
      {(online ? matches : (cached ? [{ order_id: cached.orderId, code: cached.code, customer_first_name: cached.customerFirstName, quantity: cached.quantity }] : [])).map((m: any) => <Card key={m.order_id} onPress={() => { setCode(norm(m.code)); setStage('confirm'); }}><View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><Num weight={700} style={{ fontSize: 18, lineHeight: 24 }}>{m.code}</Num><View style={{ flex: 1 }}><T weight={600}>{m.customer_first_name}</T><Caption>{`${m.quantity} ${L('bag', 'بقشة')}`}</Caption></View><Icon name="chevron-right" size={17} mirror /></View></Card>)}
      {code.length === 5 ? <Button fullWidth onPress={() => setStage('confirm')}>{L('Continue', 'متابعة')}</Button> : null}
      {store ? <Caption align="center">{L(`${store.listQueue().length} queued for sync`, `${store.listQueue().length} بانتظار المزامنة`)}</Caption> : null}</Screen></View>;
}
