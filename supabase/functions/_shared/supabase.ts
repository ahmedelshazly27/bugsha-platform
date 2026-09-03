// Edge Functions own everything that leaves the building (01-architecture.md §1).
// They verify the caller, then call the SAME app.* functions the apps call.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const url = Deno.env.get('SUPABASE_URL')!;
const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/** Client acting AS THE CALLER — RLS and app.* authorisation apply. */
export function asUser(req: Request): SupabaseClient {
  const auth = req.headers.get('Authorization') ?? '';
  return createClient(url, anon, { global: { headers: { Authorization: auth } } });
}

/** service_role. Never handed to a client; only after the caller has been verified. */
export function asService(): SupabaseClient {
  return createClient(url, service, { auth: { persistSession: false } });
}

export async function requireUser(req: Request): Promise<{ id: string; client: SupabaseClient }> {
  const client = asUser(req);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new HttpError(401, 'BG100', 'not authenticated');
  return { id: data.user.id, client };
}

/** Scheduled invocations carry a shared secret, never a user JWT. */
export function requireCron(req: Request): void {
  const expected = Deno.env.get('CRON_SECRET');
  if (!expected || req.headers.get('x-cron-secret') !== expected) throw new HttpError(401, 'BG100', 'bad cron secret');
}

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly detail?: unknown) { super(message); }
}

/** BGxxx -> HTTP, from 07-api.md's table. The client resolves the code to copy. */
const HTTP_FOR: Record<string, number> = {
  BG001: 500, BG002: 500, BG003: 409, BG004: 409, BG100: 403, BG101: 409, BG102: 400, BG103: 409, BG104: 400,
  BG110: 409, BG111: 409, BG112: 409, BG113: 409, BG114: 409, BG115: 409, BG116: 409, BG117: 409, BG118: 409,
  BG119: 409, BG121: 409, BG130: 428, BG131: 428, BG132: 400, BG133: 409, BG140: 409, BG150: 500, BG160: 409, BG161: 400, BG170: 400, BG171: 409,
};

export function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors } });
}

export function handleError(e: unknown): Response {
  if (e instanceof HttpError) return respond({ error: { code: e.code, message: e.message, detail: e.detail } }, e.status);
  const pg = e as { code?: string; message?: string };
  if (pg?.code && HTTP_FOR[pg.code]) return respond({ error: { code: pg.code, message: pg.message } }, HTTP_FOR[pg.code]);
  console.error(e);
  return respond({ error: { code: 'BG500', message: 'unexpected' } }, 500);
}

export const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, idempotency-key, x-cron-secret, x-api-key',
  'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
};

export function preflight(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response(null, { headers: cors }) : null;
}

/** Every mutation takes an Idempotency-Key the client reuses across retries. */
export function idempotencyKey(req: Request): string {
  const k = req.headers.get('idempotency-key');
  if (!k || !/^[0-9a-f-]{36}$/i.test(k)) throw new HttpError(400, 'BG101', 'Idempotency-Key header (uuid) is required');
  return k;
}

export async function hmacSha256(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
