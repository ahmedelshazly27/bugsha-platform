// Ops, after four eyes. Posts the payout entries and writes the bank file.
// The disbursement channel itself (bank API / file upload) is per-market
// configuration that does not exist yet — the file is produced and stored.
import { asService, handleError, preflight, requireUser, respond } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  try {
    const { client } = await requireUser(req);
    const { runId } = await req.json();
    const { data, error } = await client.rpc('ops_execute_payout_run', { p_run: runId }).schema('app');
    if (error) throw error;
    const rows = (data.bank_file as Record<string, unknown>[]);
    const body = ['payout_id,partner_id,amount_minor,currency', ...rows.map((r) => `${r.payout_id},${r.partner_id},${r.amount_minor},${r.currency}`)].join('\n');
    const path = `payouts/${runId}.csv`;
    await asService().storage.from('documents').upload(path, new Blob([body], { type: 'text/csv' }), { upsert: true });
    return respond({ runId, rows: rows.length, bankFile: path });
  } catch (e) { return handleError(e); }
});
