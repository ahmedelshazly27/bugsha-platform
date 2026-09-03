import { useOps } from '@bugsha/api'; import { Screen, Stat, ListRow } from '@bugsha/ui'; import { db } from '../../src/lib/supabase';
export default function C() { const kw = useOps<any>(db, 'ops_market_config', { p_market: 'KW' }); const eg = useOps<any>(db, 'ops_market_config', { p_market: 'EG' }); const flags = useOps<any[]>(db, 'ops_feature_flags', { p_market: 'KW' });
  return <Screen title="Config">{[kw.data, eg.data].filter(Boolean).map((c) => <ListRow key={c.market} title={c.market} subtitle={`commission ${c.default_commission_bp}bp · vat ${c.vat_applies ? (c.vat_bp ?? 'UNDECIDED (decision 1)') : 'off'} · v${c.version}`} />)}
    {flags.data?.map((f) => <Stat key={f.id} label={`${f.key}${f.is_kill_switch ? ' ●' : ''}`} value={f.enabled ? 'on' : 'off'} />)}</Screen>; }
