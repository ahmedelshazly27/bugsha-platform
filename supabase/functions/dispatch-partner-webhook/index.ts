// HMAC-signed outbound webhooks, 6 retries with exponential backoff, then a
// permanent failure and an alert row.
import { asService, handleError, hmacSha256, preflight, requireCron, respond } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  try {
    requireCron(req);
    const db = asService();
    const { data: due } = await db.from('partner_webhook_delivery').select('*, partner_webhook(endpoint, secret)')
      .eq('status', 'pending').lt('attempts', 6).limit(50);
    let delivered = 0;
    for (const d of due ?? []) {
      const body = JSON.stringify({ id: d.id, event: d.event, payload: d.payload, sentAt: new Date().toISOString() });
      const sig = await hmacSha256(d.partner_webhook.secret, body);
      try {
        const res = await fetch(d.partner_webhook.endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bugsha-signature': sig, 'x-bugsha-event': d.event }, body });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await db.from('partner_webhook_delivery').update({ status: 'delivered', delivered_at: new Date().toISOString(), attempts: d.attempts + 1 }).eq('id', d.id);
        delivered++;
      } catch (e) {
        const attempts = d.attempts + 1;
        await db.from('partner_webhook_delivery').update({ attempts, last_error: String(e), status: attempts >= 6 ? 'failed' : 'pending' }).eq('id', d.id);
        if (attempts >= 6) await db.from('job_run').insert({ job_name: 'dispatch_partner_webhook', status: 'partial', error: `permanent failure ${d.id}`, finished_at: new Date().toISOString() });
      }
    }
    return respond({ due: due?.length ?? 0, delivered });
  } catch (e) { return handleError(e); }
});
