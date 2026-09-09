// S-C-011 (email variant, D23) — one field, one reason it is asked for.
import { useState } from 'react'; import { router } from 'expo-router'; import { View } from 'react-native';
import { AppBar, Button, Foot, Input, Pp, Screen } from '@bugsha/ui';
import { db } from '../../src/lib/supabase'; import { useL } from '../../src/lib/ui';
export default function Email() {
  const { L } = useL(); const [email, setEmail] = useState(''); const [err, setErr] = useState<string | undefined>(); const [busy, setBusy] = useState(false);
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  async function send() {
    if (!valid) return setErr(L('Enter a full email address', 'أدخل بريداً إلكترونياً كاملاً'));
    setBusy(true); const { error } = await db.auth.signInWithOtp({ email: email.trim().toLowerCase() }); setBusy(false);
    if (error) return setErr(L("We couldn't send the code. Try again in a minute.", 'تعذّر إرسال الرمز. حاول بعد دقيقة.'));
    router.push({ pathname: '/auth/code', params: { email: email.trim().toLowerCase() } });
  }
  return <View style={{ flex: 1 }}><AppBar title={L('Your email', 'بريدك الإلكتروني')} onBack={() => router.back()} />
    <Screen top={false} pad={16}><Pp>{L('We send a six-digit code. No password to remember.', 'سنرسل رمزاً من ست خانات. لا حاجة لكلمة مرور.')}</Pp>
      <Input label={L('Email', 'البريد الإلكتروني')} placeholder="name@example.com" icon="user" value={email} onChangeText={(v) => { setEmail(v); setErr(undefined); }} keyboardType="email-address" autoCapitalize="none" autoComplete="email" autoFocus error={err} onSubmitEditing={send} /></Screen>
    <Foot><Button size="lg" fullWidth disabled={!valid} loading={busy} onPress={send}>{L('Send code', 'إرسال الرمز')}</Button></Foot></View>;
}
