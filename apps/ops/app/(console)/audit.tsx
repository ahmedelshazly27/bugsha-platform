import { useOps } from '@bugsha/api'; import { Screen, ListRow } from '@bugsha/ui'; import { db } from '../../src/lib/supabase';
export default function A() { const q = useOps<any[]>(db, 'ops_audit', { p_from: new Date(Date.now() - 7 * 864e5).toISOString(), p_to: new Date().toISOString() });
  return <Screen title="Audit">{q.data?.map((a) => <ListRow key={a.id} title={a.operation} subtitle={`${a.at} · ${a.actor_role} · ${a.reason_code ?? ''} ${a.justification ?? ''}`} />)}</Screen>; }
