// Partner onboarding through ops, then a full sale: documents → verify → approve → contract → store/hours → publish → consumer cash reservation → partner redeem → ops sees it.
import { createClient } from '@supabase/supabase-js';
const URL = 'https://fxjvxmuporiwpqalbddv.supabase.co', KEY = 'sb_publishable_KmUlVYOLmpIVVNi6yAiK9w_2OKNDzNv', PW = 'Bugsha-QA-2026!';
const mk = () => createClient(URL, KEY, { auth: { persistSession: false } });
const step = async (name, fn) => { try { const v = await fn(); console.log('OK  ', name, typeof v === 'string' ? v : JSON.stringify(v)?.slice(0, 200)); return v; } catch (e) { console.log('FAIL', name, e.message ?? e); return null; } };
const rpc = async (db, fn, args = {}) => { const { data, error } = await db.schema('app').rpc(fn, args); if (error) throw new Error(`${fn}: ${error.code ?? ''} ${error.message}`); return data; };
const login = async (email) => { const db = mk(); const { error } = await db.auth.signInWithPassword({ email, password: PW }); if (error) throw error; return db; };
const p = await login('qa-partner@bugsha.test'), o = await login('qa-ops@bugsha.test'), c = await login('qa-consumer@bugsha.test');
const me = await rpc(p, 'my_stores_detail'); const partnerId = me[0]?.partner_id; const storeId = me[0]?.store_id; console.log('partner', partnerId, 'store', storeId);
const docs = await step('my_documents', () => rpc(p, 'my_documents', { p_partner: partnerId }).then((r) => r.map((d) => `${d.doc_type}:${d.status ?? 'missing'}`)));
const required = await rpc(p, 'my_documents', { p_partner: partnerId });
for (const d of required) if (d.status !== 'approved') await step(`upload ${d.doc_type}`, () => rpc(p, 'upload_document', { p_partner: partnerId, p_doc_type: d.doc_type, p_storage_path: `qa/${d.doc_type}.pdf`, p_store_id: d.per_store ? storeId : null, p_expires_on: '2027-12-31' }));
const detail = await step('ops_partner_detail', () => rpc(o, 'ops_partner_detail', { p_partner: partnerId }).then((d) => ({ status: d.partner?.onboarding_status, docs: (d.documents ?? []).map((x) => `${x.doc_type}:${x.status}`) })));
const pending = ((await rpc(o, 'ops_partner_detail', { p_partner: partnerId })).documents ?? []).filter((x) => x.status === 'pending');
for (const d of pending) await step(`ops_verify_document ${d.doc_type}`, () => rpc(o, 'ops_verify_document', { p_doc: d.id, p_approve: true }));
const st0 = (await rpc(p, 'my_partner', { p_partner: partnerId })).onboarding_status;
if (['applied', 'under_review', 'documents_pending'].includes(st0)) await step('ops_approve_partner', () => rpc(o, 'ops_approve_partner', { p_partner: partnerId, p_reason: 'QA verified' }).then((r) => r.onboarding_status)); else console.log('skip approve — status', st0);
const mp = await step('my_partner', () => rpc(p, 'my_partner', { p_partner: partnerId }));
if (mp?.contract && !mp.contract.accepted_at) await step('accept_contract', () => rpc(p, 'accept_contract', { p_contract: mp.contract.id, p_ip: '0.0.0.0', p_ua: 'e2e', p_document_hash: 'qa' }).then((r) => !!r.accepted_at));
await step('set_hours', () => rpc(p, 'set_hours', { p_store: storeId, p_rows: [0, 1, 2, 3, 4, 5, 6].map((w) => ({ weekday: w, opens: '08:00', closes: '23:59' })) }).then((r) => `${r.length} rows`));
await step('status now', () => rpc(p, 'my_partner', { p_partner: partnerId }).then((d) => d.onboarding_status));
const tpl = (await rpc(p, 'templates', { p_partner: partnerId }))[0];
const kw = new Date(Date.now() + 3 * 3600e3); const hh = (d) => String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
const listing = await step('publish_listing', () => rpc(p, 'publish_listing', { p_template_id: tpl.id, p_quantity: 5, p_local_date: kw.toISOString().slice(0, 10), p_local_start: hh(new Date(kw.getTime() - 2 * 60e3)), p_local_end: hh(new Date(kw.getTime() + 150 * 60e3)), p_idempotency: crypto.randomUUID() }).then((l) => l.listing_id));
const hold = listing && await step('consumer hold', () => rpc(c, 'hold_listing', { p_listing_id: listing, p_quantity: 1, p_idempotency: crypto.randomUUID() }).then((h) => ({ order_id: h.order_id, code: h.code })));
if (hold) {
  await step('consumer reserve_cash_order', () => rpc(c, 'reserve_cash_order', { p_order_id: hold.order_id, p_idempotency: crypto.randomUUID() }).then((r) => r.status));
  await step('consumer order_detail', () => rpc(c, 'order_detail', { p_order: hold.order_id }).then((d) => `${d.order.status} ${d.order.method} ${d.order.code}`));
  await step('partner orders_board', () => rpc(p, 'orders_board', { p_store: storeId }).then((r) => r.map((x) => `${x.code} ${x.status} ${x.method} due=${x.amount_due_minor}`)));
  await step('partner redeem_order', () => rpc(p, 'redeem_order', { p_order: hold.order_id, p_mechanism: 'code_shown', p_idempotency: crypto.randomUUID() }).then((r) => `already=${r.already_redeemed}`));
  await step('partner collect_cash', () => rpc(p, 'collect_cash', { p_order: hold.order_id, p_collected_minor: 2500, p_idempotency: crypto.randomUUID() }));
  await step('consumer sees redeemed', () => rpc(c, 'order_detail', { p_order: hold.order_id }).then((d) => d.order.status));
  await step('ops_orders has it', () => rpc(o, 'ops_orders', { p_code: hold.code }).then((r) => r.map((x) => `${x.code} ${x.status}`)));
  await step('ops_live_dashboard', () => rpc(o, 'ops_live_dashboard', { p_market: 'KW' }));
  await step('partner today', () => rpc(p, 'today', { p_store: storeId }).then((d) => `gross=${d.gross_today_minor} outstanding=${d.orders_outstanding}`));
}
