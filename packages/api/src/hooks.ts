/**
 * One hook per screen contract (09-screens.md). Reads are direct selects or
 * RPCs under RLS; writes are ALWAYS RPCs. Server state lives in react-query
 * only (01-architecture.md §4).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Bugsha } from './client';
import { newIdempotencyKey, rpc } from './rpc';

export const keys = {
  browse: (market: string, city: string | null) => ['browse', market, city] as const,
  nearby: (lat: number, lng: number) => ['nearby', lat.toFixed(3), lng.toFixed(3)] as const,
  listing: (id: string) => ['listing', id] as const,
  order: (id: string) => ['order', id] as const,
  myOrders: () => ['my-orders'] as const,
  impact: () => ['impact'] as const,
  wallet: () => ['wallet'] as const,
  today: (store: string) => ['today', store] as const,
  board: (store: string) => ['board', store] as const,
  payouts: (partner: string) => ['payouts', partner] as const,
};

// ── Consumer ────────────────────────────────────────────────────────────────
export const useBrowse = (db: Bugsha, market: string, city: string | null) => useQuery({
  queryKey: keys.browse(market, city),
  queryFn: async () => {
    let q = db.from('v_browse_listing').select('*').eq('market', market).order('window_end_utc');
    if (city) q = q.eq('city_id', city);
    const { data, error } = await q; if (error) throw error; return data;
  },
  staleTime: 30_000,
});
export const useNearby = (db: Bugsha, lat: number, lng: number, radius = 5000, filters: Record<string, unknown> = {}) => useQuery({
  queryKey: [...keys.nearby(lat, lng), radius, filters], queryFn: () => rpc(db, 'browse_nearby', { p_lat: lat, p_lng: lng, p_radius_m: radius, p_filters: filters }),
});
export const useSearch = (db: Bugsha, market: string, query: string, city: string | null) => useQuery({
  queryKey: ['search', market, city, query], enabled: query.length >= 2,
  queryFn: () => rpc(db, 'search_listings', { p_query: query, p_market: market, p_city: city }),
});
export const useListing = (db: Bugsha, id: string) => useQuery({ queryKey: keys.listing(id), queryFn: () => rpc(db, 'listing_detail', { p_listing_id: id }) });
export const useOrder = (db: Bugsha, id: string) => useQuery({ queryKey: keys.order(id), queryFn: () => rpc(db, 'order_detail', { p_order: id }) });
export const useMyOrders = (db: Bugsha) => useQuery({ queryKey: keys.myOrders(), queryFn: async () => { const { data, error } = await db.from('order').select('*').order('created_at', { ascending: false }); if (error) throw error; return data; } });
export const useImpact = (db: Bugsha) => useQuery({ queryKey: keys.impact(), queryFn: () => rpc(db, 'my_impact') });
export const useWallet = (db: Bugsha) => useQuery({ queryKey: keys.wallet(), queryFn: () => rpc(db, 'wallet_balance') });

export function useHold(db: Bugsha) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ listingId, quantity, key = newIdempotencyKey() }: { listingId: string; quantity: number; key?: string }) =>
      rpc(db, 'hold_listing', { p_listing_id: listingId, p_quantity: quantity, p_idempotency: key }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['browse'] }); qc.invalidateQueries({ queryKey: keys.myOrders() }); },
  });
}
export const useReleaseHold = (db: Bugsha) => useMutation({ mutationFn: (orderId: string) => rpc(db, 'release_hold', { p_order_id: orderId }) });
export const useReserveCash = (db: Bugsha) => useMutation({ mutationFn: ({ orderId, key = newIdempotencyKey() }: { orderId: string; key?: string }) => rpc(db, 'reserve_cash_order', { p_order_id: orderId, p_idempotency: key }) });
export const useApplyPromotion = (db: Bugsha) => useMutation({ mutationFn: ({ orderId, code }: { orderId: string; code: string }) => rpc(db, 'apply_promotion', { p_order: orderId, p_code: code }) });
export const useCancelOrder = (db: Bugsha) => useMutation({ mutationFn: ({ orderId, reasonCode, destination = 'source' }: { orderId: string; reasonCode: string; destination?: string }) => rpc(db, 'cancel_order', { p_order_id: orderId, p_reason_code: reasonCode, p_destination: destination }) });
export const useCompleteProfile = (db: Bugsha) => useMutation({ mutationFn: (a: { firstName: string; market: string; cityId?: string; phone?: string }) => rpc(db, 'complete_profile', { p_first_name: a.firstName, p_market: a.market, p_city_id: a.cityId ?? null, p_phone: a.phone ?? null }) });
export const useSetMarket = (db: Bugsha) => useMutation({ mutationFn: (a: { market: string; cityId: string; confirm: boolean }) => rpc(db, 'set_market', { p_market: a.market, p_city_id: a.cityId, p_confirm: a.confirm }) });
export const useCities = (db: Bugsha, market: string) => useQuery({ queryKey: ['cities', market], queryFn: () => rpc(db, 'cities_for', { p_market: market }) });
export const useSubmitReview = (db: Bugsha) => useMutation({ mutationFn: (a: { orderId: string; rating: number; tags?: string[]; body?: string }) => rpc(db, 'submit_review', { p_order: a.orderId, p_rating: a.rating, p_tags: a.tags ?? [], p_body: a.body ?? null }) });
export const useOpenDispute = (db: Bugsha) => useMutation({ mutationFn: (a: { orderId: string; category: string; statement: string; photos?: string[]; illness?: Record<string, unknown> }) => rpc(db, 'open_dispute', { p_order: a.orderId, p_category: a.category, p_statement: a.statement, p_photos: a.photos ?? [], p_illness_detail: a.illness ?? null }) });

// ── Partner ─────────────────────────────────────────────────────────────────
export interface MyStore { store_id: string; partner_id: string; role: string; display_name: string; trading_name: string; market: string; timezone: string }
export const useMyStores = (db: Bugsha, enabled = true) => useQuery({ queryKey: ['my_stores'], queryFn: () => rpc<MyStore[]>(db, 'my_stores_detail'), enabled });
export const useToday = (db: Bugsha, store: string) => useQuery({ queryKey: keys.today(store), queryFn: () => rpc(db, 'today', { p_store: store }), refetchInterval: 30_000 });
export const useOrdersBoard = (db: Bugsha, store: string) => useQuery({ queryKey: keys.board(store), queryFn: () => rpc(db, 'orders_board', { p_store: store }), refetchInterval: 10_000 });
export const useLookupOrder = (db: Bugsha, store: string, fragment: string) => useQuery({ queryKey: ['lookup', store, fragment], enabled: fragment.length >= 2, queryFn: () => rpc(db, 'lookup_order', { p_store: store, p_fragment: fragment }) });
export const useTemplates = (db: Bugsha, partner: string) => useQuery({ queryKey: ['templates', partner], queryFn: () => rpc(db, 'templates', { p_partner: partner }) });
export const useListings = (db: Bugsha, store: string) => useQuery({ queryKey: ['listings', store], queryFn: () => rpc(db, 'listings', { p_store: store }) });
export function usePublish(db: Bugsha) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { templateId: string; quantity: number; localDate: string; localStart: string; localEnd: string; key?: string }) =>
      rpc(db, 'publish_listing', { p_template_id: a.templateId, p_quantity: a.quantity, p_local_date: a.localDate, p_local_start: a.localStart, p_local_end: a.localEnd, p_idempotency: a.key ?? newIdempotencyKey() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['listings'] }),
  });
}
export const useUpdateListing = (db: Bugsha) => useMutation({ mutationFn: (a: { listingId: string; quantity?: number; priceMinor?: number; localEnd?: string }) => rpc(db, 'update_listing', { p_listing_id: a.listingId, p_quantity: a.quantity ?? null, p_price_minor: a.priceMinor ?? null, p_local_end: a.localEnd ?? null }) });
export const useCancelListing = (db: Bugsha) => useMutation({ mutationFn: (a: { listingId: string; reasonCode: string; text?: string }) => rpc(db, 'cancel_listing', { p_listing: a.listingId, p_reason_code: a.reasonCode, p_reason_text: a.text ?? null }) });
export function useRedeem(db: Bugsha) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { orderId: string; mechanism: 'code_shown' | 'qr_scanned'; key: string; clientTs?: string; staffUserId?: string }) =>
      rpc(db, 'redeem_order', { p_order: a.orderId, p_mechanism: a.mechanism, p_idempotency: a.key, p_client_ts: a.clientTs ?? null, p_staff_user: a.staffUserId ?? null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['board'] }),
  });
}
export const useRedeemLate = (db: Bugsha) => useMutation({ mutationFn: (a: { orderId: string; key?: string }) => rpc(db, 'redeem_order_late', { p_order: a.orderId, p_mechanism: 'code_shown', p_idempotency: a.key ?? newIdempotencyKey() }) });
export const useUndoRedemption = (db: Bugsha) => useMutation({ mutationFn: (orderId: string) => rpc(db, 'undo_redemption', { p_order: orderId }) });
export const useCollectCash = (db: Bugsha) => useMutation({ mutationFn: (a: { orderId: string; collectedMinor: number; key?: string }) => rpc(db, 'collect_cash', { p_order: a.orderId, p_collected_minor: a.collectedMinor, p_idempotency: a.key ?? newIdempotencyKey() }) });
export const useMarkNoShow = (db: Bugsha) => useMutation({ mutationFn: (a: { orderId: string; disposition: string }) => rpc(db, 'mark_no_show', { p_order: a.orderId, p_disposition: a.disposition }) });
export const useAnalytics = (db: Bugsha, partner: string, from: string, to: string) => useQuery({ queryKey: ['analytics', partner, from, to], queryFn: () => rpc(db, 'analytics_summary', { p_partner: partner, p_from: from, p_to: to }) });
export const usePayouts = (db: Bugsha, partner: string) => useQuery({ queryKey: keys.payouts(partner), queryFn: () => rpc(db, 'payouts', { p_partner: partner }) });
export const usePayoutDetail = (db: Bugsha, id: string) => useQuery({ queryKey: ['payout', id], queryFn: () => rpc(db, 'payout_detail', { p_payout: id }) });
export const useCashLiability = (db: Bugsha, partner: string) => useQuery({ queryKey: ['cash-liability', partner], queryFn: () => rpc(db, 'cash_liability', { p_partner: partner }) });
export const useEndOfDay = (db: Bugsha, store: string, date: string) => useQuery({ queryKey: ['eod', store, date], queryFn: () => rpc(db, 'end_of_day', { p_store: store, p_date: date }) });

/** Realtime: a new reservation is visible on the board within 2 s p95. */
export function subscribeOrdersBoard(db: Bugsha, storeId: string, onChange: () => void) {
  return db.channel(`store:${storeId}:orders`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'order', filter: `store_id=eq.${storeId}` }, onChange)
    .subscribe();
}

// ── Ops ─────────────────────────────────────────────────────────────────────
export const useOps = <T = unknown>(db: Bugsha, fn: string, args: Record<string, unknown> = {}, enabled = true) =>
  useQuery<T>({ queryKey: ['ops', fn, args], queryFn: () => rpc<T>(db, fn, args), enabled });
export const useOpsMutation = (db: Bugsha, fn: string) => useMutation({ mutationFn: (args: Record<string, unknown>) => rpc(db, fn, args) });
