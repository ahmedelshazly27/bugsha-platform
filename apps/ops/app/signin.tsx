import { useState } from 'react'; import { router } from 'expo-router'; import { View } from 'react-native';
import { Banner, Button, Input, Logo, Pp, T, color } from '@bugsha/ui'; import { db } from '../src/lib/supabase';
export default function SignIn() { const [email, setEmail] = useState(''); const [otp, setOtp] = useState(''); const [sent, setSent] = useState(false); const [err, setErr] = useState<string | null>(null);
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.canvas }}><View style={{ width: 380, gap: 14, padding: 24, backgroundColor: color.raised, borderRadius: 10, borderWidth: 1, borderColor: color.borderSubtle }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Logo size={22} color={color.brand} /><T weight={600} color={color.textSecondary}>· Ops</T></View>
    <Pp>Ops accounts are created by engineering. Sign in with your work email.</Pp>
    {!sent ? <Input label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" /> : <Input label="Code" value={otp} onChangeText={setOtp} keyboardType="number-pad" />}
    {err ? <Banner tone="error" title={err} /> : null}
    {!sent ? <Button fullWidth onPress={async () => { const { error } = await db.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: false } }); if (error) return setErr(error.message); setSent(true); }}>Send code</Button>
      : <Button fullWidth onPress={async () => { const { error } = await db.auth.verifyOtp({ email: email.trim().toLowerCase(), token: otp, type: 'email' }); if (error) return setErr("That code didn't match"); router.replace('/(console)/dashboard'); }}>Sign in</Button>}</View></View>; }
