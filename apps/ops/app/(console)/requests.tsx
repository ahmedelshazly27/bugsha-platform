// Partner requests & codes (S-O-010 / S-O-011). Kitchens ask for a partner code on bugsha.app/partners
// or in the partner app; ops reviews, issues a single-use code (the database emails it), or declines
// with a reason. Nothing else opens a partner account. Mirrors bugsha.app/ops in the site repo.
import { useState } from 'react'; import { View } from 'react-native'; import { useOps, useOpsMutation } from '@bugsha/api';
import { Badge, Banner, Button, Caption, Chip, Chips, Eyebrow, Input, ListRow, Num, SegmentedControl, T, color } from '@bugsha/ui'; import { db } from '../../src/lib/supabase';
const REASONS: Array<[string, string]> = [['category_not_eligible', 'Category not eligible'], ['outside_launch_area', 'Outside launch area'], ['duplicate', 'Duplicate request'], ['no_response', 'No response'], ['other', 'Other']];
const when = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const day = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—';
export default function Requests() {
  const [tab, setTab] = useState<'requests' | 'codes'>('requests'); const [sel, setSel] = useState<string | null>(null); const [modal, setModal] = useState<'issue' | 'decline' | 'revoke' | null>(null);
  const [days, setDays] = useState('14'); const [reason, setReason] = useState(REASONS[0]![0]); const [text, setText] = useState(''); const [msg, setMsg] = useState('');
  const reqs = useOps<any[]>(db, 'ops_partner_requests'); const codes = useOps<any[]>(db, 'ops_partner_codes');
  const issue = useOpsMutation(db, 'ops_issue_partner_code'); const decline = useOpsMutation(db, 'ops_decline_partner_request'); const revoke = useOpsMutation(db, 'ops_revoke_partner_code'); const resend = useOpsMutation(db, 'ops_resend_partner_code');
  const rows = reqs.data ?? []; const r = rows.find((x) => x.id === sel); const fresh = rows.filter((x) => x.status === 'new').length;
  const act = (m: any, args: Record<string, unknown>, ok: string) => m.mutateAsync(args).then(() => { setMsg(ok); setModal(null); setText(''); reqs.refetch(); codes.refetch(); window.setTimeout(() => codes.refetch(), 4000); }, (e: any) => setMsg(`${e.code}: ${e.serverMessage ?? e.message}`));
  const tone = (s: string) => s === 'new' ? 'time' : s === 'code_issued' ? 'fresh' : s === 'declined' ? 'neutral' : 'info';
  const codeState = (c: any) => c.revoked_at ? ['Revoked', 'neutral'] : c.redeemed_at ? [`Redeemed ${day(c.redeemed_at)}`, 'fresh'] : new Date(c.expires_at) < new Date() ? ['Expired', 'neutral'] : ['Live', 'time'];
  const mail = (c: any) => c.emailed_at ? [`Emailed ${when(c.emailed_at)}`, 'fresh'] : c.email_error ? [`Not delivered · ${c.email_error}`, 'error'] : ['Sending…', 'neutral'];
  return <>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}><T role="titleLg" weight={700}>Partner requests &amp; codes</T>
      <SegmentedControl fullWidth={false} value={tab} onChange={setTab} options={[{ value: 'requests', label: `Requests · ${fresh} new` }, { value: 'codes', label: `Codes · ${(codes.data ?? []).length}` }]} /></View>
    <Caption>Kitchens ask for a code on bugsha.app/partners or in the partner app. Issue one (single use, 14 days) and the database emails it; decline with a reason. Nothing else opens a partner account.</Caption>
    {msg ? <Banner tone="info" title={msg} /> : null}
    {tab === 'requests' ? <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
      <View style={{ flex: 1, backgroundColor: color.raised, borderRadius: 10, borderWidth: 1, borderColor: color.borderSubtle }}>
        {rows.length === 0 ? <Caption style={{ padding: 14 }}>No requests yet.</Caption> : null}
        {rows.map((x) => <ListRow key={x.id} icon="inbox" chevron onPress={() => { setSel(x.id); setModal(null); }} label={<T role="label" weight={600}>{x.trading_name}</T>} sub={`${x.market}${x.city ? ' · ' + x.city : ''} · ${x.contact_name} · ${x.contact_email} · ${day(x.created_at)}`} value={<Badge tone={tone(x.status) as any}>{String(x.status).replace('_', ' ')}</Badge>} />)}</View>
      {r ? <View style={{ width: 380, gap: 10, padding: 16, backgroundColor: color.raised, borderRadius: 10, borderWidth: 1, borderColor: color.borderSubtle }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><T role="title" weight={700}>{r.trading_name}</T><Button size="sm" variant="ghost" onPress={() => setSel(null)}>Close</Button></View>
        {[['Legal name', r.legal_name], ['Market · city', `${r.market}${r.city ? ' · ' + r.city : ''}`], ['Makes', (r.categories ?? []).join(', ') || '—'], ['Contact', `${r.contact_name} · ${r.contact_phone} · ${r.contact_email}`], ['Branches', String(r.branch_count)], ['Surplus / night', r.est_daily_surplus ?? '—'], ['Heard via', r.referral_source ?? '—'], ['Received', `${when(r.created_at)} · ${r.source ?? ''}`]].map(([k, v]) => <View key={k} style={{ flexDirection: 'row', gap: 8 }}><Caption style={{ width: 110 }}>{k}</Caption><T role="label" style={{ flex: 1 }}>{v}</T></View>)}
        {r.status === 'code_issued' ? <Banner tone="fresh" title={`Code ${r.invite_code} issued`}>{(() => { const c = (codes.data ?? []).find((y: any) => y.code === r.invite_code); return c ? mail(c)[0] : ''; })()}</Banner> : null}
        {r.status === 'declined' ? <Banner tone="info" title={`Declined · ${REASONS.find(([k]) => k === r.decline_reason)?.[1] ?? r.decline_reason}`} /> : null}
        {(r.status === 'new' || r.status === 'contacted') && !modal ? <View style={{ flexDirection: 'row', gap: 8 }}><Button iconStart="key" onPress={() => setModal('issue')}>Issue partner code</Button><Button variant="ghost" onPress={() => setModal('decline')}>Decline</Button></View> : null}
        {modal === 'issue' ? <View style={{ gap: 10, padding: 12, backgroundColor: color.sunken, borderRadius: 8 }}><T role="label" weight={600}>Issue a partner code to {r.trading_name}</T><Caption>An email goes to {r.contact_email} with the code and the sign-up link. The code is tied to this request, so sign-up pre-fills the kitchen’s details.</Caption>
          <Eyebrow>Expires in</Eyebrow><Chips>{['7', '14', '30'].map((d) => <Chip key={d} selected={days === d} onPress={() => setDays(d)}>{d} days</Chip>)}</Chips>
          <Input label="Note (optional, audit log)" value={text} onChangeText={setText} />
          <View style={{ flexDirection: 'row', gap: 8 }}><Button loading={issue.isPending} onPress={() => act(issue, { p_request: r.id, p_days: Number(days), p_reason: text || null }, `Code issued and emailed to ${r.contact_email}`)}>Issue and email</Button><Button variant="ghost" onPress={() => setModal(null)}>Cancel</Button></View></View> : null}
        {modal === 'decline' ? <View style={{ gap: 10, padding: 12, backgroundColor: color.sunken, borderRadius: 8 }}><T role="label" weight={600}>Decline {r.trading_name}</T>
          <Chips>{REASONS.map(([k, v]) => <Chip key={k} selected={reason === k} onPress={() => setReason(k)}>{v}</Chip>)}</Chips>
          <Input label={reason === 'other' ? 'Why' : 'Note (optional)'} value={text} onChangeText={setText} />
          <View style={{ flexDirection: 'row', gap: 8 }}><Button variant="danger" loading={decline.isPending} disabled={reason === 'other' && !text.trim()} onPress={() => act(decline, { p_request: r.id, p_reason_code: reason, p_text: text || null }, `${r.trading_name} declined`)}>Decline</Button><Button variant="ghost" onPress={() => setModal(null)}>Cancel</Button></View></View> : null}
      </View> : null}</View>
    : <View style={{ backgroundColor: color.raised, borderRadius: 10, borderWidth: 1, borderColor: color.borderSubtle }}>
      {(codes.data ?? []).length === 0 ? <Caption style={{ padding: 14 }}>No codes issued yet.</Caption> : null}
      {(codes.data ?? []).map((c: any) => { const st = codeState(c); const em = mail(c); const live = st[0] === 'Live'; return <View key={c.code}>
        <ListRow icon="key" label={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Num weight={700}>{c.code}</Num><T role="label" weight={600}>{c.trading_name ?? c.issued_to_name}</T></View>} sub={`${c.market} · ${c.issued_to_email} · issued ${day(c.issued_at)} · expires ${day(c.expires_at)}${c.revoke_reason ? ' · ' + c.revoke_reason : ''}`}
          value={<View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Badge tone={st[1] as any}>{st[0]}</Badge><Badge tone={em[1] as any}>{em[0]}</Badge>
            {live ? <><Button size="sm" variant="secondary" loading={resend.isPending} onPress={() => act(resend, { p_code: c.code }, `Code ${c.code} re-sent to ${c.issued_to_email}`)}>Resend</Button><Button size="sm" variant="ghost" onPress={() => { setSel(c.code); setModal(modal === 'revoke' && sel === c.code ? null : 'revoke'); setText(''); }}>Revoke</Button></> : null}</View>} />
        {modal === 'revoke' && sel === c.code ? <View style={{ gap: 10, padding: 12, margin: 12, backgroundColor: color.sunken, borderRadius: 8 }}><Caption>{c.issued_to_email} can no longer sign up with this code. The request goes back to “contacted” so a fresh code can be issued.</Caption><Input label="Why" value={text} onChangeText={setText} /><View style={{ flexDirection: 'row', gap: 8 }}><Button variant="danger" disabled={!text.trim()} loading={revoke.isPending} onPress={() => act(revoke, { p_code: c.code, p_reason: text.trim() }, `Code ${c.code} revoked`)}>Revoke</Button><Button variant="ghost" onPress={() => setModal(null)}>Cancel</Button></View></View> : null}
      </View>; })}</View>}
  </>;
}
