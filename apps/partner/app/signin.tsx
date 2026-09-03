import { useState } from 'react'; import { router } from 'expo-router'; import { Screen, Field, Button } from '@bugsha/ui'; import { db } from '../src/lib/supabase';
export default function SignIn() {
  const [phone, setPhone] = useState('+965'); const [otp, setOtp] = useState(''); const [sent, setSent] = useState(false);
  return <Screen title="Bugsha Partner">
    <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
    {!sent ? <Button onPress={async () => { await db.auth.signInWithOtp({ phone }); setSent(true); }}>Send code</Button>
           : <><Field label="Code" value={otp} onChangeText={setOtp} keyboardType="number-pad" /><Button onPress={async () => { const { error } = await db.auth.verifyOtp({ phone, token: otp, type: 'sms' }); if (!error) router.replace('/(tabs)'); }}>Sign in</Button></>}
  </Screen>;
}
