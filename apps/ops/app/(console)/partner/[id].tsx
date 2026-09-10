// o1 — partner detail: documents to verify, contract, stores, staff, activation. Every action carries a reason.
import { useState } from 'react'; import { router, useLocalSearchParams } from 'expo-router'; import { View } from 'react-native';
import { useOps, useOpsMutation } from '@bugsha/api';
import { Badge, Banner, Button, Caption, Card, Eyebrow, Input, ListRow, Num, T, color } from '@bugsha/ui'; import { db } from '../../../src/lib/supabase';
export default function PartnerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>(); const q = useOps<any>(db, 'ops_partner_detail', { p_partner: id }); const verify = useOpsMutation(db, 'ops_verify_document'); const approve = useOpsMutation(db, 'ops_approve_partner'); const activate = useOpsMutation(db, 'ops_activate_partner'); const reject = useOpsMutation(db, 'ops_reject_partner');
  const [msg, setMsg] = useState(''); const [reason, setReason] = useState(''); const d = q.data; if (!d) return <Caption>…</Caption>; const p = d.partner ?? {};
  const act = (m: any, args: Record<string, unknown>, ok: string) => m.mutateAsync(args).then(() => { setMsg(ok); q.refetch(); }, (e: any) => setMsg(`${e.code}: ${e.serverMessage ?? e.message}`));
  return <>
    <Button variant="ghost" size="sm" iconStart="arrow-left" onPress={() => router.back()}>Partners</Button>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><T role="titleLg" weight={700}>{p.trading_name}</T><Badge tone={p.onboarding_status === 'active' ? 'fresh' : p.onboarding_status === 'rejected' ? 'error' : 'time'}>{p.onboarding_status}</Badge><Caption>{p.market} · reliability {p.reliability_score}</Caption></View>
    {msg ? <Banner tone="info" title={msg} /> : null}
    <Eyebrow>Documents</Eyebrow>
    <View style={{ backgroundColor: color.raised, borderRadius: 10, borderWidth: 1, borderColor: color.borderSubtle }}>{(d.documents ?? []).map((x: any) => <ListRow key={x.id} icon="file-text" label={x.doc_type.replace(/_/g, ' ')} sub={`${x.storage_path}${x.expires_on ? ' · expires ' + x.expires_on : ''}${x.rejection_text ? ' · ' + x.rejection_text : ''}`} value={<View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Badge tone={x.status === 'approved' ? 'fresh' : x.status === 'rejected' ? 'error' : 'time'}>{x.status}</Badge>{x.status !== 'approved' ? <><Button size="sm" variant="secondary" onPress={() => act(verify, { p_doc: x.id, p_approve: true }, 'Document approved')}>Approve</Button><Button size="sm" variant="ghost" onPress={() => act(verify, { p_doc: x.id, p_approve: false, p_reason_code: 'unreadable', p_text: reason || 'Please re-upload a legible copy' }, 'Document rejected')}>Reject</Button></> : null}</View>} />)}
      {(d.documents ?? []).length === 0 ? <ListRow label="No documents uploaded yet" /> : null}</View>
    <Eyebrow>Contracts</Eyebrow>
    <View style={{ backgroundColor: color.raised, borderRadius: 10, borderWidth: 1, borderColor: color.borderSubtle }}>{(d.contracts ?? []).map((c: any) => <ListRow key={c.id} icon="file-text" label={<Num role="label" weight={600}>{`v${c.version} · ${c.commission_bp / 100}%`}</Num>} sub={`${c.payout_cadence} · from ${c.effective_from}`} value={<Badge tone={c.accepted_at ? 'fresh' : 'time'}>{c.accepted_at ? 'accepted' : 'awaiting partner'}</Badge>} />)}{(d.contracts ?? []).length === 0 ? <ListRow label="No contract issued — approving issues v1 at the market rate" /> : null}</View>
    <Eyebrow>Branches</Eyebrow>
    <View style={{ backgroundColor: color.raised, borderRadius: 10, borderWidth: 1, borderColor: color.borderSubtle }}>{(d.stores ?? []).map((s: any) => <ListRow key={s.store_id} icon="store" label={s.name ?? s.display_name} sub={s.paused_until ? `paused until ${s.paused_until}` : 'open'} />)}</View>
    <Eyebrow>Staff</Eyebrow>
    <View style={{ backgroundColor: color.raised, borderRadius: 10, borderWidth: 1, borderColor: color.borderSubtle }}>{(d.staff ?? []).map((s: any, i: number) => <ListRow key={i} icon="user" label={s.name ?? s.user_id} value={<Badge>{s.role}</Badge>} />)}</View>
    <Eyebrow>Decision</Eyebrow>
    <View style={{ width: 420 }}><Input label="Reason (audited)" value={reason} onChangeText={setReason} placeholder="e.g. licence verified against MOCI portal" /></View>
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Button onPress={() => act(approve, { p_partner: id, p_reason: reason || 'documents verified' }, 'Approved — contract v1 issued, partner must accept')} disabled={!['applied', 'under_review', 'documents_pending'].includes(p.onboarding_status)}>Approve & issue contract</Button>
      <Button variant="secondary" onPress={() => act(activate, { p_partner: id, p_reason: reason || 'onboarding complete' }, 'Activated')} disabled={p.onboarding_status === 'active'}>Activate</Button>
      <Button variant="danger" onPress={() => act(reject, { p_partner: id, p_reason_code: 'ineligible', p_text: reason || 'Does not meet listing requirements' }, 'Rejected')} disabled={p.onboarding_status === 'rejected'}>Reject</Button></View>
    <Caption>Activation happens automatically once documents are approved, the contract is accepted and a branch has opening hours. The button is for edge cases and needs the same conditions.</Caption>
    <Eyebrow>History</Eyebrow>
    <View style={{ backgroundColor: color.raised, borderRadius: 10, borderWidth: 1, borderColor: color.borderSubtle }}>{(d.history ?? []).slice(0, 12).map((h: any, i: number) => <ListRow key={i} label={`${h.from_status ?? '—'} → ${h.to_status}`} sub={h.reason_text ?? h.reason_code ?? ''} value={<Num role="caption" color={color.textSecondary}>{String(h.at ?? h.created_at ?? '').slice(0, 16)}</Num>} />)}</View>
  </>;
}
