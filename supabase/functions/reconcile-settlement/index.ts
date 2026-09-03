// Cron. Fetches the provider settlement file and hands the rows to
// app.reconcile_payments, which validates the WHOLE input before writing.
// The provider fetch itself needs credentials (phase 6/7); a file may also be
// POSTed directly by finance for manual reconciliation.
import { asService, handleError, HttpError, preflight, requireCron, respond } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  try {
    requireCron(req);
    const { provider, market, settlementDate, rows } = await req.json();
    if (!Array.isArray(rows)) throw new HttpError(400, 'BG102', 'rows[] required (provider fetch needs credentials — phase 6/7)');
    const { data, error } = await asService().rpc('reconcile_payments', { p_provider: provider, p_market: market, p_settlement_date: settlementDate, p_rows: rows }).schema('app');
    if (error) throw error; return respond(data);
  } catch (e) { return handleError(e); }
});
