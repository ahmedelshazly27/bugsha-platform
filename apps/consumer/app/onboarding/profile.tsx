// S-C-014 — minimum friction: first name (shown to the store), optional phone for late pickups, app language.
import { useState } from 'react'; import { router } from 'expo-router'; import { View } from 'react-native';
import { useCompleteProfile, RpcError } from '@bugsha/api'; import { errorMessage } from '@bugsha/i18n';
import { AppBar, Banner, Button, Card, Foot, Input, ListRow, Screen, SegmentedControl } from '@bugsha/ui';
import { db } from '../../src/lib/supabase'; import { useSession } from '../../src/lib/session'; import { useL } from '../../src/lib/ui';
export default function Profile() {
  const s = useSession(); const { L, ar } = useL(); const m = useCompleteProfile(db);
  const [first, setFirst] = useState(''); const [phone, setPhone] = useState(s.market === 'KW' ? '+965' : '+20'); const [err, setErr] = useState<string | null>(null);
  async function go() {
    try { await m.mutateAsync({ firstName: first.trim(), market: s.market, cityId: s.cityId ?? undefined, phone: phone.length > 5 ? phone : undefined }); router.replace('/(tabs)'); }
    catch (e) { setErr(errorMessage((e as RpcError).code, s.locale)); }
  }
  return <View style={{ flex: 1 }}><AppBar title={L('Almost there', 'اقتربنا')} onBack={() => router.back()} />
    <Screen top={false} pad={16}>
      <Input label={L('First name', 'الاسم الأول')} value={first} onChangeText={setFirst} autoFocus hint={L('Shown to the store at pickup, so they can find your order.', 'يظهر للمتجر عند الاستلام لإيجاد طلبك.')} />
      <Input label={L('Phone (optional)', 'رقم الهاتف (اختياري)')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" hint={L('Only so the store can reach you if you are running late.', 'فقط ليتواصل معك المتجر إن تأخرت.')} />
      <Card><ListRow icon="settings" label={L('App language', 'لغة التطبيق')} value={<SegmentedControl fullWidth={false} value={ar ? 'ar' : 'en'} onChange={(v) => s.set({ locale: v === 'en' ? 'en' : s.market === 'KW' ? 'ar-KW' : 'ar-EG' })} options={[{ value: 'ar', label: 'ع' }, { value: 'en', label: 'EN' }]} />} style={{ borderBottomWidth: 0, paddingHorizontal: 0, paddingVertical: 0, minHeight: 40 }} /></Card>
      {err ? <Banner tone="error" title={err} /> : null}</Screen>
    <Foot><Button size="lg" fullWidth disabled={!first.trim()} loading={m.isPending} onPress={go}>{L('Start browsing', 'ابدأ التصفّح')}</Button></Foot></View>;
}
