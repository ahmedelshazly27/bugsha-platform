// S-C-035/036 — payment. Opens the URL the server returns; the client never
// touches a PSP. Ambiguous return: NO retry control, hold extended, poll (06-payments.md).
import { Text } from 'react-native'; import { useLocalSearchParams } from 'expo-router';
import { Screen, Notice, Button } from '@bugsha/ui'; import { db } from '../src/lib/supabase'; import { useSession } from '../src/lib/session';
import { t } from '@bugsha/i18n'; import { useState } from 'react'; import { newIdempotencyKey } from '@bugsha/api';
export default function Pay() {
  const { order } = useLocalSearchParams<{ order: string }>(); const { locale } = useSession(); const [state, setState] = useState<'idle' | 'processing' | 'ambiguous' | 'failed'>('idle');
  async function start() {
    setState('processing');
    const { data, error } = await db.functions.invoke('create-payment', { body: { orderId: order }, headers: { 'idempotency-key': newIdempotencyKey() } });
    if (error) { setState(error.message?.includes('BG140') ? 'ambiguous' : 'failed'); return; }
    if (data?.redirectUrl) (globalThis as any).open?.(data.redirectUrl);
  }
  return <Screen title={t('checkout.total.label', locale)}>
    {state === 'idle' && <Button onPress={start}>{t('checkout.pay', locale, { amount: '' })}</Button>}
    {state === 'processing' && <Notice>{t('checkout.processing', locale)}</Notice>}
    {state === 'ambiguous' && <Notice tone="warn">{t('BG140', locale, {}, 'errors')}</Notice>}
    {state === 'failed' && <><Notice tone="error">{t('checkout.payment_failed', locale)}</Notice><Button onPress={start}>{t('common.retry', locale)}</Button></>}
    <Text style={{ marginTop: 12, opacity: 0.6 }}>Payment providers are configured in phase 6/7.</Text>
  </Screen>;
}
