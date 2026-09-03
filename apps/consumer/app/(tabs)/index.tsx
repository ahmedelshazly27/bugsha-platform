// S-C-020 — browse. Designed Arabic-first; urgency is real information only.
import { FlatList, Text, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { useBrowse } from '@bugsha/api';
import { formatMoney, money, type Currency } from '@bugsha/core';
import { t, formatWindow } from '@bugsha/i18n';
import { Screen, BagCard, Empty } from '@bugsha/ui';
import { db } from '../../src/lib/supabase';
import { useSession } from '../../src/lib/session';

export default function Browse() {
  const { market, cityId, locale, numerals } = useSession();
  const q = useBrowse(db, market, cityId);
  const rows = (q.data ?? []) as Array<Record<string, any>>;
  return (
    <Screen title={t('browse.header.title', locale)}>
      <FlatList data={rows} keyExtractor={(r) => r.listing_id} refreshControl={<RefreshControl refreshing={q.isFetching} onRefresh={() => q.refetch()} />}
        ListEmptyComponent={<Empty title={t('browse.empty.title', locale)} />}
        renderItem={({ item }) => (
          <BagCard title={item.title_snapshot} store={item.display_name}
            price={formatMoney(money(item.price_minor, item.currency as Currency), locale, numerals)}
            value={formatMoney(money(item.value_min_minor, item.currency as Currency), locale, numerals)}
            left={item.quantity_remaining} leftLabel={t('bag.left', locale, { count: item.quantity_remaining })}
            window={formatWindow(new Date(item.window_start_utc), new Date(item.window_end_utc), { locale, market })}
            onPress={() => router.push(`/listing/${item.listing_id}`)} />
        )} />
    </Screen>
  );
}
