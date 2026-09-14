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
export const useMyOrders = (db: Bugsha, enabled = true) => useQuery({ queryKey: keys.myOrders(), enabled, queryFn: async () => { const { data, error } = await db.from('order').select('*').order('created_at', { ascending: false }); if (error) throw error; return data; } });
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

// ── Screens added 2026-09-09 (saved stores, prefs, profile; partner org) ──────
export const useSavedStores = (db: Bugsha) => useQuery({ queryKey: ['saved_stores'], queryFn: () => rpc<any[]>(db, 'my_saved_stores') });
export const useToggleSaved = (db: Bugsha) => useMutation({ mutationFn: (storeId: string) => rpc<boolean>(db, 'toggle_saved_store', { p_store: storeId }) });
export const useSetSavedNotify = (db: Bugsha) => useMutation({ mutationFn: (a: { storeId: string; notify: boolean }) => rpc(db, 'set_saved_notify', { p_store: a.storeId, p_notify: a.notify }) });
export const useNotificationPrefs = (db: Bugsha) => useQuery({ queryKey: ['notif_prefs'], queryFn: () => rpc<any>(db, 'my_notification_prefs') });
export const useSetNotificationPrefs = (db: Bugsha) => useMutation({ mutationFn: (a: { categories: Record<string, boolean>; quietFrom?: string | null; quietTo?: string | null }) => rpc(db, 'set_notification_prefs', { p_categories: a.categories, p_quiet_from: a.quietFrom ?? null, p_quiet_to: a.quietTo ?? null }) });
export const useProfile = (db: Bugsha, enabled = true) => useQuery({ queryKey: ['profile'], enabled, queryFn: () => rpc<any>(db, 'my_profile') });
export const useUpdateProfile = (db: Bugsha) => useMutation({ mutationFn: (a: { firstName: string; lastName?: string; phone?: string }) => rpc(db, 'update_profile', { p_first_name: a.firstName, p_last_name: a.lastName ?? null, p_phone: a.phone ?? null }) });
export const useSetDietary = (db: Bugsha) => useMutation({ mutationFn: (a: { flags: string[]; ack: boolean }) => rpc(db, 'set_dietary', { p_flags: a.flags, p_allergen_ack: a.ack }) });
export const useRequestDeletion = (db: Bugsha) => useMutation({ mutationFn: () => rpc<any>(db, 'request_deletion') });
export const useRegisterDevice = (db: Bugsha) => useMutation({ mutationFn: (a: { token: string; platform: string }) => rpc(db, 'register_device', { p_token: a.token, p_platform: a.platform }) });
export const useStoreProfile = (db: Bugsha, storeId: string) => useQuery({ queryKey: ['store', storeId], queryFn: () => rpc<any>(db, 'store_profile', { p_store: storeId }) });
export const useRequestRefund = (db: Bugsha) => useMutation({ mutationFn: (a: { orderId: string; amountMinor: number; destination: string; reasonCode: string }) => rpc(db, 'request_refund', { p_order: a.orderId, p_amount_minor: a.amountMinor, p_destination: a.destination, p_reason_code: a.reasonCode }) });
export const usePartner = (db: Bugsha, partnerId: string) => useQuery({ queryKey: ['partner', partnerId], enabled: !!partnerId, queryFn: () => rpc<any>(db, 'my_partner', { p_partner: partnerId }) });
export const useUpsertTemplate = (db: Bugsha) => useMutation({ mutationFn: (a: Record<string, unknown>) => rpc(db, 'upsert_bag_template', a) });
export const useArchiveTemplate = (db: Bugsha) => useMutation({ mutationFn: (id: string) => rpc(db, 'archive_template', { p_template_id: id }) });
export const useStaff = (db: Bugsha, partnerId: string) => useQuery({ queryKey: ['staff', partnerId], enabled: !!partnerId, queryFn: () => rpc<any[]>(db, 'my_staff', { p_partner: partnerId }) });
export const useInviteStaff = (db: Bugsha) => useMutation({ mutationFn: (a: { email: string; partnerId: string; storeId: string | null; role: string; name?: string }) => rpc(db, 'invite_staff_by_email', { p_email: a.email, p_partner: a.partnerId, p_store: a.storeId, p_role: a.role, p_full_name: a.name ?? null }) });
export const useRevokeStaff = (db: Bugsha) => useMutation({ mutationFn: (assignmentId: string) => rpc(db, 'revoke_staff', { p_assignment: assignmentId }) });
export const useReviews = (db: Bugsha, partnerId: string) => useQuery({ queryKey: ['reviews', partnerId], enabled: !!partnerId, queryFn: () => rpc<any[]>(db, 'my_reviews', { p_partner: partnerId }) });
export const useRespondReview = (db: Bugsha) => useMutation({ mutationFn: (a: { reviewId: string; body: string }) => rpc(db, 'respond_to_review', { p_review: a.reviewId, p_body: a.body }) });
export const useDocuments = (db: Bugsha, partnerId: string) => useQuery({ queryKey: ['documents', partnerId], enabled: !!partnerId, queryFn: () => rpc<any[]>(db, 'my_documents', { p_partner: partnerId }) });
export const useUploadDocument = (db: Bugsha) => useMutation({ mutationFn: (a: { partnerId: string; docType: string; storagePath: string; storeId?: string | null; expiresOn?: string | null }) => rpc(db, 'upload_document', { p_partner: a.partnerId, p_doc_type: a.docType, p_storage_path: a.storagePath, p_store_id: a.storeId ?? null, p_expires_on: a.expiresOn ?? null }) });
export const useAcceptContract = (db: Bugsha) => useMutation({ mutationFn: (a: { contractId: string; hash: string }) => rpc(db, 'accept_contract', { p_contract: a.contractId, p_ip: '0.0.0.0', p_ua: 'BugshaPartner/mobile', p_document_hash: a.hash }) });
// ── Code-gated partner sign-up (2026-09-14): a partner account opens only with a code ops issued ──
export type PartnerCodeCheck = { status: 'ok' | 'invalid' | 'expired' | 'redeemed' | 'revoked'; code?: string; market?: string; trading_name?: string | null; legal_name?: string | null; issued_to_name?: string };
/** Anonymous-safe: what the "Enter your partner code" screen calls. Normalises dashes and case server-side. */
export const useCheckPartnerCode = (db: Bugsha) => useMutation({ mutationFn: (code: string) => rpc<PartnerCodeCheck>(db, 'check_partner_code', { p_code: code }) });
export type ApplicationInput = { code: string; market: string; legalName: string; tradingName: string; categories: string[]; contactName: string; contactPhone: string; contactEmail: string; cityId: string; branchCount?: number; referralSource?: string | null; estDailySurplusMinor?: number | null };
/** Redeems the code and creates the partner in `applied`; the caller becomes its owner. BG122 without a live code, BG123 for the wrong market. */
export const useSubmitApplication = (db: Bugsha) => useMutation({ mutationFn: (a: ApplicationInput) => rpc<any>(db, 'submit_application', { p_code: a.code, p_market: a.market, p_legal_name: a.legalName, p_trading_name: a.tradingName, p_categories: a.categories, p_contact_name: a.contactName, p_contact_phone: a.contactPhone, p_contact_email: a.contactEmail, p_city_id: a.cityId, p_branch_count: a.branchCount ?? 1, p_referral_source: a.referralSource ?? null, p_est_daily_surplus_minor: a.estDailySurplusMinor ?? null }) });
export type MyPartner = { partner_id: string; trading_name: string; market: string; onboarding_status: string; role: string; store_count: number };
/** Partners this account belongs to partner-wide — non-empty for an applicant who has no branch yet, when my_stores_detail is still empty. */
export const useMyPartners = (db: Bugsha, enabled = true) => useQuery({ queryKey: ['my_partners'], enabled, queryFn: () => rpc<MyPartner[]>(db, 'my_partners') });
export const useUpsertStore = (db: Bugsha) => useMutation({ mutationFn: (a: Record<string, unknown>) => rpc<any>(db, 'upsert_store', a) });
export const useSetHours = (db: Bugsha) => useMutation({ mutationFn: (a: { storeId: string; rows: unknown[]; ramadan?: boolean }) => rpc(db, 'set_hours', { p_store: a.storeId, p_rows: a.rows, p_is_ramadan: a.ramadan ?? false }) });
export const useReliability = (db: Bugsha, partnerId: string) => useQuery({ queryKey: ['reliability', partnerId], enabled: !!partnerId, queryFn: () => rpc<any>(db, 'reliability', { p_partner: partnerId }) });
export const useInsights = (db: Bugsha, partnerId: string) => useQuery({ queryKey: ['insights', partnerId], enabled: !!partnerId, queryFn: () => rpc<any>(db, 'analytics_insights', { p_partner: partnerId }) });
export const useComplianceLedger = (db: Bugsha, storeId: string, from: string, to: string) => useQuery({ queryKey: ['ledger', storeId, from, to], enabled: !!storeId, queryFn: () => rpc<any[]>(db, 'compliance_ledger', { p_store: storeId, p_from: from, p_to: to }) });
export const useSubmitCashRecon = (db: Bugsha) => useMutation({ mutationFn: (a: { storeId: string; date: string; reportedMinor: number; note?: string }) => rpc(db, 'submit_cash_reconciliation', { p_store: a.storeId, p_date: a.date, p_reported_minor: a.reportedMinor, p_note: a.note ?? null }) });
export const useUpsertSchedule = (db: Bugsha) => useMutation({ mutationFn: (a: Record<string, unknown>) => rpc(db, 'upsert_schedule', a) });
export const useSchedules = (db: Bugsha, storeId: string) => useQuery({ queryKey: ['schedules', storeId], enabled: !!storeId, queryFn: () => rpc<any[]>(db, 'schedules', { p_store: storeId }) });
export const usePauseSchedule = (db: Bugsha) => useMutation({ mutationFn: (id: string) => rpc(db, 'pause_schedule', { p_schedule: id }) });
export const usePauseStore = (db: Bugsha) => useMutation({ mutationFn: (a: { storeId: string; reason: string; until: string }) => rpc(db, 'pause_store', { p_store: a.storeId, p_reason_code: a.reason, p_until: a.until }) });
