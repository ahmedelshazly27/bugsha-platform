import { asService, handleError, HttpError, preflight, respond } from '../_shared/supabase.ts';
Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  try {
    const { email } = await req.json();
    if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'BG102', 'email.invalid');
    // SMS provider is TODO(decision) per market (13-config.md). Supabase Auth
    // sends via whichever provider is configured in the project.
    const { error } = await asService().auth.signInWithOtp({ email: email.trim().toLowerCase() });
    if (error) throw new HttpError(502, 'BG140', error.message);
    return respond({ ok: true });
  } catch (e) { return handleError(e); }
});
