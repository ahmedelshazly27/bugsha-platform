// Statement PDF+CSV, compliance ledger export, receipts. Called by the client
// (user JWT) or cron. Output lands in the `documents` bucket, path returned.
import { asService, handleError, HttpError, preflight, requireUser, respond } from '../_shared/supabase.ts';
import { PDFDocument, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1';

function csv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

async function pdf(title: string, lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let page = doc.addPage([595, 842]); let y = 800;
  page.drawText(title, { x: 40, y, size: 16, font }); y -= 30;
  for (const l of lines) {
    if (y < 40) { page = doc.addPage([595, 842]); y = 800; }
    page.drawText(l.slice(0, 110), { x: 40, y, size: 9, font }); y -= 14;
  }
  return doc.save();
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  try {
    const { client } = await requireUser(req);
    const { kind, id, storeId, from, to } = await req.json();
    const db = asService();
    let rows: Record<string, unknown>[] = []; let base = '';
    if (kind === 'statement') {
      const { data, error } = await client.rpc('payout_detail', { p_payout: id }).schema('app');
      if (error) throw error; if (!data) throw new HttpError(404, 'BG102', 'no such payout');
      rows = (data.lines ?? []).map((l: Record<string, unknown>) => ({ account: l.account, amount_minor: l.amount_minor, orders: (l.orders as string[]).join(' ') }));
      base = `statements/${id}`;
    } else if (kind === 'compliance') {
      const { data, error } = await client.rpc('compliance_ledger', { p_store: storeId, p_from: from, p_to: to }).schema('app');
      if (error) throw error; rows = data ?? []; base = `compliance/${storeId}/${from}_${to}`;
    } else if (kind === 'receipt') {
      const { data, error } = await client.rpc('order_detail', { p_order: id }).schema('app');
      if (error) throw error; if (!data) throw new HttpError(404, 'BG102', 'no such order');
      rows = [{ code: data.order.code, total_minor: data.order.total_minor, currency: data.order.currency, status: data.order.status }];
      base = `receipts/${id}`;
    } else throw new HttpError(400, 'BG102', 'kind must be statement | compliance | receipt');

    const csvBody = csv(rows);
    const pdfBody = await pdf(`Bugsha — ${kind}`, csvBody.split('\n'));
    await db.storage.from('documents').upload(`${base}.csv`, new Blob([csvBody], { type: 'text/csv' }), { upsert: true });
    await db.storage.from('documents').upload(`${base}.pdf`, new Blob([pdfBody], { type: 'application/pdf' }), { upsert: true });
    if (kind === 'statement') await db.from('statement').update({ pdf_path: `${base}.pdf`, csv_path: `${base}.csv` }).eq('payout_id', id);
    return respond({ csv: `${base}.csv`, pdf: `${base}.pdf`, rows: rows.length });
  } catch (e) { return handleError(e); }
});
