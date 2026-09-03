/**
 * In-memory OfflineStore. The app supplies an expo-sqlite implementation of
 * the same interface; keeping the logic storage-agnostic is what lets the
 * §13 edge cases be tested without a device.
 */
import type { CachedOrder, OfflineStore, QueuedMutation } from './types';

export class MemoryOfflineStore implements OfflineStore {
  private orders = new Map<string, CachedOrder>();
  private queue: QueuedMutation[] = [];
  private revoked = new Set<string>();

  getCachedOrder(codeOrId: string): CachedOrder | undefined {
    const key = codeOrId.toUpperCase();
    for (const o of this.orders.values()) {
      if (o.orderId.toUpperCase() === key || o.code.toUpperCase() === key) return o;
    }
    return undefined;
  }

  putCachedOrder(order: CachedOrder): void {
    // Immutable update: never hand a caller a reference it can mutate.
    this.orders.set(order.orderId, { ...order });
  }

  enqueue(mutation: QueuedMutation): void {
    this.queue = [...this.queue, { ...mutation }];
  }

  listQueue(): QueuedMutation[] {
    return this.queue.map((m) => ({ ...m }));
  }

  removeFromQueue(clientId: string): void {
    this.queue = this.queue.filter((m) => m.clientId !== clientId);
  }

  updateQueueRow(clientId: string, patch: Partial<QueuedMutation>): void {
    this.queue = this.queue.map((m) => (m.clientId === clientId ? { ...m, ...patch } : m));
  }

  /** Test affordance for §13-15 — revocation must not rewrite the queue. */
  revokeStaff(userId: string): void {
    this.revoked.add(userId);
  }

  isRevoked(userId: string): boolean {
    return this.revoked.has(userId);
  }
}
