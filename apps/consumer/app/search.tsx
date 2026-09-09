// S-C-023 — search. Arabic matching is diacritics- and hamza-insensitive on the server.
import { useState } from 'react'; import { router } from 'expo-router'; import { View } from 'react-native';
import { useSearch } from '@bugsha/api';
import { AppBar, BagCard, EmptyState, Input, Screen } from '@bugsha/ui';
import { db } from '../src/lib/supabase'; import { useSession } from '../src/lib/session'; import { bagTitle, hhmm, leftFmt, major, useL, CUR } from '../src/lib/ui';
export default function Search() {
  const { market, cityId } = useSession(); const { L, ar } = useL(); const [q, setQ] = useState(''); const r = useSearch(db, market, q, cityId);
  const rows = (r.data ?? []) as any[];
  return <View style={{ flex: 1 }}><AppBar onBack={() => router.back()} title={<Input icon="search" placeholder={L('Search stores or food', 'ابحث عن متجر أو طعام')} value={q} onChangeText={setQ} autoFocus />} />
    <Screen top={false} gap={10}>{q.length >= 2 && rows.length === 0 && !r.isLoading ? <EmptyState icon="search" title={L(`No match for “${q}”`, `لا نتائج لـ «${q}»`)} body={L('No partner in your area lists that yet.', 'لا يوجد شريك في منطقتك يعرض ذلك بعد.')} /> : null}
      {rows.map((x) => <BagCard key={x.listing_id} layout="row" partner={x.display_name} title={bagTitle(x.category, ar)} category={x.category} priceNow={major(x.price_minor, market)} priceWas={x.value_min_minor ? major(x.value_min_minor, market) : null} currency={CUR[market].code} decimals={CUR[market].dp} from={hhmm(x.local_start)} to={hhmm(x.local_end)} bagsLeft={x.quantity_remaining} leftFormat={leftFmt(ar)} rating={Number(x.rating) || null} onPress={() => router.push(`/listing/${x.listing_id}`)} />)}</Screen></View>;
}
