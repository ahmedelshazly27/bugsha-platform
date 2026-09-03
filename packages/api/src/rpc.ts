/**
 * Every mutation is an RPC in the `app` schema, takes an idempotency key the
 * client REUSES across retries, and raises a BGxxx code the UI resolves to
 * copy. Never a raw server string (07-api.md).
 */
import { AppError } from '@bugsha/core';
import type { Bugsha } from './client';

export class RpcError extends AppError {
  constructor(code: string, readonly serverMessage: string, context: Record<string, unknown> = {}) { super(code, context); }
}

function toRpcError(e: { code?: string; message?: string; details?: string; hint?: string }): RpcError {
  const m = (e.message ?? '').match(/\b(BG\d{3})\b/);
  const code = e.code?.startsWith('BG') ? e.code : m?.[1] ?? 'BG500';
  return new RpcError(code, e.message ?? '', { details: e.details, hint: e.hint });
}

export async function rpc<T = unknown>(db: Bugsha, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.schema('app').rpc(fn as never, args as never);
  if (error) throw toRpcError(error);
  return data as T;
}

/** uuidv4 from the platform CSPRNG. Generate once per user intent, reuse on retry. */
export function newIdempotencyKey(): string {
  return (globalThis.crypto as Crypto).randomUUID();
}

/** A four-eyes verdict is not an error: the client renders a 428 state. */
export function isPendingApproval(v: unknown): v is { status: 'pending_approval'; errcode: 'BG130' } {
  return typeof v === 'object' && v !== null && (v as { status?: string }).status === 'pending_approval';
}
