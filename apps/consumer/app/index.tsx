// S-C-001..005 — email code sign-in (D23), then market and city.
import { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { router } from 'expo-router';
import { type Market } from '@bugsha/core';
import { z } from 'zod';
import { t } from '@bugsha/i18n';
import { Button, Screen, Field, Segmented } from '@bugsha/ui';
import { db } from '../src/lib/supabase';
import { useSession } from '../src/lib/session';

export default function SignIn() {
  const { locale, set } = useSession();
  const [market, setMarket] = useState<Market>('KW');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState(''); const [stage, setStage] = useState<'email' | 'otp'>('email'); const [err, setErr] = useState<string | null>(null);

  async function send() {
    if (!z.string().email().safeParse(email.trim()).success) return setErr('BG102');
    const { error } = await db.auth.signInWithOtp({ email: email.trim() }); if (error) return setErr('BG140'); setErr(null); setStage('otp');
  }
  async function verify() {
    const { error } = await db.auth.verifyOtp({ email: email.trim(), token: otp, type: 'email' }); if (error) return setErr('BG100');
    set({ market, locale: market === 'KW' ? 'ar-KW' : 'ar-EG' }); router.replace('/city');
  }
  return (
    <Screen title="Bugsha">
      <Segmented value={market} onChange={(m) => setMarket(m as Market)} options={[{ value: 'KW', label: 'الكويت' }, { value: 'EG', label: 'مصر' }]} />
      {stage === 'email' ? <>
        <Field label={t('auth.email', locale)} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
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
