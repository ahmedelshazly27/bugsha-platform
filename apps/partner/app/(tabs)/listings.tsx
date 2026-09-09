// §3 Listings — the fast publish path has no price field: price is inherited from the template.
import { useState } from 'react'; import { View } from 'react-native';
import { useListings, usePublish, useTemplates, RpcError } from '@bugsha/api'; import { errorMessage } from '@bugsha/i18n';
import { AppBar, Badge, Banner, Button, Card, Caption, Eyebrow, ListRow, Num, Screen, Stepper, T, color } from '@bugsha/ui';
import { db } from '../../src/lib/supabase'; import { useSession } from '../../src/lib/session'; import { useStore } from '../../src/lib/store'; import { hhmm, money, useL } from '../../src/lib/ui';
export default function Listings() {
  const s = useStore(); const { locale } = useSession(); const { L, ar } = useL(); const tpl = useTemplates(db, s.partnerId) as any; const ls = useListings(db, s.storeId) as any; const publish = usePublish(db);
  const [qty, setQty] = useState(6); const [err, setErr] = useState<string | null>(null); const today = new Date().toISOString().slice(0, 10);
  const status: Record<string, [string, any]> = { active: [L('Live', 'نشط'), 'fresh'], sold_out: [L('Sold out', 'نفدت'), 'neutral'], cancelled: [L('Cancelled', 'ملغي'), 'error'], expired: [L('Closed', 'مغلق'), 'neutral'], scheduled: [L('Scheduled', 'مجدول'), 'time'] };
  return <View style={{ flex: 1 }}><AppBar title={L('Listings', 'العروض')} sub={s.storeName} back={false} />
    <Screen top={false} gap={12}>
      <Eyebrow>{L('List tonight in one tap', 'أضف عرض الليلة بضغطة')}</Eyebrow>
      <Card><View style={{ gap: 10 }}><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><T weight={600}>{L('How many bags?', 'كم بقشة؟')}</T><Stepper value={qty} min={1} max={50} onChange={setQty} /></View>
        {((tpl.data ?? []) as any[]).map((t) => <Button key={t.id} variant="secondary" fullWidth iconStart="plus" loading={publish.isPending} onPress={() => { setErr(null); publish.mutateAsync({ templateId: t.id, quantity: qty, localDate: today, localStart: t.default_window_start, localEnd: t.default_window_end }).then(() => ls.refetch()).catch((e: RpcError) => setErr(errorMessage(e.code, locale))); }}>{`${ar ? t.title_ar : t.title_en} · ${money(t.price_minor, s.market)} · ${hhmm(t.default_window_start)}–${hhmm(t.default_window_end)}`}</Button>)}
        {(tpl.data ?? []).length === 0 ? <Caption>{L('No templates yet. Your owner creates them from the desktop console.', 'لا قوالب بعد. ينشئها المالك من لوحة سطح المكتب.')}</Caption> : null}
        {err ? <Banner tone="error" title={err} /> : null}</View></Card>
      <Eyebrow>{L('Recent', 'الأخيرة')}</Eyebrow>
      <View>{((ls.data ?? []) as any[]).map((l) => <ListRow key={l.listing_id} icon="package" label={<T role="label" weight={600}>{l.title_snapshot}</T>} sub={<View style={{ flexDirection: 'row', gap: 4 }}><Num role="caption" color={color.textSecondary}>{`${l.local_date} ${hhmm(l.local_start)}–${hhmm(l.local_end)}`}</Num><Caption>·</Caption><Num role="caption" color={color.textSecondary}>{`${l.quantity_total - l.quantity_remaining}/${l.quantity_total}`}</Num></View>} value={<Badge tone={(status[l.status]?.[1] ?? 'neutral') as any}>{status[l.status]?.[0] ?? l.status}</Badge>} />)}</View></Screen></View>;
}
