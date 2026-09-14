// S-O-031 Moderation queue: listings flagged for forbidden terms or a price above the market fraction.
// Approve as-is, approve with edits, or reject with a reason the partner sees.
import { useState } from 'react'; import { View } from 'react-native'; import { useOps, useOpsMutation } from '@bugsha/api';
import { Badge, Banner, Button, Caption, Input, ListRow, Num, T } from '@bugsha/ui'; import { db } from '../../src/lib/supabase';
import { Field, FormBox, Panel, Empty, Row, money, useAct, when } from '../../src/lib/console';
export default function Moderation() {
  const q = useOps<any[]>(db, 'ops_moderation_queue'); const mod = useOpsMutation(db, 'ops_moderate_listing'); const { msg, tone, act } = useAct();
  const [sel, setSel] = useState<string | null>(null); const [title, setTitle] = useState(''); const [desc, setDesc] = useState(''); const [reason, setReason] = useState(''); const [mode, setMode] = useState<'view' | 'edit' | 'reject'>('view');
  const rows = q.data ?? []; const l = rows.find((x) => x.listing_id === sel); const open = (x: any) => { setSel(x.listing_id); setTitle(x.title_snapshot ?? ''); setDesc(x.description_snapshot ?? ''); setReason(''); setMode('view'); };
  const done = () => { q.refetch(); setSel(null); };
  return <>
    <T role="titleLg" weight={700}>Moderation</T>
    <Caption>Listings land here when the copy contains a forbidden term or the price is above the market’s fraction of value. They stay unpublished until you decide.</Caption>
    {msg ? <Banner tone={tone} title={msg} /> : null}
    <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
      <Panel style={{ flex: 1 }}>{rows.length === 0 ? <Empty>{q.isLoading ? 'Loading…' : 'Queue is empty.'}</Empty> : rows.map((x) => <ListRow key={x.listing_id} icon="eye" chevron onPress={() => open(x)} label={<T role="label" weight={600}>{x.title_snapshot}</T>} sub={`${x.market} · ${money(x.price_minor, x.market)} of ${money(x.value_min_minor, x.market)} value · ${x.quantity_total} bags · ${x.local_date} · flagged ${when(x.created_at)}`} value={<Badge tone="urgent">flagged</Badge>} />)}</Panel>
      {l ? <Panel style={{ width: 440, padding: 14, gap: 10 }}>
        <Row style={{ justifyContent: 'space-between' }}><T role="title" weight={700}>Review</T><Button size="sm" variant="ghost" onPress={() => setSel(null)}>Close</Button></Row>
        <Field k="Title" v={l.title_snapshot} /><Field k="Description" v={l.description_snapshot ?? '—'} /><Field k="Category" v={l.category ?? '—'} /><Field k="Price" v={`${money(l.price_minor, l.market)} · value ${money(l.value_min_minor, l.market)} · ${l.value_min_minor ? Math.round((l.price_minor / l.value_min_minor) * 100) : '—'}% of value`} /><Field k="Allergens" v={(l.allergen_snapshot ?? []).join(', ') || '—'} /><Field k="Window" v={`${when(l.window_start_utc)} · cutoff ${when(l.reservation_cutoff_utc)}`} />
        {mode === 'view' ? <Row><Button onPress={() => act(mod, { p_listing: l.listing_id, p_action: 'approve', p_reason: 'reviewed — no issue' }, 'Approved and published', done)}>Approve</Button><Button variant="secondary" onPress={() => setMode('edit')}>Approve with edits</Button><Button variant="danger" onPress={() => setMode('reject')}>Reject</Button></Row> : null}
        {mode === 'edit' ? <FormBox title="Edit and publish"><Input label="Title" value={title} onChangeText={setTitle} /><Input label="Description" value={desc} onChangeText={setDesc} multiline /><Input label="What you changed and why (partner sees this)" value={reason} onChangeText={setReason} /><Row><Button disabled={!reason.trim() || !title.trim()} onPress={() => act(mod, { p_listing: l.listing_id, p_action: 'edit', p_reason: reason.trim(), p_edits: { title: title.trim(), description: desc.trim() } }, 'Published with your edits', done)}>Publish edited</Button><Button variant="ghost" onPress={() => setMode('view')}>Back</Button></Row></FormBox> : null}
        {mode === 'reject' ? <FormBox title="Reject"><Caption>The partner sees the reason and can fix the listing and republish.</Caption><Input label="Reason" value={reason} onChangeText={setReason} placeholder="e.g. medical claim in the description" /><Row><Button variant="danger" disabled={!reason.trim()} onPress={() => act(mod, { p_listing: l.listing_id, p_action: 'reject', p_reason: reason.trim() }, 'Rejected — partner notified', done)}>Reject</Button><Button variant="ghost" onPress={() => setMode('view')}>Back</Button></Row></FormBox> : null}
      </Panel> : null}</View></>; }
