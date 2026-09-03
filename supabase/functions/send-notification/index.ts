// Cron-triggered. Claims due outbox rows, renders the template for the locale,
// dispatches per channel, records the result. Push via Expo; SMS/WhatsApp are
// TODO(decision) per market (13-config.md) and fall back to push-only.
import { asService, handleError, preflight, requireCron, respond } from '../_shared/supabase.ts';

interface Outbox { id: string; template_key: string; locale: string; recipient_user: string; params: Record<string, string>; channels: string[] }

function render(text: string, params: Record<string, string>): string {
  // Every interpolated value is bidi-isolated (11-i18n.md §4).
  return text.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? `⁨${params[k]}⁩` : m));
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  try {
    requireCron(req);
    const db = asService();
    const { data: rows, error } = await db.rpc('claim_notifications', { p_limit: 100 }).schema('app');
    if (error) throw error;
    let sent = 0;
    for (const row of (rows ?? []) as Outbox[]) {
      try {
        const { data: tpl } = await db.from('notification_template').select('title, body, deep_link')
          .eq('key', row.template_key).eq('locale', row.locale).eq('published', true).maybeSingle();
        if (!tpl) throw new Error('no published template');
        const { data: tokens } = await db.from('device_token').select('token').eq('user_id', row.recipient_user);
        const results: Record<string, unknown> = {};
        if (row.channels.includes('push') && tokens?.length) {
          const res = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify(tokens.map((t) => ({
              to: t.token, title: render(tpl.title, row.params), body: render(tpl.body, row.params),
              data: { deepLink: tpl.deep_link, orderId: row.params.order_id ?? null },
            }))),
          });
          results.push = await res.json();
        } else {
          results.push = tokens?.length ? 'skipped' : 'no device token';
        }
        // SMS / WhatsApp: provider is TODO(decision) per market. Recorded, not sent.
        for (const ch of row.channels.filter((c) => c !== 'push')) results[ch] = 'provider undecided (13-config.md)';
        await db.rpc('record_notification', { p_outbox: row.id, p_results: results }).schema('app');
        sent++;
      } catch (e) {
        await db.rpc('record_notification', { p_outbox: row.id, p_results: null, p_error: String(e) }).schema('app');
      }
    }
    return respond({ claimed: rows?.length ?? 0, sent });
  } catch (e) { return handleError(e); }
});
