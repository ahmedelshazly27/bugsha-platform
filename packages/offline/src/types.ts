/**
 * The offline mirror and mutation queue (docs/14-mobile.md §3,
 * docs/01-architecture.md §4, docs/10-types.md).
 */
export interface CachedOrder {
  orderId: string;
  code: string;
  /** Compared by hash so a full code never sits in the local database. */
  codeHash: string;
  customerFirstName: string | null;
  quantity: number;
  windowStartUtc: string;
  windowEndUtc: string;
  method: string;
  amountDueMinor: number;
  currency: string;
  status: string;
  storeId: string;
  syncedAt: string;
  /** Set locally the moment a redemption is confirmed offline. */
  redeemedBy?: string;
  redeemedAt?: string;
}

export type OfflineOperation = 'redeem_order' | 'collect_cash' | 'mark_no_show' | 'publish_listing';

export interface QueuedMutation {
  /** uuidv4 — becomes the Idempotency-Key on the wire. */
  clientId: string;
  operation: OfflineOperation;
  payload: unknown;
  clientTs: string;
  attempts: number;
  lastError?: string;
  createdAt: string;
}

export type SyncOutcome =
  | { kind: 'applied'; serverTs: string }
  | { kind: 'already_applied'; serverTs: string }
  /**
   * e.g. redeemed offline, cancelled online. Resolves to the earliest
   * redemption; the bag was handed over, so the order is honoured.
   */
  | { kind: 'conflict'; resolution: 'honoured' | 'reversed'; note: string };

export interface OfflineStore {
  getCachedOrder(codeOrId: string): CachedOrder | undefined;
  putCachedOrder(order: CachedOrder): void;
  enqueue(mutation: QueuedMutation): void;
  listQueue(): QueuedMutation[];
  removeFromQueue(clientId: string): void;
  updateQueueRow(clientId: string, patch: Partial<QueuedMutation>): void;
}
