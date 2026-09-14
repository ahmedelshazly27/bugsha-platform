// P-004 Request a partner code — the same form as bugsha.app/partners, posting to the same
// `partner-request` edge function. Ops reviews it and issues the code by email.
import { useState } from 'react'; import { router } from 'expo-router'; import { View } from 'react-native';
import { useCities } from '@bugsha/api'; import type { Market } from '@bugsha/core';
import { AppBar, Banner, Button, Caption, Chip, Chips, Eyebrow, Foot, Input, Mark, Pp, Screen, SegmentedControl, T, color } from '@bugsha/ui';
import { db } from '../../src/lib/supabase'; import { useSession } from '../../src/lib/session'; import { useL } from '../../src/lib/ui';
const ENDPOINT = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/partner-request`;
const CATS: Array<[string, string, string]> = [['bakery', 'Bakery', 'مخبز'], ['cafe', 'Café', 'مقهى'], ['meals', 'Meals', 'وجبات'], ['grocery', 'Co-op / grocery', 'جمعية / بقالة'], ['sweets', 'Sweets', 'حلويات'], ['other', 'Other', 'أخرى']];
export default function RequestCode() {
  const { L, ar } = useL(); const { locale } = useSession();
  const [market, setMarket] = useState<Market>('KW'); const kw = market === 'KW'; const cities = useCities(db, market) as any;
  const [f, setF] = useState({ trading: '', legal: '', name: '', phone: '+965', email: '', city: '', branches: '1', surplus: '', referral: '' });
  const [cats, setCats] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [done, setDone] = useState<null | { repeat: boolean }>(null);
  const valid = f.trading.trim() && f.legal.trim() && cats.length > 0 && f.name.trim() && f.phone.length > 6 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email);
  const send = async () => { setBusy(true); setErr(null); try {
      const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ market, tradingName: f.trading.trim(), legalName: f.legal.trim(), categories: cats, contactName: f.name.trim(), contactPhone: f.phone.trim(), contactEmail: f.email.trim().toLowerCase(), city: f.city || undefined, branchCount: Number(f.branches) || 1, estDailySurplus: f.surplus.trim() || undefined, referralSource: f.referral.trim() || undefined, source: 'partner-app', locale }) });
      const body = await res.json().catch(() => ({ ok: res.ok })); if (!body?.ok) throw new Error(body?.error || 'failed'); setDone({ repeat: !!body.repeat });
    } catch (e) { setErr(e instanceof Error && e.message !== 'failed' ? e.message : L("We couldn't send that just now. Try again.", 'تعذّر الإرسال الآن. حاول مرة أخرى.')); } finally { setBusy(false); } };
  if (done) return <View style={{ flex: 1 }}><AppBar title={L('Request sent', 'أُرسل الطلب')} back={false} /><Screen top={false} gap={14}>
    <View style={{ alignItems: 'center', gap: 12, paddingVertical: 24 }}><Mark size={44} color={color.brand} /><T role="titleLg" weight={700} align="center">{done.repeat ? L('Got it — again', 'وصلنا — مرة أخرى') : L('Request received', 'وصلنا طلبك')}</T>
      <Pp style={{ textAlign: 'center' }}>{L(`We've emailed ${f.email.trim()} a confirmation. Someone from Bugsha replies within two working days — with a partner code, or with questions.`, `أرسلنا تأكيداً إلى ${f.email.trim()}. يرد عليك أحد من بقشة خلال يومي عمل — برمز شريك أو بأسئلة.`)}</Pp></View>
    <Caption>{L('When the code arrives, open the app, choose “I have a partner code”, and sign in with this email.', 'عند وصول الرمز، افتح التطبيق واختر «عندي رمز شريك» وسجّل الدخول بهذا البريد.')}</Caption>
  </Screen><Foot><Button size="lg" fullWidth onPress={() => router.replace('/join')}>{L('Done', 'تم')}</Button></Foot></View>;
  return <View style={{ flex: 1 }}><AppBar title={L('Request a partner code', 'اطلب رمز شريك')} onBack={() => router.back()} /><Screen top={false} gap={14}>
    <Pp>{L('Tell us about your kitchen. Ops reads every request and replies within two working days. No listing fee, no subscription, no minimum volume.', 'عرّفنا بمطبخك. الفريق يقرأ كل طلب ويرد خلال يومي عمل. بدون رسوم عرض أو اشتراك أو حد أدنى.')}</Pp>
    <SegmentedControl value={market} onChange={(m) => { setMarket(m); setF({ ...f, city: '', phone: m === 'KW' ? '+965' : '+20' }); }} options={[{ value: 'KW', label: L('Kuwait', 'الكويت') }, { value: 'EG', label: L('Egypt', 'مصر') }]} />
    <Input label={L('Kitchen name (what customers see)', 'اسم المطبخ (كما يراه العملاء)')} value={f.trading} onChangeText={(v) => setF({ ...f, trading: v })} />
    <Input label={L('Legal name (on the licence)', 'الاسم القانوني (على الرخصة)')} value={f.legal} onChangeText={(v) => setF({ ...f, legal: v })} />
    <Eyebrow>{L('What you make', 'ماذا تقدّم')}</Eyebrow>
    <Chips>{CATS.map(([k, en, a]) => <Chip key={k} selected={cats.includes(k)} onPress={() => setCats((c) => c.includes(k) ? c.filter((x) => x !== k) : [...c, k])}>{ar ? a : en}</Chip>)}</Chips>
    <Input label={L('Your name', 'اسمك')} value={f.name} onChangeText={(v) => setF({ ...f, name: v })} autoComplete="name" />
    <Input label={L('Phone', 'الهاتف')} value={f.phone} onChangeText={(v) => setF({ ...f, phone: v })} keyboardType="phone-pad" hint={kw ? '+965 5xxx xxxx' : '+20 1xx xxx xxxx'} />
    <Input label={L('Email', 'البريد الإلكتروني')} value={f.email} onChangeText={(v) => setF({ ...f, email: v })} keyboardType="email-address" autoCapitalize="none" autoComplete="email" hint={L('The code is sent here and tied to it', 'يُرسل الرمز إلى هذا البريد ويرتبط به')} />
    <Eyebrow>{L('City', 'المدينة')}</Eyebrow>
    <Chips>{((cities.data ?? []) as any[]).map((c) => <Chip key={c.id} selected={f.city === c.name_en} onPress={() => setF({ ...f, city: c.name_en })}>{ar ? c.name_ar : c.name_en}</Chip>)}</Chips>
    <View style={{ flexDirection: 'row', gap: 10 }}><Input containerStyle={{ flex: 1 }} label={L('Branches', 'الفروع')} value={f.branches} onChangeText={(v) => setF({ ...f, branches: v.replace(/\D/g, '').slice(0, 3) })} keyboardType="number-pad" /><Input containerStyle={{ flex: 2 }} label={L('Surplus on a typical night (optional)', 'الفائض في ليلة عادية (اختياري)')} value={f.surplus} onChangeText={(v) => setF({ ...f, surplus: v })} placeholder={kw ? 'KD 25' : 'EGP 600'} /></View>
    <Input label={L('How did you hear about us? (optional)', 'كيف سمعت عنا؟ (اختياري)')} value={f.referral} onChangeText={(v) => setF({ ...f, referral: v })} />
    {err ? <Banner tone="error" title={err} /> : null}
    <Caption>{L('Alcohol is never listed on Bugsha. Legal details are checked against your commercial licence before a code is issued.', 'الكحول لا تُعرض على بقشة أبداً. تُراجع البيانات القانونية مع الرخصة التجارية قبل إصدار الرمز.')}</Caption>
  </Screen><Foot><Button size="lg" fullWidth loading={busy} disabled={!valid} onPress={send}>{L('Request a partner code', 'اطلب رمز شريك')}</Button></Foot></View>;
}
