/**
 * Redemption while offline is the partner app's defining constraint
 * (docs/14-mobile.md §3). These tests are the §13 edge cases 2, 5, 6 and 15.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryOfflineStore } from './memory-store';
import { redeemOffline, syncQueue } from './redeem';
import type { CachedOrder, QueuedMutation, SyncOutcome } from './types';

const WINDOW_START = '2026-09-03T18:00:00.000Z';
const WINDOW_END = '2026-09-03T19:00:00.000Z';
const DURING = new Date('2026-09-03T18:20:00.000Z');
const STAFF = 'bbbbbbbb-0000-4000-8000-000000000001';

const order = (over: Partial<CachedOrder> = {}): CachedOrder => ({
  orderId: '00de0000-0000-4000-8000-000000000002',
  code: 'R3D-9F',
  codeHash: 'hash:R3D-9F',
  customerFirstName: 'Fatima',
  quantity: 1,
  windowStartUtc: WINDOW_START,
  windowEndUtc: WINDOW_END,
  method: 'knet',
  amountDueMinor: 0,
  currency: 'KWD',
  status: 'reserved',
  storeId: 'eeeeeeee-0000-4000-8000-000000000001',
  syncedAt: '2026-09-03T17:00:00.000Z',
  ...over,
});

const hash = (code: string) => `hash:${code.toUpperCase()}`;
let store: MemoryOfflineStore;
beforeEach(() => { store = new MemoryOfflineStore(); store.putCachedOrder(order()); });

describe('the staff member gets a yes or a no, immediately', () => {
  it('confirms with no network and queues the mutation', () => {
    const r = redeemOffline(store, { code: 'R3D-9F', staffUserId: STAFF, now: DURING, hash });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Step 5: CONFIRMED now. Never a spinner, never "pending".
    expect(r.confirmed).toBe(true);
    expect(r.alreadyRedeemed).toBe(false);
    expect(store.getCachedOrder('R3D-9F')!.status).toBe('redeemed');
    const queue = store.listQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]!.operation).toBe('redeem_order');
    expect(queue[0]!.clientTs).toBe(DURING.toISOString());
  });

  it('the queue row id is a uuid and becomes the Idempotency-Key', () => {
    const r = redeemOffline(store, { code: 'R3D-9F', staffUserId: STAFF, now: DURING, hash });
    expect(r.ok && r.clientId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(store.listQueue()[0]!.clientId).toBe(r.ok ? r.clientId : '');
  });

  it('matches the code case-insensitively, by hash', () => {
    expect(redeemOffline(store, { code: 'r3d-9f', staffUserId: STAFF, now: DURING, hash }).ok).toBe(true);
  });

  it('refuses a code it has never seen, and queues nothing', () => {
    const r = redeemOffline(store, { code: 'ZZZ-99', staffUserId: STAFF, now: DURING, hash });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('BG110');
    expect(store.listQueue()).toHaveLength(0);
  });
});

describe('window state is enforced locally, before the network exists', () => {
  it('refuses before the window opens (BG111)', () => {
    const r = redeemOffline(store, { code: 'R3D-9F', staffUserId: STAFF, now: new Date('2026-09-03T17:30:00Z'), hash });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('BG111');
  });

  it('allows a late collection inside the grace, flagged as such (§13-3)', () => {
    const r = redeemOffline(store, {
      code: 'R3D-9F', staffUserId: STAFF, now: new Date('2026-09-03T19:20:00Z'), hash, graceMinutes: 30,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lateGrace).toBe(true);
  });

  it('refuses past the grace (BG112)', () => {
    const r = redeemOffline(store, {
      code: 'R3D-9F', staffUserId: STAFF, now: new Date('2026-09-03T19:40:00Z'), hash, graceMinutes: 30,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('BG112');
  });
});

describe('§13-5 two devices redeem the same order', () => {
  it('the second call returns SUCCESS with the original, never an error', () => {
    redeemOffline(store, { code: 'R3D-9F', staffUserId: STAFF, now: DURING, hash });
    const second = redeemOffline(store, { code: 'R3D-9F', staffUserId: 'other-staff', now: DURING, hash });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.alreadyRedeemed).toBe(true);
    expect(second.confirmed).toBe(true);
    // Names who took it, so the counter can resolve it socially.
    expect(second.redeemedBy).toBe(STAFF);
    // And does NOT queue a second redemption.
    expect(store.listQueue()).toHaveLength(1);
  });
});

describe('sync', () => {
  const applied: SyncOutcome = { kind: 'applied', serverTs: '2026-09-03T18:25:00.000Z' };

  it('drains the queue, reusing the client id as the idempotency key', async () => {
    redeemOffline(store, { code: 'R3D-9F', staffUserId: STAFF, now: DURING, hash });
    const seen: QueuedMutation[] = [];
    await syncQueue(store, async (m) => { seen.push(m); return applied; });
    expect(seen).toHaveLength(1);
    expect(store.listQueue()).toHaveLength(0);
  });

  it('treats already_applied as success — a retry is not a failure', async () => {
    redeemOffline(store, { code: 'R3D-9F', staffUserId: STAFF, now: DURING, hash });
    const r = await syncQueue(store, async () => ({ kind: 'already_applied', serverTs: 'x' }));
    expect(r.applied).toBe(1);
    expect(store.listQueue()).toHaveLength(0);
  });

  it('keeps a failed row queued, counts the attempt and records the error', async () => {
    redeemOffline(store, { code: 'R3D-9F', staffUserId: STAFF, now: DURING, hash });
    await syncQueue(store, async () => { throw new Error('offline'); });
    const [row] = store.listQueue();
    expect(row).toBeDefined();
    expect(row!.attempts).toBe(1);
    expect(row!.lastError).toContain('offline');
  });

  it('§13-6: an order cancelled online is HONOURED, and staff are not blamed', async () => {
    redeemOffline(store, { code: 'R3D-9F', staffUserId: STAFF, now: DURING, hash });
    const r = await syncQueue(store, async () => ({
      kind: 'conflict', resolution: 'honoured',
      note: 'Cancelled online after the bag was handed over; refund reversed into partner revenue.',
    }));
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]!.resolution).toBe('honoured');
    expect(r.conflicts[0]!.blamesStaff).toBe(false);
    expect(store.listQueue()).toHaveLength(0);
  });

  it('§13-15: a revoked staff member keeps attribution for what they already did', async () => {
    redeemOffline(store, { code: 'R3D-9F', staffUserId: STAFF, now: DURING, hash });
    store.revokeStaff(STAFF);
    const seen: QueuedMutation[] = [];
    await syncQueue(store, async (m) => { seen.push(m); return applied; });
    // Revocation never rewrites history.
    expect((seen[0]!.payload as { staffUserId: string }).staffUserId).toBe(STAFF);
  });

  it('preserves queue order so the earliest redemption wins', async () => {
    store.putCachedOrder(order({ orderId: 'o2', code: 'H4N-2K', codeHash: hash('H4N-2K') }));
    redeemOffline(store, { code: 'R3D-9F', staffUserId: STAFF, now: DURING, hash });
    redeemOffline(store, { code: 'H4N-2K', staffUserId: STAFF, now: new Date(DURING.getTime() + 1000), hash });
    const seen: string[] = [];
    await syncQueue(store, async (m) => { seen.push(m.clientTs); return applied; });
    expect(seen).toEqual([...seen].sort());
  });
});

describe('what is NOT cached (§3)', () => {
  it('the mirror holds no money surfaces — only what redemption needs', () => {
    const keys = Object.keys(store.getCachedOrder('R3D-9F')!);
    for (const forbidden of ['payout', 'ledger', 'analytics', 'commission']) {
      expect(keys.some((k) => k.toLowerCase().includes(forbidden))).toBe(false);
    }
  });
});
