// S-P-010 — Today: next window, listings, gross, alerts. Cold start ≤ 3 s on 3G.
import { Text } from 'react-native'; import { useToday } from '@bugsha/api'; import { Screen, Stat, Notice, ListRow } from '@bugsha/ui';
import { db } from '../../src/lib/supabase'; import { useStore } from '../../src/lib/store';
export default function Today() {
  const { storeId } = useStore(); const q = useToday(db, storeId) as any; const d = q.data;
  if (!d) return <Screen title="Today"><Text>…</Text></Screen>;
  return <Screen title={d.store.display_name}>
    {d.store.publishing_blocked && <Notice tone="warn">New listings paused — existing orders are honoured.</Notice>}
    <Stat label="Gross today" value={String(d.gross_today_minor)} /><Stat label="Outstanding" value={String(d.orders_outstanding)} />
    {d.listings_today?.map((l: any) => <ListRow key={l.listing_id} title={l.title} subtitle={`${l.quantity_remaining}/${l.quantity_total} · ${l.status}`} />)}
    {d.alerts?.map((a: any, i: number) => <Notice key={i} tone="warn">{a.doc_type} expires {a.expires_on}</Notice>)}
  </Screen>;
}
