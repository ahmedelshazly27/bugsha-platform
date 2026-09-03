import { useState } from 'react'; import { useOps, useOpsMutation, isPendingApproval } from '@bugsha/api'; import { Screen, ListRow, Button, Notice, Stat } from '@bugsha/ui'; import { db } from '../../src/lib/supabase';
export default function M() { const runs = useOps<any[]>(db, 'ops_payout_runs', { p_market: 'KW' }); const bal = useOps<any>(db, 'ops_balance_check', { p_market: 'KW' });
  const create = useOpsMutation(db, 'ops_create_payout_run'); const approve = useOpsMutation(db, 'ops_approve_payout_run'); const [msg, setMsg] = useState('');
  return <Screen title="Money — Kuwait">{msg ? <Notice>{msg}</Notice> : null}
    {bal.data && <Stat label="Suspense" value={String(bal.data.suspense_minor)} />}
    <Button onPress={() => create.mutateAsync({ p_market: 'KW', p_period_start: new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10), p_period_end: new Date().toISOString().slice(0, 10) }).then(() => runs.refetch(), (e) => setMsg(e.code))}>Create payout run</Button>
    {runs.data?.map((r) => <ListRow key={r.id} title={`${r.period_start} → ${r.period_end}`} subtitle={r.status}
      trailing={<Button onPress={() => approve.mutateAsync({ p_run: r.id }).then((v) => setMsg(isPendingApproval(v) ? 'Recorded — needs a second approver (re-auth within 5 min)' : 'Approved'), (e) => setMsg(e.code === 'BG131' ? 'Re-authenticate to approve money operations' : e.code))}>Approve</Button>} />)}</Screen>; }
