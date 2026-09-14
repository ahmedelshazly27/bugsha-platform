// P-003 Application — pre-filled from the code (market, legal and trading name as ops recorded
// them). app.submit_application(p_code, …) redeems the code, creates the partner in `applied` and
// makes this account its owner; the app then lands on the setup checklist.
import { useEffect, useState } from 'react'; import { router, useLocalSearchParams } from 'expo-router'; import { View } from 'react-native';
import { useCities, useSubmitApplication, RpcError } from '@bugsha/api'; import { errorMessage } from '@bugsha/i18n'; import type { Market } from '@bugsha/core';
import { AppBar, Banner, Button, Caption, Chip, Chips, Eyebrow, Foot, Input, Pp, Screen, Stepper } from '@bugsha/ui';
import { db } from '../../src/lib/supabase'; import { useSession } from '../../src/lib/session'; import { useStore } from '../../src/lib/store'; import { useL } from '../../src/lib/ui';
const CATS: Array<[string, string, string]> = [['bakery', 'Bakery', 'مخبز'], ['cafe', 'Café', 'مقهى'], ['meals', 'Meals', 'وجبات'], ['grocery', 'Co-op / grocery', 'جمعية / بقالة'], ['sweets', 'Sweets', 'حلويات'], ['other', 'Other', 'أخرى']];
export default function Apply() {
  const { L, ar } = useL(); const { userId, locale } = useSession(); const store = useStore();
  const p = useLocalSearchParams<{ code?: string; market?: string; legal?: string; trading?: string }>();
  const market = (p.market === 'EG' ? 'EG' : 'KW') as Market; const kw = market === 'KW';
  const cities = useCities(db, market) as any; const submit = useSubmitApplication(db);
  const [f, setF] = useState({ legal: String(p.legal ?? ''), trading: String(p.trading ?? ''), name: '', phone: kw ? '+965' : '+20', email: '', city: '', branches: 1, referral: '' });
  const [cats, setCats] = useState<string[]>([]); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { db.auth.getUser().then(({ data }) => { if (data.user?.email) setF((x) => ({ ...x, email: x.email || data.user!.email! })); }); }, []);
  if (!userId) { router.replace({ pathname: '/signin', params: { next: `/join/apply?code=${encodeURIComponent(String(p.code ?? ''))}&market=${market}&legal=${encodeURIComponent(String(p.legal ?? ''))}&trading=${encodeURIComponent(String(p.trading ?? ''))}` } } as any); return null; }
  const valid = !!p.code && f.legal.trim() && f.trading.trim() && cats.length > 0 && f.name.trim() && f.phone.length > 6 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email) && f.city;
  const send = async () => { setErr(null); try {
      const row = await submit.mutateAsync({ code: String(p.code), market, legalName: f.legal.trim(), tradingName: f.trading.trim(), categories: cats, contactName: f.name.trim(), contactPhone: f.phone.replace(/\s/g, ''), contactEmail: f.email.trim().toLowerCase(), cityId: f.city, branchCount: f.branches, referralSource: f.referral.trim() || null });
      store.set({ partnerId: row.partner_id, tradingName: row.trading_name, market: row.market, role: 'owner', storeId: '', storeName: '' });
      router.replace('/onboarding');
    } catch (e) { setErr(e instanceof RpcError ? errorMessage(e.code, locale) : L('Something went wrong. Try again.', 'حدث خطأ. حاول مرة أخرى.')); } };
  return <View style={{ flex: 1 }}><AppBar title={L('Your application', 'طلب التسجيل')} sub={kw ? L('Kuwait', 'الكويت') : L('Egypt', 'مصر')} onBack={() => router.back()} /><Screen top={false} gap={14}>
    <Pp>{L('Names must match your commercial licence — ops checks them before approving. Everything else can change later.', 'الأسماء لازم تطابق الرخصة التجارية — الفريق يراجعها قبل الاعتماد. الباقي يمكن تعديله لاحقاً.')}</Pp>
    <Input label={L('Kitchen name (what customers see)', 'اسم المطبخ (كما يراه العملاء)')} value={f.trading} onChangeText={(v) => setF({ ...f, trading: v })} />
    <Input label={L('Legal name (on the licence)', 'الاسم القانوني (على الرخصة)')} value={f.legal} onChangeText={(v) => setF({ ...f, legal: v })} />
    <Eyebrow>{L('What you make', 'ماذا تقدّم')}</Eyebrow>
    <Chips>{CATS.map(([k, en, a]) => <Chip key={k} selected={cats.includes(k)} onPress={() => setCats((c) => c.includes(k) ? c.filter((x) => x !== k) : [...c, k])}>{ar ? a : en}</Chip>)}</Chips>
    <Input label={L('Your name', 'اسمك')} value={f.name} onChangeText={(v) => setF({ ...f, name: v })} autoComplete="name" />
    <Input label={L('Phone', 'الهاتف')} value={f.phone} onChangeText={(v) => setF({ ...f, phone: v })} keyboardType="phone-pad" autoComplete="tel" hint={kw ? '+965 5xxx xxxx' : '+20 1xx xxx xxxx'} />
    <Input label={L('Email', 'البريد الإلكتروني')} value={f.email} onChangeText={(v) => setF({ ...f, email: v })} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
    <Eyebrow>{L('City', 'المدينة')}</Eyebrow>
    <Chips>{((cities.data ?? []) as any[]).map((c) => <Chip key={c.id} selected={f.city === c.id} onPress={() => setF({ ...f, city: c.id })}>{ar ? c.name_ar : c.name_en}</Chip>)}</Chips>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}><Eyebrow>{L('Branches', 'الفروع')}</Eyebrow><Stepper value={f.branches} min={1} max={50} onChange={(v) => setF({ ...f, branches: v })} /></View>
    <Input label={L('How did you hear about us? (optional)', 'كيف سمعت عنا؟ (اختياري)')} value={f.referral} onChangeText={(v) => setF({ ...f, referral: v })} />
    {err ? <Banner tone="error" title={err} /> : null}
    <Caption>{L('Alcohol is never listed on Bugsha. Submitting uses your code — it cannot be used again.', 'الكحول لا تُعرض على بقشة أبداً. الإرسال يستهلك رمزك — لا يمكن استخدامه مرة أخرى.')}</Caption>
  </Screen><Foot><Button size="lg" fullWidth loading={submit.isPending} disabled={!valid} onPress={send}>{L('Submit application', 'إرسال الطلب')}</Button></Foot></View>;
}
