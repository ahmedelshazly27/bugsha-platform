// Partner sign-in: email code (D23). Staff are invited by their owner; the code is the only credential.
import { useState } from 'react'; import { router } from 'expo-router'; import { View } from 'react-native';
import { Banner, Button, Caption, Foot, Input, Logo, Pp, Screen, T, color } from '@bugsha/ui';
import { db } from '../src/lib/supabase'; import { useL } from '../src/lib/ui';
export default function SignIn() {
  const { L, lang } = useL(); const [email, setEmail] = useState(''); const [otp, setOtp] = useState(''); const [sent, setSent] = useState(false); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  return <View style={{ flex: 1 }}><Screen scroll={false} style={{ justifyContent: 'center', gap: 16, padding: 24 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Logo lockup="horizontal" lang={lang} size={26} color={color.brand} /><T weight={600} color={color.textSecondary}>· {L('Partner', 'الشريك')}</T></View>
    <View style={{ gap: 6 }}><T role="titleLg" weight={700}>{sent ? L('Enter your code', 'أدخل الرمز') : L('Sign in to your store', 'ادخل إلى متجرك')}</T><Pp>{sent ? L(`Sent to ${email}.`, `أُرسل إلى ${email}.`) : L('Use the email your owner invited. We send a six-digit code.', 'استخدم البريد الذي دعاك به المالك. سنرسل رمزاً من ست خانات.')}</Pp></View>
    {!sent ? <Input label={L('Email', 'البريد الإلكتروني')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" autoFocus />
      : <Input label={L('Code', 'الرمز')} value={otp} onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 8))} keyboardType="number-pad" textContentType="oneTimeCode" autoFocus />}
    {err ? <Banner tone="error" title={err} /> : null}</Screen>
    <Foot>{!sent ? <Button size="lg" fullWidth loading={busy} disabled={!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)} onPress={async () => { setBusy(true); const { error } = await db.auth.signInWithOtp({ email: email.trim().toLowerCase() }); setBusy(false); if (error) return setErr(L("Couldn't send the code. Try again in a minute.", 'تعذّر إرسال الرمز. حاول بعد دقيقة.')); setErr(null); setSent(true); }}>{L('Send code', 'إرسال الرمز')}</Button>
      : <Button size="lg" fullWidth loading={busy} disabled={otp.length < 6} onPress={async () => { setBusy(true); const { error } = await db.auth.verifyOtp({ email: email.trim().toLowerCase(), token: otp, type: 'email' }); setBusy(false); if (error) return setErr(L("That code didn't match", 'الرمز غير مطابق')); router.replace('/(tabs)'); }}>{L('Sign in', 'تسجيل الدخول')}</Button>}
      <Caption align="center">{L('Not a partner yet? Apply at bugsha.com/partners', 'لست شريكاً بعد؟ قدّم عبر bugsha.com/partners')}</Caption></Foot></View>;
}
