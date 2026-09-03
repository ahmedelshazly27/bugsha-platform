/** Mirror the current + next window; drain the queue on reconnect (14-mobile.md §3). */
import * as Crypto from 'expo-crypto';
import { syncQueue, type QueuedMutation, type SyncOutcome } from '@bugsha/offline';
import { rpc, type Bugsha } from '@bugsha/api';
import type { SqliteOfflineStore } from './store';

export const hashCode = async (code: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, code.toUpperCase());

export async function refreshMirror(db: Bugsha, store: SqliteOfflineStore, storeId: string) {
  const rows = (await rpc(db, 'orders_board', { p_store: storeId })) as any[];
  for (const r of rows) store.putCachedOrder({ orderId: r.order_id, code: r.code, codeHash: await hashCode(r.code), customerFirstName: r.customer_first_name, quantity: r.quantity,
    windowStartUtc: r.window_start_utc, windowEndUtc: r.window_end_utc, method: r.method, amountDueMinor: r.amount_due_minor, currency: r.currency, status: r.status, storeId, syncedAt: new Date().toISOString(), redeemedBy: r.redeemed_by ?? undefined });
}

export function drain(db: Bugsha, store: SqliteOfflineStore) {
  return syncQueue(store, async (m: QueuedMutation): Promise<SyncOutcome> => {
    const p = m.payload as { orderId: string; mechanism: 'code_shown' | 'qr_scanned'; staffUserId: string };
    const res = (await rpc(db, 'redeem_order', { p_order: p.orderId, p_mechanism: p.mechanism, p_idempotency: m.clientId, p_client_ts: m.clientTs, p_staff_user: p.staffUserId })) as any;
    if (res.honoured_after_cancel) return { kind: 'conflict', resolution: 'honoured', note: 'cancelled online after hand-over; honoured' };
    return { kind: res.already_redeemed ? 'already_applied' : 'applied', serverTs: res.redemption?.server_ts ?? new Date().toISOString() };
  });
}
