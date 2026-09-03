/**
 * offline/redeem.ts — redemption with no network.
 *
 * "A staff member holding a bag needs a yes or a no, now. A 'pending' state
 * produces a second hand-over." (docs/14-mobile.md §3)
 */
import type { CachedOrder, OfflineStore, QueuedMutation, SyncOutcome } from './types';

export interface RedeemOfflineInput {
  code: string;
  staffUserId: string;
  now: Date;
  hash: (code: string) => string;
  mechanism?: 'code_shown' | 'qr_scanned';
  graceMinutes?: number;
}

export type RedeemOfflineResult =
  | {
      ok: true;
      confirmed: true;
      clientId: string;
      order: CachedOrder;
      alreadyRedeemed: boolean;
      redeemedBy?: string;
      lateGrace: boolean;
    }
  | { ok: false; code: 'BG110' | 'BG111' | 'BG112'; message: string };

/** RFC 4122 v4, from the platform CSPRNG when there is one. */
export function uuidv4(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  const b = new Uint8Array(16);
  g.crypto?.getRandomValues?.(b);
  b[6] = ((b[6] as number) & 0x0f) | 0x40;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function redeemOffline(store: OfflineStore, input: RedeemOfflineInput): RedeemOfflineResult {
  const { code, staffUserId, now, hash, mechanism = 'code_shown', graceMinutes = 30 } = input;

  const cached = store.getCachedOrder(code);
  // Compare by hash, so a mistyped code fails the same way a wrong one does.
  if (!cached || cached.codeHash !== hash(code)) {
    return { ok: false, code: 'BG110', message: 'redeem.unknown_code' };
  }

  const t = now.getTime();
  const start = Date.parse(cached.windowStartUtc);
  const end = Date.parse(cached.windowEndUtc);

  // §13-5: an already-redeemed order returns SUCCESS with the original record.
  // Never an error a staff member could read as "try again".
  if (cached.status === 'redeemed') {
    return {
      ok: true, confirmed: true, clientId: '', order: cached,
      alreadyRedeemed: true, redeemedBy: cached.redeemedBy, lateGrace: false,
    };
  }

  if (t < start) return { ok: false, code: 'BG111', message: 'redeem.window_not_open' };
  if (t >= end + graceMinutes * 60_000) {
    return { ok: false, code: 'BG112', message: 'redeem.window_closed' };
  }
  const lateGrace = t >= end;

  const clientId = uuidv4();
  const redeemed: CachedOrder = {
    ...cached,
    status: 'redeemed',
    redeemedBy: staffUserId,
    redeemedAt: now.toISOString(),
  };
  store.putCachedOrder(redeemed);
  store.enqueue({
    clientId,
    operation: 'redeem_order',
    payload: { orderId: cached.orderId, mechanism, staffUserId, lateGrace },
    clientTs: now.toISOString(),
    attempts: 0,
    createdAt: now.toISOString(),
  });

  return { ok: true, confirmed: true, clientId, order: redeemed, alreadyRedeemed: false, lateGrace };
}

export interface ConflictReport {
  clientId: string;
  resolution: 'honoured' | 'reversed';
  note: string;
  /** Always false. Ops sees the exception; staff are never blamed (§13-6). */
  blamesStaff: false;
}

export interface SyncReport {
  applied: number;
  failed: number;
  conflicts: ConflictReport[];
}

export type SyncTransport = (mutation: QueuedMutation) => Promise<SyncOutcome>;

/**
 * Drain the queue oldest-first, reusing each row's client_id as the
 * Idempotency-Key. A row that fails stays queued with its attempt count so a
 * later reconnect retries it with the SAME key — that is what makes the
 * server able to recognise the retry.
 */
export async function syncQueue(store: OfflineStore, transport: SyncTransport): Promise<SyncReport> {
  const report: SyncReport = { applied: 0, failed: 0, conflicts: [] };
  const rows = [...store.listQueue()].sort((a, b) => a.clientTs.localeCompare(b.clientTs));

  for (const row of rows) {
    try {
      const outcome = await transport(row);
      if (outcome.kind === 'conflict') {
        report.conflicts.push({
          clientId: row.clientId,
          resolution: outcome.resolution,
          note: outcome.note,
          blamesStaff: false,
        });
      } else {
        report.applied += 1;
      }
      store.removeFromQueue(row.clientId);
    } catch (e) {
      report.failed += 1;
      store.updateQueueRow(row.clientId, {
        attempts: row.attempts + 1,
        lastError: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return report;
}
