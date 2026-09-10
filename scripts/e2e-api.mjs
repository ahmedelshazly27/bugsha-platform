import { createClient } from '@supabase/supabase-js';
const URL = 'https://fxjvxmuporiwpqalbddv.supabase.co', KEY = 'sb_publishable_KmUlVYOLmpIVVNi6yAiK9w_2OKNDzNv', PW = 'Bugsha-QA-2026!';
const mk = () => createClient(URL, KEY, { auth: { persistSession: false } });
const step = async (name, fn) => { try { const v = await fn(); console.log('OK  ', name, typeof v === 'string' ? v : JSON.stringify(v).slice(0, 220)); return v; } catch (e) { console.log('FAIL', name, e.message ?? e); return null; } };
const rpc = async (db, fn, args = {}) => { const { data, error } = await db.schema('app').rpc(fn, args); if (error) throw new Error(`${fn}: ${error.code ?? ''} ${error.message}`); return data; };
const anon = mk();
const cities = await step('anon cities_for(KW)', () => rpc(anon, 'cities_for', { p_market: 'KW' }).then((r) => `${r.length} cities`));
const hawalli = '11111111-0000-4000-8000-000000000002';
// consumer
const c = mk(); await step('consumer sign-in', async () => { const { data, error } = await c.auth.signInWithPassword({ email: 'qa-consumer@bugsha.test', password: PW }); if (error) throw error; return data.user.email; });
await step('complete_profile', () => rpc(c, 'complete_profile', { p_first_name: 'QA', p_market: 'KW', p_city_id: hawalli, p_phone: '+96560000099' }).then((r) => r.first_name));
const browse = await step('browse view (KW/Hawalli)', async () => { const { data, error } = await c.from('v_browse_listing').select('listing_id,display_name,title_snapshot,quantity_remaining,window_end_utc').eq('market', 'KW').eq('city_id', hawalli); if (error) throw error; return data; });
await step('browse_nearby (Salmiya)', () => rpc(c, 'browse_nearby', { p_lat: 29.334, p_lng: 48.078, p_radius_m: 8000 }).then((r) => `${r.length} nearby, first ${r[0]?.store_name} ${r[0]?.distance_m}m`));
const first = browse?.[0];
const hold = first && await step('hold_listing', () => rpc(c, 'hold_listing', { p_listing_id: first.listing_id, p_quantity: 1, p_idempotency: crypto.randomUUID() }));
if (hold) { await step('order_detail', () => rpc(c, 'order_detail', { p_order: hold.order_id }).then((d) => `${d.order.status} ${d.order.code} ${d.store.display_name}`)); await step('release_hold', () => rpc(c, 'release_hold', { p_order_id: hold.order_id })); }
await step('my_profile', () => rpc(c, 'my_profile').then((p) => `${p.first_name} ${p.city_name_en}`));
await step('my_saved_stores', () => rpc(c, 'my_saved_stores').then((r) => `${r.length} saved`));
// partner
const p = mk(); await step('partner sign-in', async () => { const { data, error } = await p.auth.signInWithPassword({ email: 'qa-partner@bugsha.test', password: PW }); if (error) throw error; return data.user.email; });
let stores = await step('my_stores_detail (before)', () => rpc(p, 'my_stores_detail'));
let partnerId = stores?.[0]?.partner_id;
if (!partnerId) { const app = await step('submit_application', () => rpc(p, 'submit_application', { p_market: 'KW', p_legal_name: 'QA Kitchen Co WLL', p_trading_name: 'QA Kitchen', p_categories: ['meals'], p_contact_name: 'QA Owner', p_contact_phone: '+96560000098', p_contact_email: 'qa-partner@bugsha.test', p_city_id: hawalli, p_branch_count: 1 })); partnerId = app?.partner_id; }
console.log('partnerId', partnerId);
await step('my_partner', () => rpc(p, 'my_partner', { p_partner: partnerId }).then((d) => `${d.trading_name} ${d.onboarding_status} contract=${!!d.contract}`));
// ops approves
const o = mk(); await step('ops sign-in', async () => { const { data, error } = await o.auth.signInWithPassword({ email: 'qa-ops@bugsha.test', password: PW }); if (error) throw error; return data.user.email; });
await step('ops_partners', () => rpc(o, 'ops_partners').then((r) => `${r.length} partners`));
await step('ops_approve_partner', () => rpc(o, 'ops_approve_partner', { p_partner: partnerId, p_reason: 'QA' }));
await step('my_partner after approve', () => rpc(p, 'my_partner', { p_partner: partnerId }).then((d) => `${d.onboarding_status} contract=${JSON.stringify(d.contract)}`));
const store = await step('upsert_store', () => rpc(p, 'upsert_store', { p_partner: partnerId, p_display_name: 'QA Kitchen — Salmiya', p_city_id: hawalli, p_address: { governorate: 'Hawalli', area: 'Salmiya', block: '10', street: 'Salem Al Mubarak', building: '5' }, p_lat: 29.335, p_lng: 48.076, p_pickup_point_en: 'Side door, tell the cashier your code', p_pickup_point_ar: 'الباب الجانبي، أخبر الكاشير برمزك', p_contact_phone: '+96522000098' }));
const tpl = store && await step('upsert_bag_template', () => rpc(p, 'upsert_bag_template', { p_store_id: store.store_id, p_title_en: 'QA Dinner Bag', p_title_ar: 'بقشة عشاء تجريبية', p_category: 'meals', p_value_min_minor: 6000, p_value_max_minor: 9000, p_price_minor: 2500, p_default_quantity: 5, p_window_start: '20:00', p_window_end: '23:30', p_description_en: 'Two hot mains and bread', p_description_ar: 'وجبتان ساخنتان وخبز', p_dietary_flags: ['halal'] }));
const now = new Date(); const kw = new Date(now.getTime() + 3 * 3600e3); const hh = (d) => String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
const start = hh(new Date(kw.getTime() + 5 * 60e3)), end = hh(new Date(kw.getTime() + 180 * 60e3)); const today = kw.toISOString().slice(0, 10);
const listing = tpl && await step(`publish_listing ${today} ${start}-${end}`, () => rpc(p, 'publish_listing', { p_template_id: tpl.id, p_quantity: 5, p_local_date: today, p_local_start: start, p_local_end: end, p_idempotency: crypto.randomUUID() }));
await step('partner today', () => rpc(p, 'today', { p_store: store?.store_id }).then((d) => `${d.listings_today?.length} listings today`));
await step('consumer sees QA listing', async () => { const { data } = await c.from('v_browse_listing').select('display_name,title_snapshot').eq('city_id', hawalli); return data.filter((r) => r.display_name.startsWith('QA')).map((r) => r.display_name + ' / ' + r.title_snapshot); });
await step('ops_live_dashboard KW', () => rpc(o, 'ops_live_dashboard', { p_market: 'KW' }));
if (listing) { const h2 = await step('consumer holds QA listing', () => rpc(c, 'hold_listing', { p_listing_id: listing.listing_id, p_quantity: 1, p_idempotency: crypto.randomUUID() })); if (h2) { await step('consumer reserve cash', () => rpc(c, 'reserve_cash_order', { p_order_id: h2.order_id, p_idempotency: crypto.randomUUID() })); await step('partner orders_board shows it', () => rpc(p, 'orders_board', { p_store: store.store_id }).then((r) => r.map((x) => `${x.code} ${x.status} ${x.method}`))); await step('ops_orders sees it', () => rpc(o, 'ops_orders', { p_code: null }).then((r) => `${r.length} orders, has QA: ${r.some((x) => x.order_id === h2.order_id)}`)); } }
