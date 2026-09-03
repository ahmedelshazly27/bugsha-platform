// S-C-030 — detail and the 10-minute hold. The platform never guarantees contents (rule 10).
import { Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useListing, useHold, RpcError } from '@bugsha/api';
import { formatMoney, money, type Currency } from '@bugsha/core';
import { t, formatWindow, errorMessage } from '@bugsha/i18n';
import { Screen, Button, PriceTag, Notice } from '@bugsha/ui';
import { db } from '../../src/lib/supabase';
import { useSession } from '../../src/lib/session';
import { useState } from 'react';

export default function Listing() {
  const { id } = useLocalSearchParams<{ id: string }>(); const { locale, numerals, market } = useSession();
  const q = useListing(db, id!); const hold = useHold(db); const [err, setErr] = useState<string | null>(null);
  const l = ((q.data as any[]) ?? [])[0]; if (!l) return <Screen title="…"><Text>…</Text></Screen>;
  const cur = l.currency as Currency;
  return (
    <Screen title={l.title}>
      <Text>{l.store_name} · {formatWindow(new Date(l.window_start_utc), new Date(l.window_end_utc), { locale, market })}</Text>
      <PriceTag price={formatMoney(money(l.price_minor, cur), locale, numerals)} was={formatMoney(money(l.value_min_minor, cur), locale, numerals)} />
      <Text>{l.description}</Text>
      <Notice>{t('safety.contents_vary', locale)}</Notice>
      {err && <Notice tone="error">{err}</Notice>}
      <Button onPress={async () => {
        try { const o = await hold.mutateAsync({ listingId: id!, quantity: 1 }) as any; router.push(`/order/${o.order_id}`); }
        catch (e) { setErr(errorMessage((e as RpcError).code, locale)); }
      }}>{t('browse.reserve.action', locale, { amount: formatMoney(money(l.price_minor, cur), locale, numerals) })}</Button>
    </Screen>
  );
}
