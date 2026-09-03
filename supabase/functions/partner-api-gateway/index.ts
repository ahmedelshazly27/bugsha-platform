// /v1/partner/* — key auth (prefix + hash), scoped to store_ids, rate-limited,
// then the SAME app.* functions the app calls. A thin adapter, deliberately.
import { asService, handleError, HttpError, idempotencyKey, preflight, respond, sha256 } from '../_shared/supabase.ts';

const buckets = new Map<string, { n: number; at: number }>();
function rateLimit(keyId: string, perMin: number) {
  const now = Date.now(); const b = buckets.get(keyId) ?? { n: 0, at: now };
  if (now - b.at > 60_000) { b.n = 0; b.at = now; }
  if (++b.n > perMin) throw new HttpError(429, 'BG180', 'rate limit');
  buckets.set(keyId, b);
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  try {
    const raw = req.headers.get('x-api-key') ?? '';
    const [prefix] = raw.split('.');
    const db = asService();
    const { data: key } = await db.from('partner_api_key').select('*').eq('key_prefix', prefix).is('revoked_at', null).maybeSingle();
    if (!key || key.key_hash !== await sha256(raw)) throw new HttpError(401, 'BG100', 'bad api key');
    rateLimit(key.id, key.rate_limit_per_min);
    await db.from('partner_api_key').update({ last_used_at: new Date().toISOString() }).eq('id', key.id);

    const url = new URL(req.url); const path = url.pathname.replace(/^.*\/v1\/partner/, '');
    const need = (scope: string) => { if (!key.scopes.includes(scope)) throw new HttpError(403, 'BG100', `scope ${scope} required`); };
    const inScope = (storeId: string) => { if (key.store_ids && !key.store_ids.includes(storeId)) throw new HttpError(403, 'BG100', 'store not in key scope'); };

    if (req.method === 'POST' && path === '/listings') {
      need('listings:write'); const b = await req.json(); inScope(b.storeId);
      const { data, error } = await db.rpc('publish_listing', { p_template_id: b.templateId, p_quantity: b.quantity, p_local_date: b.localDate, p_local_start: b.localStart, p_local_end: b.localEnd, p_idempotency: idempotencyKey(req) }).schema('app');
      if (error) throw error; return respond(data, 201);
    }
    if (req.method === 'PATCH' && path.startsWith('/listings/')) {
      need('listings:write'); const b = await req.json();
      const { data, error } = await db.rpc('update_listing', { p_listing_id: path.split('/')[2], p_quantity: b.quantity ?? null, p_price_minor: b.priceMinor ?? null, p_local_end: b.localEnd ?? null }).schema('app');
      if (error) throw error; return respond(data);
    }
    if (req.method === 'GET' && path === '/orders') {
      need('orders:read'); const storeId = url.searchParams.get('storeId')!; inScope(storeId);
      const { data, error } = await db.rpc('orders_board', { p_store: storeId }).schema('app');
      if (error) throw error; return respond(data);
    }
    if (req.method === 'POST' && /^\/orders\/[^/]+\/redeem$/.test(path)) {
      need('redeem:write');
      const { data, error } = await db.rpc('redeem_order', { p_order: path.split('/')[2], p_mechanism: 'code_shown', p_idempotency: idempotencyKey(req) }).schema('app');
      if (error) throw error; return respond(data);
    }
    if (req.method === 'GET' && path === '/analytics/summary') {
      need('analytics:read');
      const { data, error } = await db.rpc('analytics_summary', { p_partner: key.partner_id, p_from: url.searchParams.get('from'), p_to: url.searchParams.get('to') }).schema('app');
      if (error) throw error; return respond(data);
    }
    throw new HttpError(404, 'BG102', 'unknown route');
  } catch (e) { return handleError(e); }
});
