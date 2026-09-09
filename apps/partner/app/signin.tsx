import { useState } from 'react'; import { router } from 'expo-router'; import { Screen, Field, Button } from '@bugsha/ui'; import { db } from '../src/lib/supabase';
export default function SignIn() {
  const [email, setEmail] = useState(''); const [otp, setOtp] = useState(''); const [sent, setSent] = useState(false);
  return <Screen title="Bugsha Partner">
    <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
    {!sent ? <Button onPress={async () => { await db.auth.signInWithOtp({ email: email.trim() }); setSent(true); }}>Send code</Button>
           : <><Field label="Code" value={otp} onChangeText={setOtp} keyboardType="number-pad" /><Button onPress={async () => { const { error } = await db.auth.verifyOtp({ email: email.trim(), token: otp, type: 'email' }); if (!error) router.replace('/(tabs)'); }}>Sign in</Button></>}
  </Screen>;
}
