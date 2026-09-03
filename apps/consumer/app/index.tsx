// S-C-001..005 — phone sign-in, then market and city.
import { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { router } from 'expo-router';
import { zPhone, type Market } from '@bugsha/core';
import { t } from '@bugsha/i18n';
import { Button, Screen, Field, Segmented } from '@bugsha/ui';
import { db } from '../src/lib/supabase';
import { useSession } from '../src/lib/session';

export default function SignIn() {
  const { locale, set } = useSession();
  const [market, setMarket] = useState<Market>('KW');
  const [phone, setPhone] = useState(market === 'KW' ? '+965' : '+20');
  const [otp, setOtp] = useState(''); const [stage, setStage] = useState<'phone' | 'otp'>('phone'); const [err, setErr] = useState<string | null>(null);

  async function send() {
    const v = zPhone(market).safeParse(phone); if (!v.success) return setErr(v.error.issues[0]?.message ?? 'phone.invalid');
    const { error } = await db.auth.signInWithOtp({ phone }); if (error) return setErr('BG140'); setErr(null); setStage('otp');
  }
  async function verify() {
    const { error } = await db.auth.verifyOtp({ phone, token: otp, type: 'sms' }); if (error) return setErr('BG100');
    set({ market, locale: market === 'KW' ? 'ar-KW' : 'ar-EG' }); router.replace('/city');
  }
  return (
    <Screen title="Bugsha">
      <Segmented value={market} onChange={(m) => { setMarket(m as Market); setPhone(m === 'KW' ? '+965' : '+20'); }} options={[{ value: 'KW', label: 'الكويت' }, { value: 'EG', label: 'مصر' }]} />
      {stage === 'phone' ? <>
        <Field label={t('auth.phone', locale)} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Button onPress={send}>{t('auth.send_code', locale)}</Button>
      </> : <>
        <Field label={t('auth.code', locale)} value={otp} onChangeText={setOtp} keyboardType="number-pad" />
        <Button onPress={verify}>{t('auth.verify', locale)}</Button>
      </>}
      {err && <Text accessibilityRole="alert">{t(err, locale, {}, 'errors')}</Text>}
      <Text style={{ marginTop: 24 }}>{t('safety.headline', locale)}</Text>
    </Screen>
  );
}
