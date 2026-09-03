import { useOps, useOpsMutation } from '@bugsha/api'; import { Screen, ListRow, Button } from '@bugsha/ui'; import { db } from '../../src/lib/supabase';
export default function J() { const q = useOps<any[]>(db, 'ops_jobs'); const run = useOpsMutation(db, 'ops_trigger_job');
  return <Screen title="Jobs">{q.data?.map((j) => <ListRow key={j.job_name} title={`${j.alerting ? '⚠ ' : ''}${j.job_name}`} subtitle={`${j.status} · ${j.rows_affected ?? 0} rows · ${j.last_run}${j.error ? ' · ' + j.error : ''}`}
    trailing={<Button tone="ghost" onPress={() => run.mutateAsync({ p_name: j.job_name }).then(() => q.refetch())}>Run</Button>} />)}</Screen>; }
