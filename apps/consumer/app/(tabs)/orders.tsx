import { FlatList } from 'react-native'; import { router } from 'expo-router';
import { useMyOrders } from '@bugsha/api'; import { formatMoney, money, type Currency } from '@bugsha/core'; import { t, formatIdentifier } from '@bugsha/i18n';
import { Screen, ListRow, Empty } from '@bugsha/ui'; import { db } from '../../src/lib/supabase'; import { useSession } from '../../src/lib/session';
export default function Orders() {
  const { locale, numerals } = useSession(); const q = useMyOrders(db);
  return <Screen title={t('orders.title', locale)}>
    <FlatList data={(q.data ?? []) as any[]} keyExtractor={(o) => o.order_id} ListEmptyComponent={<Empty title={t('orders.empty', locale)} />}
      renderItem={({ item }) => <ListRow title={item.title_snapshot} subtitle={`${formatIdentifier(item.code)} · ${t('order.status.' + item.status, locale)}`}
        trailing={formatMoney(money(item.total_minor, item.currency as Currency), locale, numerals)} onPress={() => router.push(`/order/${item.order_id}`)} />} />
  </Screen>;
}
