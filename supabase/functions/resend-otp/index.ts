import { asService, handleError, HttpError, preflight, respond } from '../_shared/supabase.ts';
Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  try {
    const { phone } = await req.json();
    if (!/^\+(965\d{8}|20\d{10})$/.test(phone)) throw new HttpError(400, 'BG102', 'phone.invalid');
    // SMS provider is TODO(decision) per market (13-config.md). Supabase Auth
    // sends via whichever provider is configured in the project.
    const { error } = await asService().auth.signInWithOtp({ phone });
    if (error) throw new HttpError(502, 'BG140', error.message);
    return respond({ ok: true });
  } catch (e) { return handleError(e); }
});
