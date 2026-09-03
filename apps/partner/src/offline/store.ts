/** expo-sqlite implementation of @bugsha/offline's OfflineStore (14-mobile.md §3). */
import * as SQLite from 'expo-sqlite';
import type { CachedOrder, OfflineStore, QueuedMutation } from '@bugsha/offline';

const SCHEMA = `
create table if not exists cached_order (order_id text primary key, code text not null, code_hash text not null, customer_first_name text, quantity integer,
  window_start_utc text, window_end_utc text, method text, amount_due_minor integer, currency text, status text, store_id text, synced_at text, redeemed_by text, redeemed_at text);
create table if not exists mutation_queue (client_id text primary key, operation text not null, payload text not null, client_ts text not null, attempts integer default 0, last_error text, created_at text);
create table if not exists sync_state (key text primary key, value text);`;

export class SqliteOfflineStore implements OfflineStore {
  private constructor(private db: SQLite.SQLiteDatabase) {}
  static async open(): Promise<SqliteOfflineStore> { const db = await SQLite.openDatabaseAsync('bugsha-partner.db'); await db.execAsync(SCHEMA); return new SqliteOfflineStore(db); }
  private rows: CachedOrder[] = []; private queue: QueuedMutation[] = [];
  async load() {
    this.rows = (await this.db.getAllAsync<any>('select * from cached_order')).map(toOrder);
    this.queue = (await this.db.getAllAsync<any>('select * from mutation_queue order by client_ts')).map((r) => ({ clientId: r.client_id, operation: r.operation, payload: JSON.parse(r.payload), clientTs: r.client_ts, attempts: r.attempts, lastError: r.last_error ?? undefined, createdAt: r.created_at }));
  }
  getCachedOrder(codeOrId: string) { const k = codeOrId.toUpperCase(); return this.rows.find((o) => o.orderId.toUpperCase() === k || o.code.toUpperCase() === k); }
  putCachedOrder(o: CachedOrder) {
    this.rows = [...this.rows.filter((r) => r.orderId !== o.orderId), { ...o }];
    void this.db.runAsync('insert or replace into cached_order values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [o.orderId, o.code, o.codeHash, o.customerFirstName, o.quantity, o.windowStartUtc, o.windowEndUtc, o.method, o.amountDueMinor, o.currency, o.status, o.storeId, o.syncedAt, o.redeemedBy ?? null, o.redeemedAt ?? null]);
  }
  enqueue(m: QueuedMutation) { this.queue = [...this.queue, { ...m }]; void this.db.runAsync('insert into mutation_queue values (?,?,?,?,?,?,?)', [m.clientId, m.operation, JSON.stringify(m.payload), m.clientTs, m.attempts, m.lastError ?? null, m.createdAt]); }
  listQueue() { return this.queue.map((m) => ({ ...m })); }
  removeFromQueue(id: string) { this.queue = this.queue.filter((m) => m.clientId !== id); void this.db.runAsync('delete from mutation_queue where client_id = ?', [id]); }
  updateQueueRow(id: string, patch: Partial<QueuedMutation>) { this.queue = this.queue.map((m) => (m.clientId === id ? { ...m, ...patch } : m)); void this.db.runAsync('update mutation_queue set attempts = ?, last_error = ? where client_id = ?', [patch.attempts ?? 0, patch.lastError ?? null, id]); }
}
const toOrder = (r: any): CachedOrder => ({ orderId: r.order_id, code: r.code, codeHash: r.code_hash, customerFirstName: r.customer_first_name, quantity: r.quantity, windowStartUtc: r.window_start_utc, windowEndUtc: r.window_end_utc, method: r.method, amountDueMinor: r.amount_due_minor, currency: r.currency, status: r.status, storeId: r.store_id, syncedAt: r.synced_at, redeemedBy: r.redeemed_by ?? undefined, redeemedAt: r.redeemed_at ?? undefined });
