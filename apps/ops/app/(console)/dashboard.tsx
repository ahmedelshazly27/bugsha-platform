import { View } from 'react-native'; import { useOps } from '@bugsha/api'; import { Eyebrow, PartnerStat, T } from '@bugsha/ui'; import { db } from '../../src/lib/supabase';
const Grid = ({ d }: { d: Record<string, unknown> | undefined }) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>{d ? Object.entries(d).map(([k, v]) => <PartnerStat key={k} label={k.replace(/_/g, ' ')} value={String(v)} style={{ minWidth: 180, flex: 0 }} />) : null}</View>;
export default function D() { const kw = useOps<any>(db, 'ops_live_dashboard', { p_market: 'KW' }); const eg = useOps<any>(db, 'ops_live_dashboard', { p_market: 'EG' });
  return <><T role="titleLg" weight={700}>Live</T><Eyebrow>Kuwait</Eyebrow><Grid d={kw.data} /><Eyebrow>Egypt</Eyebrow><Grid d={eg.data} /></>; }
