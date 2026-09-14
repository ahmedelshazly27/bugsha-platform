// S-O-001 Live: today's numbers per market, the needs-a-person list, the onboarding funnel and supply vs demand.
import { useState } from 'react'; import { View } from 'react-native'; import { router } from 'expo-router'; import { useOps } from '@bugsha/api';
import { Badge, Caption, Eyebrow, ListRow, Num, PartnerStat, T, color } from '@bugsha/ui'; import { db } from '../../src/lib/supabase';
import { MarketToggle, Panel, Empty, Row, daysAgo, isoDate, money, when, type Market } from '../../src/lib/console';
const KPI: Array<[string, string, (v: any, m: Market) => string, 'neutral' | 'urgent' | 'fresh' | undefined]> = [
  ['live_listings', 'Live listings', (v) => String(v ?? 0), undefined], ['bags_remaining', 'Bags remaining', (v) => String(v ?? 0), undefined], ['orders_today', 'Orders today', (v) => String(v ?? 0), 'fresh'],
  ['gmv_today_minor', 'GMV today', (v, m) => money(v, m), undefined], ['open_disputes', 'Open disputes', (v) => String(v ?? 0), undefined], ['paused_stores', 'Paused stores', (v) => String(v ?? 0), undefined], ['jobs_alerting', 'Jobs alerting', (v) => String(v ?? 0), undefined]];
export default function D() {
  const [m, setM] = useState<Market>('KW'); const live = useOps<any>(db, 'ops_live_dashboard', { p_market: m }); const health = useOps<any[]>(db, 'ops_partner_health'); const funnel = useOps<any[]>(db, 'ops_onboarding_funnel', { p_from: isoDate(daysAgo(30)), p_to: isoDate(new Date()) }); const sd = useOps<any[]>(db, 'ops_supply_demand', { p_market: m, p_from: isoDate(daysAgo(13)), p_to: isoDate(new Date()) });
  const d = live.data ?? {}; const tasks = (health.data ?? []).filter((t) => !t.resolved_at); const sdRows = sd.data ?? []; const max = Math.max(1, ...sdRows.map((r) => Math.max(Number(r.bags ?? 0), Number(r.orders ?? 0))));
  return <>
    <Row style={{ justifyContent: 'space-between' }}><T role="titleLg" weight={700}>Live</T><MarketToggle value={m} onChange={(v) => setM(v ?? 'KW')} /></Row>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>{KPI.map(([k, label, fmt, tone]) => <PartnerStat key={k} label={label} value={fmt(d[k], m)} tone={k === 'jobs_alerting' && Number(d[k]) > 0 ? 'urgent' : k === 'open_disputes' && Number(d[k]) > 0 ? 'urgent' : tone ?? 'neutral'} style={{ minWidth: 150, flex: 1 }} />)}</View>
    <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <View style={{ flex: 2, minWidth: 420, gap: 8 }}><Eyebrow>Needs a person · {tasks.length}</Eyebrow><Panel>
        {tasks.length === 0 ? <Empty>Nothing waiting. Partners are healthy.</Empty> : tasks.map((t: any, i: number) => <ListRow key={t.id ?? i} icon={t.severity === 'critical' || t.kind === 'alert' ? 'triangle-alert' : 'store'} chevron={!!t.partner_id} onPress={t.partner_id ? () => router.push(`/(console)/partner/${t.partner_id}`) : undefined} label={<T role="label" weight={600}>{String(t.kind ?? 'task').replace(/_/g, ' ')}</T>} sub={[t.evidence ? Object.entries(t.evidence).map(([k, v]) => `${k.replace(/_/g, ' ')} ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') : null, `opened ${when(t.opened_at)}`].filter(Boolean).join(' · ')} value={<Badge tone={t.severity === 'critical' ? 'error' : t.severity === 'warning' || t.kind === 'alert' ? 'urgent' : 'time'}>{t.severity ?? t.kind ?? 'task'}</Badge>} />)}</Panel></View>
      <View style={{ flex: 1, minWidth: 280, gap: 8 }}><Eyebrow>Onboarding funnel · 30 days</Eyebrow><Panel>
        {(funnel.data ?? []).length === 0 ? <Empty>No applications in the window.</Empty> : (funnel.data ?? []).map((f: any) => <ListRow key={f.stage} label={String(f.stage).replace(/_/g, ' ')} value={<Num weight={700}>{String(f.partners ?? 0)}</Num>} />)}</Panel></View></View>
    <Eyebrow>Supply vs demand · last 14 days</Eyebrow>
    <Panel style={{ padding: 14, gap: 8 }}>
      {sdRows.length === 0 ? <Caption>No listings or orders in the window.</Caption> : sdRows.map((r: any) => <View key={r.day} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Num role="caption" style={{ width: 64 }}>{String(r.day).slice(5)}</Num>
        <View style={{ flex: 1, gap: 3 }}><View style={{ height: 8, width: `${(Number(r.bags ?? 0) / max) * 100}%`, backgroundColor: color.brandTint, borderRadius: 4 }} /><View style={{ height: 8, width: `${(Number(r.orders ?? 0) / max) * 100}%`, backgroundColor: color.brand, borderRadius: 4 }} /></View>
        <Caption style={{ width: 200 }}>{`${r.bags ?? 0} bags · ${r.orders ?? 0} orders · ${r.listings ?? 0} listings · ${r.sell_through != null ? Math.round(Number(r.sell_through) * 100) + '% sold' : ''}`}</Caption></View>)}
      <Row><View style={{ width: 10, height: 10, backgroundColor: color.brandTint, borderRadius: 2 }} /><Caption>Bags listed</Caption><View style={{ width: 10, height: 10, backgroundColor: color.brand, borderRadius: 2, marginStart: 10 }} /><Caption>Orders</Caption></Row></Panel>
  </>; }
