// Screenshot every screen of a phone app at 390×844 from its web export, in both languages, against
// recorded API fixtures (no network). Used to review layout, mirroring and copy without a device.
//   npx expo export -p web --output-dir /tmp/web-consumer          (inside apps/consumer; needs EXPO_PUBLIC_* set)
//   PLAYWRIGHT_DIR=<dir with playwright-core> node scripts/render-screens.mjs consumer /tmp/web-consumer scripts/fixtures/consumer.json out/consumer
// Native-only modules are stubbed for the web by scripts/metro.web-stubs.js. Output: <out>/<locale>/<nn>-<route>.png + report.json
import { createRequire } from 'node:module'; import { createServer } from 'node:http'; import { readFile, stat, mkdir, writeFile } from 'node:fs/promises'; import path from 'node:path';
const require = createRequire(path.join(process.env.PLAYWRIGHT_DIR ?? process.cwd(), '/')); const { chromium } = require('playwright-core');
const [app, dist, fixturePath, out] = process.argv.slice(2); if (!app || !dist || !fixturePath || !out) { console.error('usage: render-screens.mjs <consumer|partner|ops> <dist> <fixtures.json> <out>'); process.exit(1); }
const FX = JSON.parse(await readFile(fixturePath, 'utf8')); const ref = 'fxjvxmuporiwpqalbddv';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => { const p = decodeURIComponent(new URL(req.url, 'http://x').pathname); let f = path.join(dist, p); try { if ((await stat(f)).isDirectory()) f = path.join(f, 'index.html'); } catch { f = path.join(dist, 'index.html'); } try { res.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' }); res.end(await readFile(f)); } catch { res.writeHead(404); res.end(); } });
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`;
const b64 = (s) => Buffer.from(s).toString('base64url'); const iso = (ms) => new Date(Date.now() + ms).toISOString();
const uid = { consumer: 'ab000000-0000-4000-8000-000000000001', partner: 'ab000000-0000-4000-8000-000000000002', ops: 'ab000000-0000-4000-8000-000000000003' }[app]; const email = { consumer: 'qa-consumer@bugsha.test', partner: 'qa-partner@bugsha.test', ops: 'qa-ops@bugsha.test' }[app];
const user = { id: uid, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-09-10T00:00:00Z' };
const session = { access_token: `${b64('{"alg":"HS256","typ":"JWT"}')}.${b64(JSON.stringify({ sub: uid, email, role: 'authenticated', exp: 9999999999 }))}.sig`, refresh_token: 'r', token_type: 'bearer', expires_in: 999999, expires_at: 9999999999, user };
// ── derived fixture rows ────────────────────────────────────────────────────
const D = {};
if (app === 'consumer') {
  const red = FX.order_detail_redeemed; const held = FX.held; const listing = FX.listing_detail[0]; const store = FX.store_profile;
  const mk = (id, status, extra = {}) => ({ ...red, order: { ...held, order_id: id, status, hold_expires_at: status === 'held' ? iso(9 * 60_000) : null, window_start_utc: iso(60 * 60_000), window_end_utc: iso(120 * 60_000), title_snapshot: listing.title, ...extra }, store: { ...red.store, store_id: store.store_id, display_name: store.display_name, address: store.address, pickup_point_en: store.pickup_point_en, pickup_point_ar: store.pickup_point_ar }, payment: status === 'held' ? null : { status: 'captured', provider: 'myfatoorah', provider_ref: 'MF-88213', method: 'card' }, redemption: null, refund_timing_key: 'KW.card', cancellation_cutoff_at: iso(-60 * 60_000) });
  D.heldId = 'aaaa0000-0000-4000-8000-00000000he1d'; D.reservedId = 'aaaa0000-0000-4000-8000-0000000re5v'; D.lateId = 'aaaa0000-0000-4000-8000-00000000late';
  D.orderDetail = { [D.heldId]: mk(D.heldId, 'held'), [D.reservedId]: mk(D.reservedId, 'reserved'), [D.lateId]: { ...mk(D.lateId, 'reserved'), order: { ...mk(D.lateId, 'reserved').order, window_start_utc: iso(-50 * 60_000), window_end_utc: iso(10 * 60_000) } }, [red.order.order_id]: red, [FX.order_detail_cancelled.order.order_id]: FX.order_detail_cancelled };
  D.orders = [D.orderDetail[D.heldId].order, D.orderDetail[D.reservedId].order, ...FX.orders];
  D.saved = [{ store_id: store.store_id, display_name: store.display_name, notify: true, live_listing_id: listing.listing_id, next_window_start: iso(60 * 60_000), next_window_end: iso(120 * 60_000), price_minor: listing.price_minor, currency: 'KWD', quantity_remaining: 4, category: listing.category }, { store_id: red.store.store_id, display_name: red.store.display_name, notify: false, live_listing_id: null, next_window_start: null, next_window_end: null, price_minor: null, currency: null, quantity_remaining: null, category: null }];
  const shift = (r) => ({ ...r, window_start_utc: iso(45 * 60_000), window_end_utc: iso(105 * 60_000), reservation_cutoff_utc: iso(100 * 60_000) });
  D.browse = FX.browse.map((r, i) => (i < 3 ? { ...shift(r), window_start_utc: iso(-10 * 60_000), window_end_utc: iso(40 * 60_000) } : shift(r))); D.nearby = FX.nearby.map(shift); D.search = FX.search.map(shift);
  D.listing = [{ ...listing, window_start_utc: iso(45 * 60_000), window_end_utc: iso(105 * 60_000) }]; D.wallet = { market: 'KW', currency: 'KWD', balance_minor: 2500, expiring_soon_minor: 500 };
  D.storeProfile = { ...store, live_listings: (store.live_listings ?? []).map(shift) };
} else if (app === 'ops') {
  const p = FX.ops_partners[0]; const o = FX.ops_orders[0]; const run = FX.ops_payout_runs[0];
  D.health = [{ id: 'h1', partner_id: p.partner_id, kind: 'listing_declined', severity: 'warning', evidence: { listings: 2, reason: 'price above fraction' }, opened_at: iso(-3 * 36e5), resolved_at: null }, { id: 'h2', partner_id: p.partner_id, kind: 'document_expiring', severity: 'critical', evidence: { doc_type: 'food_permit', expires_on: '2026-09-20' }, opened_at: iso(-26 * 36e5), resolved_at: null }];
  D.moderation = [{ listing_id: 'm1', store_id: o.store_id, partner_id: o.partner_id, market: 'KW', title_snapshot: 'Miracle detox bag', description_snapshot: 'Cures everything — guaranteed weight loss', category: 'meals', price_minor: 2800, currency: 'KWD', value_min_minor: 3000, quantity_total: 6, local_date: new Date().toISOString().slice(0, 10), window_start_utc: iso(3 * 36e5), reservation_cutoff_utc: iso(2.5 * 36e5), moderation_status: 'flagged', allergen_snapshot: ['nuts'], created_at: iso(-30 * 60_000) }];
  D.notifications = [{ id: 'n1', template_key: 'consumer.pickup_reminder', recipient_user: 'ab000000-0000-4000-8000-000000000001', channels: ['push'], suppressed_reason: null, sent_at: iso(-40 * 60_000) }, { id: 'n2', template_key: 'consumer.order_confirmed', recipient_user: 'ab000000-0000-4000-8000-000000000001', channels: ['push', 'email'], suppressed_reason: null, sent_at: iso(-3 * 36e5) }, { id: 'n3', template_key: 'consumer.campaign', recipient_user: 'ab000000-0000-4000-8000-000000000001', channels: ['push'], suppressed_reason: 'quiet_hours', sent_at: iso(-9 * 36e5) }];
  D.runDetail = { run, payouts: [{ payout_id: 'py1', run_id: run.id, partner_id: p.partner_id, currency: 'KWD', gross_minor: 12500, netted_minor: 2750, carry_in_minor: 0, net_minor: 9750, carry_out_minor: 0, status: 'executing', hold_reason: null, provider_ref: null, paid_at: null }, { payout_id: 'py2', run_id: run.id, partner_id: FX.ops_partners[1]?.partner_id ?? p.partner_id, currency: 'KWD', gross_minor: 4000, netted_minor: 880, carry_in_minor: 0, net_minor: 3120, carry_out_minor: 0, status: 'held', hold_reason: 'first_payout', provider_ref: null, paid_at: null }], exceptions: [{ payout_id: 'py2', partner_id: FX.ops_partners[1]?.partner_id ?? p.partner_id, reason: 'first_payout' }] };
} else {
  const st = FX.my_stores_detail[0]; const l = { ...FX.listings[0], local_date: new Date().toISOString().slice(0, 10), window_start_utc: iso(60 * 60_000), window_end_utc: iso(150 * 60_000), local_start: '20:00:00', local_end: '23:30:00', quantity_remaining: 3 };
  D.listings = [l, { ...l, listing_id: 'l2-0000-0000-4000-8000-000000000002', quantity_remaining: 0 }, FX.listings[1]];
  D.today = { ...FX.today, next_window: { listing_id: l.listing_id, window_start_utc: l.window_start_utc, window_end_utc: l.window_end_utc, quantity_remaining: 3, quantity_total: 5, orders: 2 }, listings_today: [{ listing_id: l.listing_id, title: l.title_snapshot, window_start_utc: l.window_start_utc, window_end_utc: l.window_end_utc, quantity_remaining: 3, quantity_total: 5, price_minor: l.price_minor, orders: 2, status: 'active' }], gross_today_minor: 5000, orders_outstanding: 2, alerts: [{ doc_type: 'food_permit', expires_on: '2026-09-20' }] };
  D.board = FX.orders_board.map((o, i) => (i < 2 ? { ...o, window_start_utc: iso(-10 * 60_000), window_end_utc: iso(50 * 60_000) } : o));
  D.payouts = [{ payout_id: 'p0000000-0000-4000-8000-000000000001', run_id: 'r1', partner_id: st.partner_id, currency: 'KWD', gross_minor: 12500, netted_minor: 2750, carry_in_minor: 0, net_minor: 9750, carry_out_minor: 0, status: 'paid', hold_reason: null, provider_ref: 'KFH-20260907-113', paid_at: '2026-09-07T09:00:00Z', created_at: '2026-09-07T06:00:00Z', period_start: '2026-08-31', period_end: '2026-09-06' }, { payout_id: 'p0000000-0000-4000-8000-000000000002', run_id: 'r2', partner_id: st.partner_id, currency: 'KWD', gross_minor: 7500, netted_minor: 1650, carry_in_minor: 0, net_minor: 5850, carry_out_minor: 0, status: 'held', hold_reason: 'first_payout', provider_ref: null, paid_at: null, created_at: '2026-09-14T06:00:00Z', period_start: '2026-09-07', period_end: '2026-09-13' }];
  D.payoutDetail = { payout: D.payouts[0], orders: [{ code: 'PD4-CM', title_snapshot: 'QA Dinner Bag', amount_minor: 1950 }, { code: 'K2M-7A', title_snapshot: 'QA Dinner Bag', amount_minor: 3900 }, { code: 'B7Q-3N', title_snapshot: 'QA Dinner Bag', amount_minor: 3900 }], adjustments: [], statement_url: null };
}
const rpc = (name, body) => {
  if (app === 'ops') { switch (name) {
    case 'ops_partner_health': return D.health; case 'ops_moderation_queue': return D.moderation; case 'ops_notifications': return D.notifications; case 'ops_payout_run_detail': return D.runDetail;
    case 'ops_disputes': return body.p_open_only === false ? FX.ops_disputes : FX.ops_disputes.filter((d) => !d.resolved_at);
    default: return name in FX ? FX[name] : null; } }
  if (app === 'consumer') switch (name) {
    case 'my_profile': return FX.my_profile; case 'wallet_balance': return D.wallet; case 'my_impact': return FX.my_impact; case 'my_notification_prefs': return FX.my_notification_prefs; case 'my_saved_stores': return D.saved; case 'cities_for': return FX.cities_for;
    case 'listing_detail': return D.listing; case 'store_profile': return D.storeProfile; case 'search_listings': return D.search; case 'browse_nearby': return D.nearby; case 'order_detail': return D.orderDetail[body.p_order] ?? null; case 'hold_listing': return D.orderDetail[D.heldId].order;
    case 'toggle_saved_store': return true; case 'apply_promotion': return { discount_minor: 500 }; default: return null;
  }
  switch (name) {
    case 'my_stores_detail': return FX.my_stores_detail; case 'my_stores': return FX.my_stores_detail; case 'my_partners': return FX.my_partners; case 'my_partner': return FX.my_partner; case 'today': return D.today; case 'orders_board': return D.board; case 'listings': return D.listings; case 'templates': return FX.templates; case 'schedules': return FX.schedules;
    case 'payouts': return D.payouts; case 'payout_detail': return D.payoutDetail; case 'cash_liability': return FX.cash_liability; case 'analytics_summary': return FX.analytics_summary; case 'analytics_insights': return FX.analytics_insights; case 'reliability': return FX.reliability; case 'my_staff': return FX.my_staff; case 'my_documents': return FX.my_documents; case 'my_reviews': return FX.my_reviews; case 'my_quality_flags': return FX.my_quality_flags; case 'my_disputes': return FX.my_disputes; case 'compliance_ledger': return FX.compliance_ledger; case 'end_of_day': return FX.end_of_day;
    case 'lookup_order': return D.board.filter((o) => o.status === 'reserved' && o.code.replace('-', '').startsWith(String(body.p_fragment ?? '').replace('-', '').toUpperCase())); case 'check_partner_code': return body.p_code === 'BG-4XB7-582G' ? FX.check_partner_code : { status: 'invalid' }; case 'cities_for': return [{ id: '11111111-0000-4000-8000-000000000002', name_en: 'Hawalli', name_ar: 'حولي', governorate: 'Hawalli', stage: 'live' }]; default: return null;
  }
};
const PLAN = app === 'ops' ? {
  viewport: { width: 1280, height: 860 }, scale: 1,
  seed: (locale, auth) => (auth ? { [`sb-${ref}-auth-token`]: JSON.stringify(session) } : {}),
  anon: ['/signin'],
  authed: ['/dashboard', '/requests', { path: '/requests', click: FX.ops_partner_requests[0]?.trading_name }, '/partners', `/partner/${FX.ops_partners[0].partner_id}`, '/orders', { path: '/orders', click: FX.ops_orders[0].code }, '/moderation', { path: '/moderation', click: 'Miracle detox bag' }, '/disputes', { path: '/disputes', click: FX.ops_disputes[0].case_ref }, '/users', { path: '/users', click: FX.ops_users[0].first_name },
    '/money', { path: '/money', click: `${FX.ops_payout_runs[0].period_start} → ${FX.ops_payout_runs[0].period_end}` }, '/config', { path: '/config', click: 'Default commission (bp)' }, '/notifications', { path: '/notifications', click: 'consumer.campaign' }, '/jobs', '/audit'],
} : app === 'consumer' ? {
  seed: (locale, auth) => ({ 'bugsha.session': JSON.stringify({ state: { market: 'KW', cityId: '11111111-0000-4000-8000-000000000002', cityName: 'Hawalli', locale, localeChosen: true, introSeen: true }, version: 0 }), ...(auth ? { [`sb-${ref}-auth-token`]: JSON.stringify(session) } : {}) }),
  anon: ['/onboarding/language', '/onboarding/intro', '/', '/auth/email', '/auth/code?email=qa-consumer%40bugsha.test', '/waitlist'],
  authed: ['/onboarding/market', '/onboarding/city', '/onboarding/location', '/onboarding/notify', '/onboarding/profile', '/', '/orders', '/saved', '/account', `/listing/${FX.listing_detail[0].listing_id}`, `/store/${FX.store_profile.store_id}`, '/category/bakery', '/search', '/map', `/pay?order=${D.heldId}`, `/order/${D.heldId}`, `/order/${D.reservedId}`, `/order/${D.lateId}`, `/order/${FX.order_detail_redeemed.order.order_id}`, `/order/receipt?id=${FX.order_detail_redeemed.order.order_id}`, `/order/${FX.order_detail_cancelled.order.order_id}`,
    '/account/profile', '/account/dietary', '/account/notifications', '/account/wallet', '/account/impact', '/account/invite', '/account/help', '/account/legal', '/account/safety', '/account/delete', '/account/restricted'],
} : {
  seed: (locale, auth) => ({ 'bugsha.partner.session': JSON.stringify({ state: { locale }, version: 0 }), ...(auth ? { [`sb-${ref}-auth-token`]: JSON.stringify(session) } : {}) }),
  anon: ['/signin', '/join', '/join/code', '/join/code?code=BG-4XB7-582G', '/join/request', '/signup'],
  authed: ['/', '/listings', '/orders', '/more', '/redeem', '/redeem?code=H4N-2K', '/listing/publish', `/listing/${FX.listings[0].listing_id}`, '/templates', `/templates/edit?id=${FX.templates[0].id}`, '/templates/edit', '/money/cash', '/money/p0000000-0000-4000-8000-000000000001',
    '/org/analytics', '/org/branch', '/org/ledger', '/org/quality', '/org/reviews', '/org/schedules', '/org/staff', '/onboarding', '/onboarding/store', '/onboarding/documents', '/onboarding/hours', '/onboarding/contract', '/support'],
};
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] }); const report = {}; const unmocked = new Set();
const safe = (r) => r.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root';
for (const locale of (process.env.LOCALES ?? (app === 'ops' ? 'en' : 'en,ar-KW')).split(',')) {
  const dir = path.join(out, locale); await mkdir(dir, { recursive: true }); let n = 0;
  for (const [auth, routes] of [[false, PLAN.anon], [true, PLAN.authed]]) {
    const ctx = await browser.newContext({ viewport: PLAN.viewport ?? { width: 390, height: 844 }, deviceScaleFactor: PLAN.scale ?? 2, isMobile: !PLAN.viewport, hasTouch: !PLAN.viewport, locale: locale.startsWith('ar') ? 'ar' : 'en', geolocation: { latitude: 29.3375, longitude: 48.0286 }, permissions: ['geolocation'] });
    await ctx.addInitScript((kv) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); }, PLAN.seed(locale, auth));
    await ctx.route(/supabase\.co/, async (route) => {
      const u = new URL(route.request().url()); const ok = (v, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(v) });
      if (u.pathname.startsWith('/auth/v1/user')) return ok(auth ? user : { code: 401, msg: 'no session' }, auth ? 200 : 401);
      if (u.pathname.startsWith('/auth/v1/token')) return ok(session); if (u.pathname.startsWith('/auth/v1/')) return ok({});
      if (u.pathname.startsWith('/rest/v1/rpc/')) { const name = u.pathname.split('/rpc/')[1]; let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch {} const v = rpc(name, body); if (v === null && !/^(set_|register_|complete_|update_|acknowledge_|respond_|cancel_|request_|submit_|toggle_|release_|redeem_|collect_|mark_|pause_|resume_|upsert_|publish_|archive_|invite_|revoke_|accept_|upload_|undo_)/.test(name)) unmocked.add(name); return ok(v); }
      if (u.pathname.startsWith('/rest/v1/v_browse_listing')) return ok(D.browse ?? []); if (u.pathname.startsWith('/rest/v1/order')) return ok(D.orders ?? []);
      if (u.pathname.startsWith('/rest/v1/')) { unmocked.add('table ' + u.pathname.split('/rest/v1/')[1]); return ok([]); }
      if (u.pathname.startsWith('/storage/')) return ok({ data: [] }); return route.abort();
    });
    for (const step of routes) { const route = typeof step === 'string' ? step : step.path; const click = typeof step === 'string' ? null : step.click;
      const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 300))); page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon|WebSocket/.test(m.text())) errs.push(m.text().slice(0, 300)); });
      try { await page.goto(base + route, { waitUntil: 'networkidle', timeout: 30000 }); } catch (e) { errs.push('goto: ' + e.message.slice(0, 120)); }
      if (click) { try { await page.getByText(click, { exact: false }).first().click({ timeout: 4000 }); await page.waitForTimeout(700); } catch (e) { errs.push('click: ' + String(click)); } }
      await page.waitForTimeout(900); const name = `${String(++n).padStart(2, '0')}-${auth ? 'in-' : ''}${safe(route)}${click ? '-open' : ''}.png`; await page.screenshot({ path: path.join(dir, name) });
      const finalUrl = page.url().replace(base, ''); report[`${locale} ${route}`] = { file: name, landed: finalUrl !== route ? finalUrl : undefined, errors: errs.length ? errs : undefined }; console.log(locale, route, finalUrl !== route ? `→ ${finalUrl}` : '', errs.length ? `⚠ ${errs[0].slice(0, 100)}` : 'ok'); await page.close();
    }
    await ctx.close();
  }
}
report._unmocked = [...unmocked]; await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 1)); await browser.close(); server.close(); console.log('unmocked:', [...unmocked].join(', ') || 'none');
