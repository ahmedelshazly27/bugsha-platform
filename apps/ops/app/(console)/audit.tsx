// S-O-091 Audit log: window, operation and actor filters, CSV export. Every ops action lands here with its reason.
import { useMemo, useState } from 'react'; import { View } from 'react-native'; import { useOps } from '@bugsha/api';
import { Badge, Button, Caption, Input, ListRow, Num, T, color } from '@bugsha/ui'; import { db } from '../../src/lib/supabase';
import { Choice, Panel, Empty, Row, daysAgo, exportCsv, when, short } from '../../src/lib/console';
export default function A() {
  const [days, setDays] = useState('7'); const [op, setOp] = useState(''); const [actor, setActor] = useState(''); const [open, setOpen] = useState<string | null>(null);
  // The window is fixed per selection, not per render — otherwise the query key changes every render and refetches forever.
  const window = useMemo(() => ({ p_from: daysAgo(Number(days)).toISOString(), p_to: new Date().toISOString() }), [days]);
  const q = useOps<any[]>(db, 'ops_audit', { ...window, p_operation: op.trim() || null, p_actor: /^[0-9a-f-]{36}$/i.test(actor.trim()) ? actor.trim() : null, p_limit: 500 }); const rows = q.data ?? [];
  const ops = Array.from(new Set(rows.map((a) => a.operation))).sort();
  return <>
    <Row style={{ justifyContent: 'space-between' }}><T role="titleLg" weight={700}>Audit</T><Button size="sm" variant="ghost" iconStart="download" onPress={() => exportCsv('audit', rows)}>Export CSV</Button></Row>
    <Row><Choice options={[['1', '24 hours'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days']]} value={days} onChange={setDays} /><View style={{ width: 240 }}><Input icon="search" placeholder="Operation (ops_force_cancel)" value={op} onChangeText={setOp} /></View><View style={{ width: 300 }}><Input placeholder="Actor user id" value={actor} onChangeText={setActor} /></View></Row>
    {ops.length > 1 && !op ? <Caption>{ops.length} operations in the window: {ops.slice(0, 12).join(', ')}{ops.length > 12 ? '…' : ''}</Caption> : null}
    <Panel>{rows.length === 0 ? <Empty>{q.isLoading ? 'Loading…' : 'Nothing in this window.'}</Empty> : rows.map((a) => <View key={a.id}><ListRow icon="file-text" onPress={() => setOpen(open === a.id ? null : a.id)} label={<Row><T role="label" weight={600}>{a.operation}</T>{a.market ? <Badge>{a.market}</Badge> : null}</Row>} sub={`${a.actor_role ?? ''} ${short(a.actor)} · ${a.target_type ?? ''} ${short(a.target_id)} · ${a.reason_code ?? ''} ${a.justification ?? ''}`} value={<Num role="caption" color={color.textSecondary}>{when(a.at)}</Num>} />
      {open === a.id ? <View style={{ padding: 12, backgroundColor: color.sunken }}><Caption>{JSON.stringify({ before: a.before, after: a.after, approval: a.approval_id ?? a.pending_approval ?? undefined }, null, 1)}</Caption></View> : null}</View>)}</Panel></>; }
