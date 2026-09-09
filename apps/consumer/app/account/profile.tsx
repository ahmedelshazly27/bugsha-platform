// S-C-014 (edit) — only the first name is required; every field says why it is asked for.
import { useEffect, useState } from 'react'; import { router } from 'expo-router'; import { View } from 'react-native';
import { useProfile, useUpdateProfile, RpcError } from '@bugsha/api'; import { errorMessage } from '@bugsha/i18n';
import { AppBar, Banner, Button, Foot, Input, Screen } from '@bugsha/ui'; import { db } from '../../src/lib/supabase'; import { useSession } from '../../src/lib/session'; import { useL } from '../../src/lib/ui';
export default function Profile() { const { L } = useL(); const { locale } = useSession(); const q = useProfile(db); const m = useUpdateProfile(db); const [f, setF] = useState({ first: '', last: '', phone: '' }); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (q.data) setF({ first: q.data.first_name ?? '', last: q.data.last_name ?? '', phone: q.data.phone ?? '' }); }, [q.data]);
  return <View style={{ flex: 1 }}><AppBar title={L('Profile', 'الملف الشخصي')} onBack={() => router.back()} /><Screen top={false} pad={16}>
    <Input label={L('First name', 'الاسم الأول')} value={f.first} onChangeText={(v) => setF({ ...f, first: v })} hint={L('Shown to the store at pickup.', 'يظهر للمتجر عند الاستلام.')} />
    <Input label={L('Last name (optional)', 'اسم العائلة (اختياري)')} value={f.last} onChangeText={(v) => setF({ ...f, last: v })} />
    <Input label={L('Phone (optional)', 'رقم الهاتف (اختياري)')} value={f.phone} onChangeText={(v) => setF({ ...f, phone: v })} keyboardType="phone-pad" hint={L('So the store can reach you if you are late.', 'ليتواصل معك المتجر إن تأخرت.')} />
    <Input label={L('Email', 'البريد الإلكتروني')} value={q.data?.email ?? ''} editable={false} hint={L('Your sign-in. Changing it is not supported yet.', 'بريد الدخول. لا يمكن تغييره حالياً.')} />
    {err ? <Banner tone="error" title={err} /> : null}</Screen>
    <Foot><Button size="lg" fullWidth loading={m.isPending} onPress={() => m.mutateAsync({ firstName: f.first, lastName: f.last || undefined, phone: f.phone || undefined }).then(() => router.back()).catch((e: RpcError) => setErr(errorMessage(e.code, locale)))}>{L('Save', 'حفظ')}</Button></Foot></View>; }
