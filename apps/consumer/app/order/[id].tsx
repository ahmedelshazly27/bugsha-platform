// S-C-034..047 — checkout (hold), then the order with its redemption code.
// The code renders from cache with no signal (14-mobile.md §4).
import { Text } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useOrder, useReserveCash, useReleaseHold, useCancelOrder } from '@bugsha/api';
import { formatMoney, money, type Currency, windowState } from '@bugsha/core';
import { t, formatWindow, refundTimingMessage, formatIdentifier } from '@bugsha/i18n';
import { Screen, Button, RedemptionCode, Notice, Countdown } from '@bugsha/ui';
import { db } from '../../src/lib/supabase';
import { useSession } from '../../src/lib/session';

export default function Order() {
  const { id } = useLocalSearchParams<{ id: string }>(); const { locale, numerals, market } = useSession();
  const q = useOrder(db, id!); const cash = useReserveCash(db); const release = useReleaseHold(db); const cancel = useCancelOrder(db);
  const d = q.data as any; if (!d) return <Screen title="…"><Text>…</Text></Screen>;
  const o = d.order; const cur = o.currency as Currency; const total = formatMoney(money(o.total_minor, cur), locale, numerals);
  const state = windowState(new Date(), new Date(o.window_start_utc), new Date(o.window_end_utc), 30);
  return (
    <Screen title={d.store.display_name}>
      {o.status === 'held' && <>
        <Countdown until={new Date(o.hold_expires_at)} label={t('checkout.hold_expires', locale)} />
        <Text>{t('checkout.total.label', locale)}: {total}</Text>
        {market === 'EG' && <Button onPress={() => cash.mutateAsync({ orderId: id! }).then(() => q.refetch())}>{t('checkout.cash.confirm', locale)}</Button>}
        <Button onPress={() => router.push({ pathname: '/pay', params: { order: id } })}>{t('checkout.pay', locale, { amount: total })}</Button>
        <Button tone="ghost" onPress={() => release.mutateAsync(id!).then(() => router.back())}>{t('common.cancel', locale)}</Button>
      </>}
      {(o.status === 'reserved' || o.status === 'redeemed') && <>
        <RedemptionCode code={formatIdentifier(o.code)} />
        <Text>{t('redeem.instruction', locale)}</Text>
        <Text>{formatWindow(new Date(o.window_start_utc), new Date(o.window_end_utc), { locale, market })} · {d.store.pickup_point_en}</Text>
        {state === 'closing_soon' && <Notice>{t('window.closing', locale, { minutes: 30 })}</Notice>}
        {o.status === 'redeemed' && <Notice tone="success">{t('redeem.success', locale)}</Notice>}
        {o.status === 'reserved' && new Date() < new Date(d.cancellation_cutoff_at) &&
          <Button tone="ghost" onPress={() => cancel.mutateAsync({ orderId: id!, reasonCode: 'consumer_request' }).then(() => q.refetch())}>{t('order.cancel', locale)}</Button>}
        {o.status === 'reserved' && <Text>{t('redeem.running_late', locale)} {d.store.contact_phone}</Text>}
      </>}
      {o.status === 'no_show' && <Notice>{t('order.no_show', locale)}</Notice>}
      {(o.status === 'cancelled_consumer' || o.status === 'refunded') && <Notice>{t('order.cancelled', locale)} — {refundTimingMessage(market, d.refund_timing_key.split('.')[1], locale)}</Notice>}
    </Screen>
  );
}
