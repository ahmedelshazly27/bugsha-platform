// S-P-011 — publish from a template in ≤ 3 taps, ≤ 3 API calls (one).
import { useState } from 'react'; import { Text } from 'react-native';
import { useTemplates, usePublish, useListings, useUpdateListing, RpcError } from '@bugsha/api'; import { errorMessage } from '@bugsha/i18n';
import { Screen, ListRow, Button, Field, Notice } from '@bugsha/ui'; import { db } from '../../src/lib/supabase'; import { useStore } from '../../src/lib/store';
export default function Listings() {
  const { storeId, partnerId } = useStore(); const tpl = useTemplates(db, partnerId) as any; const ls = useListings(db, storeId) as any; const publish = usePublish(db); const upd = useUpdateListing(db);
  const [qty, setQty] = useState('6'); const [err, setErr] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  return <Screen title="Listings">
    {err && <Notice tone="error">{err}</Notice>}
    <Field label="Quantity" value={qty} onChangeText={setQty} keyboardType="number-pad" />
    {tpl.data?.map((t: any) => <Button key={t.id} onPress={() => publish.mutateAsync({ templateId: t.id, quantity: Number(qty), localDate: today, localStart: t.default_window_start, localEnd: t.default_window_end }).catch((e: RpcError) => setErr(errorMessage(e.code, 'en')))}>Publish “{t.title_en}” tonight</Button>)}
    {ls.data?.map((l: any) => <ListRow key={l.listing_id} title={l.title_snapshot} subtitle={`${l.local_date} ${l.local_start}–${l.local_end} · ${l.quantity_remaining}/${l.quantity_total} · ${l.status}`}
      onPress={() => upd.mutateAsync({ listingId: l.listing_id, quantity: l.quantity_total + 1 }).catch((e: RpcError) => setErr(errorMessage(e.code, 'en', { sold: l.quantity_total - l.quantity_remaining })))} />)}
  </Screen>;
}
