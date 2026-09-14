// S-C-034/035 — payment. Methods come from market config; cash is a first-class row. The ambiguous return withholds retry.
import { useState } from 'react'; import { router, useLocalSearchParams } from 'expo-router'; import { View } from 'react-native';
import { useApplyPromotion, useOrder, useReserveCash, newIdempotencyKey, RpcError } from '@bugsha/api'; import { errorMessage } from '@bugsha/i18n';
import { AppBar, Banner, Button, Caption, Card, Eyebrow, Foot, Input, Line, Num, PaymentMethodRow, Rule, Screen, T, color } from '@bugsha/ui';
import { db } from '../src/lib/supabase'; import { useSession } from '../src/lib/session'; import { money, useL } from '../src/lib/ui';
const METHODS: Record<string, string[]> = { KW: ['knet', 'apple_pay', 'card', 'cash'], EG: ['card', 'wallet', 'instapay', 'fawry', 'cash'] };
export default function Pay() {
  const { order } = useLocalSearchParams<{ order: string }>(); const { market, locale } = useSession(); const { L } = useL(); const promo = useApplyPromotion(db); const [code, setCode] = useState(''); const [promoMsg, setPromoMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const q = useOrder(db, order!); const cash = useReserveCash(db); const [method, setMethod] = useState(METHODS[market]![0]!); const [state, setState] = useState<'idle' | 'processing' | 'ambiguous' | 'failed'>('idle');
  const d = q.data as any; const o = d?.order;
  const labels: Record<string, [string, string]> = { knet: ['KNET', L("Opens your bank's page", 'يفتح صفحة بنكك')], apple_pay: ['Apple Pay', 'Face ID'], card: [L('Visa / Mastercard', 'فيزا / ماستركارد'), L('Card', 'بطاقة')], cash: [L('Cash on pickup', 'نقداً عند الاستلام'), L('Pay the store when you collect', 'ادفع للمتجر عند الاستلام')], wallet: [L('Mobile wallet', 'محفظة إلكترونية'), 'Vodafone Cash · Orange · Etisalat'], instapay: ['InstaPay', L('Bank transfer', 'تحويل بنكي')], fawry: ['Fawry', L('Pay at any Fawry point', 'ادفع في أي منفذ فوري')] };
  async function pay() {
    if (method === 'cash') { await cash.mutateAsync({ orderId: order! }); router.replace(`/order/${order}`); return; }
    setState('processing');
    const { data, error } = await db.functions.invoke('create-payment', { body: { orderId: order, method }, headers: { 'idempotency-key': newIdempotencyKey() } });
    if (error) { setState(String(error.message ?? '').includes('BG140') ? 'ambiguous' : 'failed'); return; }
    if (data?.redirectUrl) (globalThis as any).open?.(data.redirectUrl);
  }
  return <View style={{ flex: 1 }}><AppBar title={L('Payment', 'الدفع')} onBack={() => router.back()} />
    <Screen top={false} pad={16} gap={12}>
      {o ? <Card><View style={{ gap: 6 }}><Line k={`${o.title_snapshot} × ${o.quantity}`} v={<Num role="label">{money(o.subtotal_minor, market)}</Num>} />{o.discount_minor ? <Line k={L('Promo', 'خصم')} v={<Num role="label">{`−${money(o.discount_minor, market)}`}</Num>} /> : null}{o.service_fee_minor ? <Line k={L('Service fee', 'رسوم الخدمة')} v={<Num role="label">{money(o.service_fee_minor, market)}</Num>} /> : null}{o.tax_minor ? <Line k={market === 'EG' ? L('VAT 14%', 'ضريبة القيمة المضافة 14%') : L('VAT', 'ضريبة')} v={<Num role="label">{money(o.tax_minor, market)}</Num>} /> : null}<Rule /><Line k={L('Total', 'الإجمالي')} v={<Num weight={700}>{money(o.total_minor, market)}</Num>} strong /></View></Card> : null}
      {o && !o.discount_minor ? <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}><Input containerStyle={{ flex: 1 }} label={L('Promo code', 'رمز الخصم')} value={code} onChangeText={(v) => { setCode(v.toUpperCase()); setPromoMsg(null); }} autoCapitalize="characters" autoCorrect={false} placeholder="FIRSTBAG" /><Button variant="secondary" disabled={code.trim().length < 3} loading={promo.isPending} onPress={() => promo.mutateAsync({ orderId: order!, code: code.trim() }).then(() => { setPromoMsg({ ok: true, text: L('Applied', 'طُبّق') }); q.refetch(); }).catch((e: RpcError) => setPromoMsg({ ok: false, text: e.code === 'BG500' ? L("That code isn't valid for this bag", 'الرمز غير صالح لهذه البقشة') : errorMessage(e.code, locale) }))}>{L('Apply', 'تطبيق')}</Button></View> : null}
      {promoMsg ? <Caption style={{ color: promoMsg.ok ? color.fresh : color.error }}>{promoMsg.text}</Caption> : null}
      <Eyebrow>{L('Pay with', 'ادفع بـ')}</Eyebrow>
      {METHODS[market]!.map((m) => <PaymentMethodRow key={m} method={m} selected={method === m} onSelect={() => setMethod(m)} label={labels[m]?.[0]} hint={labels[m]?.[1]} />)}
      {method === 'cash' ? <Banner tone="info" title={L('Reserved without paying', 'حجز بدون دفع')}>{L("Bring the exact amount. If you don't collect, the store keeps the bag and it counts as a no-show.", 'أحضر المبلغ بالضبط. إن لم تستلم، يحتفظ المتجر بالبقشة وتُحسب غياباً.')}</Banner> : null}
      {state === 'processing' ? <Banner tone="time" title={L('Opening your bank…', 'جارٍ فتح صفحة البنك…')} /> : null}
      {state === 'ambiguous' ? <Banner tone="info" title={L("We're confirming your payment", 'نتحقق من دفعتك')}>{L("Your bank hasn't told us yet. Don't pay again — we'll update this order within a few minutes.", 'لم يخبرنا البنك بعد. لا تدفع مرة أخرى — سنحدّث الطلب خلال دقائق.')}</Banner> : null}
      {state === 'failed' ? <Banner tone="error" title={L("Payment didn't go through", 'لم تتم عملية الدفع')}>{L('Nothing was charged. Try again or pick another method.', 'لم يُخصم شيء. حاول مرة أخرى أو اختر وسيلة أخرى.')}</Banner> : null}
      <Caption>{L('Card payments go live once the payment provider is connected.', 'الدفع بالبطاقة يُفعّل بعد ربط مزوّد الدفع.')}</Caption>
    </Screen>
    <Foot><Button size="lg" fullWidth disabled={!o || state === 'processing' || state === 'ambiguous'} loading={cash.isPending} onPress={pay}>{method === 'cash' ? L('Reserve — pay at pickup', 'احجز — ادفع عند الاستلام') : L(`Pay ${o ? money(o.total_minor, market) : ''}`, `ادفع ${o ? money(o.total_minor, market) : ''}`)}</Button></Foot></View>;
}
