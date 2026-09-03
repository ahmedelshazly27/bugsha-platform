// psp-webhook-tap — phase 6/7. The contract is fixed by docs/06-payments.md and
// 07-openapi.yaml; the provider adapter needs sandbox credentials that
// 13-config.md §4 lists as still outstanding. Until they exist this function
// refuses loudly rather than pretending — never a silent success.
import { handleError, HttpError, preflight } from '../_shared/supabase.ts';
Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  try { throw new HttpError(501, 'BG140', 'psp-webhook-tap: payment provider credentials not configured (phase 6/7)'); }
  catch (e) { return handleError(e); }
});
