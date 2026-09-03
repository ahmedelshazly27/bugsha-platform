# 10 — Types and validation

Row types are **generated, never hand-written**:

```bash
supabase gen types typescript --project-id <id> > packages/api/src/database.types.ts
```

This document holds what generation cannot give you: branded money, the market-config accessor, the Zod schemas that guard every boundary, and the domain result types. Copy the block below verbatim into `packages/core/src/index.ts` and `packages/core/src/schemas.ts` — it is written to compile as-is against `zod` and the generated `Database` type.

> Kept as Markdown rather than a live `.ts` file so the design-system compiler does not try to resolve `zod` in the browser. It is source to copy, not source to run here.

```ts
import { z } from 'zod';
import type { Database } from '@bugsha/api/database.types';

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type Enums<T extends keyof Database['public']['Enums']> =
  Database['public']['Enums'][T];

export type Market = Enums<'market'>;                 // 'KW' | 'EG'
export type LocaleCode = Enums<'locale_code'>;        // 'en' | 'ar-KW' | 'ar-EG'
export type Currency = 'KWD' | 'EGP';

/* ─────────────────────────── Money ─────────────────────────────────────────
 * The ONLY money representation in the codebase. Minor units as bigint plus an
 * explicit currency. No floats, no decimal strings, no bare numbers.
 * Formatting and rounding live here and nowhere else.
 * ------------------------------------------------------------------------- */

declare const MoneyBrand: unique symbol;
export type Money = { readonly minor: bigint; readonly currency: Currency; readonly [MoneyBrand]: true };

export const EXPONENT: Record<Currency, number> = { KWD: 3, EGP: 2 };
export const CURRENCY_OF: Record<Market, Currency> = { KW: 'KWD', EG: 'EGP' };

export function money(minor: bigint | number | string, currency: Currency): Money {
  const v = typeof minor === 'bigint' ? minor : BigInt(minor);
  return { minor: v, currency } as Money;
}
export function zero(currency: Currency): Money { return money(0n, currency); }

function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    // Cross-currency arithmetic is always a bug. There is no implicit FX.
    throw new Error(`currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}
export function add(a: Money, b: Money): Money { sameCurrency(a, b); return money(a.minor + b.minor, a.currency); }
export function sub(a: Money, b: Money): Money { sameCurrency(a, b); return money(a.minor - b.minor, a.currency); }
export function mul(a: Money, n: number): Money { return money(roundHalfUp(a.minor, n), a.currency); }
export function isNegative(a: Money): boolean { return a.minor < 0n; }

/**
 * THE rounding function. Round-half-up at the minor unit.
 * Mirrored exactly by app.round_half_up() in plpgsql — change both or neither.
 * Rounding residue on commission is absorbed by the PLATFORM side; never
 * redistributed silently across partners.
 */
export function roundHalfUp(minor: bigint, factor: number): bigint {
  const scale = 1_000_000n;
  const f = BigInt(Math.round(factor * 1_000_000));
  const product = minor * f;
  const q = product / scale;
  const r = product % scale;
  return r * 2n >= scale ? q + 1n : q;
}

/** Commission from basis points. Base is gross or discounted per promotion funding. */
export function commissionOf(base: Money, bp: number): Money {
  return money(roundHalfUp(base.minor, bp / 10_000), base.currency);
}

/** Locale-aware formatting. The only place a Money becomes a string. */
export function formatMoney(m: Money, locale: LocaleCode, numerals: 'western' | 'arabic_indic'): string {
  const exp = EXPONENT[m.currency];
  const neg = m.minor < 0n;
  const abs = neg ? -m.minor : m.minor;
  const unit = 10n ** BigInt(exp);
  const whole = (abs / unit).toString();
  const frac = (abs % unit).toString().padStart(exp, '0');
  const symbol = locale === 'en'
    ? m.currency
    : m.currency === 'KWD' ? 'د.ك' : 'ج.م';
  let out = `${whole}.${frac} ${symbol}`;
  if (numerals === 'arabic_indic') out = toArabicIndic(out);
  return neg ? `−${out}` : out;
}

export function toArabicIndic(s: string): string {
  return s.replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
}

/* ─────────────────────────── Time ─────────────────────────────────────────
 * A pickup window has TWO representations and both are persisted: the
 * partner's local intent, and the resolved UTC instants.
 * ------------------------------------------------------------------------- */

export const TIMEZONE: Record<Market, string> = { KW: 'Asia/Kuwait', EG: 'Africa/Cairo' };
export const OBSERVES_DST: Record<Market, boolean> = { KW: false, EG: true };

export interface LocalWindowIntent { localDate: string; localStart: string; localEnd: string; timezone: string }
export interface ResolvedWindow { startUtc: Date; endUtc: Date; abbreviation: string }

export type WindowState =
  | 'not_open'      // now < startUtc
  | 'open'          // startUtc <= now < endUtc - 30m
  | 'closing_soon'  // last 30 minutes
  | 'closed'        // endUtc <= now < endUtc + grace
  | 'expired';      // past grace

export interface DstResolution {
  ok: boolean;
  problem?: 'non_existent' | 'ambiguous';
  suggestedStart?: string;
  suggestedEnd?: string;
}

/* ─────────────────────────── Zod schemas ─────────────────────────────────── */

export const zMarket = z.enum(['KW', 'EG']);
export const zLocale = z.enum(['en', 'ar-KW', 'ar-EG']);
export const zNumerals = z.enum(['western', 'arabic_indic']);
export const zMoneyMinor = z.coerce.bigint().nonnegative();
export const zIdempotencyKey = z.string().uuid();

/** Phone validation is market-specific, and the error names the rule. */
export const zPhone = (market: Market) =>
  market === 'KW'
    ? z.string().regex(/^\+965\d{8}$/, 'phone.kw_eight_digits')
    : z.string().regex(/^\+20\d{10}$/, 'phone.eg_ten_digits');

/** Address shapes differ by market. Do not union them into one loose object. */
export const zAddressKW = z.object({
  governorate: z.string().min(1), area: z.string().min(1), block: z.string().min(1),
  street: z.string().min(1), building: z.string().min(1), extra: z.string().optional(),
});
export const zAddressEG = z.object({
  governorate: z.string().min(1), district: z.string().min(1),
  street: z.string().min(1), building: z.string().min(1), extra: z.string().optional(),
});
export const zAddress = (market: Market) => (market === 'KW' ? zAddressKW : zAddressEG);

/**
 * Bag template. Mirrors the server-side checks in app.upsert_bag_template so
 * the client fails fast with the same message keys the server would raise.
 */
export const zBagTemplate = (cfg: MarketConfig) =>
  z.object({
    titleEn: z.string().min(1).max(60),
    titleAr: z.string().min(1).max(60),
    descriptionEn: z.string().max(400).optional(),
    descriptionAr: z.string().max(400).optional(),
    category: z.string().refine(c => c !== 'alcohol', 'template.alcohol_forbidden'),
    valueMinMinor: zMoneyMinor,
    valueMaxMinor: zMoneyMinor,
    priceMinor: zMoneyMinor,
    defaultQuantity: z.number().int().min(1).max(200),
    defaultWindowStart: z.string(),
    defaultWindowEnd: z.string(),
    dietaryFlags: z.array(z.string()),
    allergenNotesEn: z.string().optional(),
    allergenNotesAr: z.string().optional(),
  })
    .refine(t => t.valueMaxMinor >= t.valueMinMinor, { message: 'template.value_range', path: ['valueMaxMinor'] })
    .refine(t => t.priceMinor >= cfg.priceMinMinor && t.priceMinor <= cfg.priceMaxMinor,
      { message: 'template.price_bounds', path: ['priceMinor'] })
    // The rule that keeps the proposition honest: price at or below half the
    // stated minimum value. The error names the ceiling, never just "invalid".
    .refine(t => Number(t.priceMinor) <= Number(t.valueMinMinor) * cfg.maxPriceFraction,
      { message: 'template.price_fraction', path: ['priceMinor'] })
    .refine(t => (t.descriptionEn?.length ?? 0) > 0 || (t.descriptionAr?.length ?? 0) > 0,
      { message: 'template.description_required', path: ['descriptionAr'] });

export const zPublishListing = z.object({
  templateId: z.string().uuid().nullable(),
  storeId: z.string().uuid(),
  quantity: z.number().int().min(1).max(200),
  localDate: z.string(),
  localStart: z.string(),
  localEnd: z.string(),
  idempotencyKey: zIdempotencyKey,
});

export const zHoldListing = z.object({
  listingId: z.string().uuid(),
  quantity: z.number().int().min(1).max(10),
  idempotencyKey: zIdempotencyKey,
});

export const zRedeemOrder = z.object({
  orderId: z.string().uuid(),
  mechanism: z.enum(['code_shown', 'qr_scanned']),
  /** Present only when the redemption was queued offline. */
  clientTs: z.string().datetime().optional(),
  staffUserId: z.string().uuid().optional(),
  idempotencyKey: zIdempotencyKey,
});

export const zCollectCash = z.object({
  orderId: z.string().uuid(),
  collectedMinor: zMoneyMinor,
  idempotencyKey: zIdempotencyKey,
});

/** A promotion cannot exist without funding attribution. No default. */
export const zPromotion = z.object({
  code: z.string().min(3).max(24).regex(/^[A-Z0-9]+$/),
  market: zMarket,
  discountType: z.enum(['fixed', 'percent']),
  discountValue: z.number().int().positive(),
  fundedBy: z.enum(['platform', 'partner']),
  eligibility: z.object({
    newUsersOnly: z.boolean().default(false),
    firstOrderOnly: z.boolean().default(false),
    cityIds: z.array(z.string().uuid()).optional(),
    partnerIds: z.array(z.string().uuid()).optional(),
    categories: z.array(z.string()).optional(),
  }),
  capPerUser: z.number().int().positive().optional(),
  capTotal: z.number().int().positive().optional(),
  budgetCapMinor: zMoneyMinor,
  validFrom: z.string().datetime(),
  validTo: z.string().datetime(),
  stackable: z.boolean(),
});

export const zAdjustment = z.object({
  market: zMarket,
  entries: z.array(z.object({
    entryType: z.enum(['debit', 'credit']),
    account: z.string(),
    amountMinor: zMoneyMinor,
    partnerId: z.string().uuid().optional(),
    orderId: z.string().uuid().optional(),
  })).min(2),
  /** Mandatory. There is no adjustment without a reason. */
  reasonCode: z.string().min(1),
  justification: z.string().min(10),
  effectiveAt: z.string().datetime(),
}).refine(a => {
  const d = a.entries.filter(e => e.entryType === 'debit').reduce((s, e) => s + e.amountMinor, 0n);
  const c = a.entries.filter(e => e.entryType === 'credit').reduce((s, e) => s + e.amountMinor, 0n);
  return d === c;
}, { message: 'adjustment.unbalanced' });

/* ─────────────────────────── Market config ───────────────────────────────── */

export interface MarketConfig {
  market: Market;
  currency: Currency;
  exponent: number;
  timezone: string;
  observesDst: boolean;
  locales: LocaleCode[];
  defaultLocale: LocaleCode;
  numeralsDefault: 'western' | 'arabic_indic';
  paymentMethods: PaymentMethod[];
  cashEnabled: boolean;
  defaultCommissionBp: number;
  /** null means UNDECIDED. Never coerce to 0 — resolveTax() throws instead. */
  vatApplies: boolean;
  vatBp: number | null;
  vatBase: 'commission' | 'gross' | null;
  regulatorName: string;
  priceMinMinor: bigint;
  priceMaxMinor: bigint;
  maxPriceFraction: number;
  reservationCapDefault: number;
  reservationCapNewUser: number;
  reservationCapCash: number;
  holdDurationMinutes: number;
  cancelCutoffHours: number;
  lateRedeemGraceMinutes: number;
  undoRedeemSeconds: number;
  payoutCadence: 'weekly' | 'biweekly';
  payoutMinMinor: bigint;
  refundCapSupportMinor: bigint;
}

export type PaymentMethod = Enums<'payment_method'>;

/**
 * Market-varying values are read from here. NEVER branch inline on
 * `market === 'KW'` in a feature file — add a field to MarketConfig instead.
 */
export interface MarketConfigAccessor {
  get(market: Market): MarketConfig;
  currencyOf(market: Market): Currency;
  methodsFor(market: Market): PaymentMethod[];
  /** Throws BG150 when vatApplies is true but the rate is undecided. */
  resolveTax(market: Market, base: Money, at: Date): Money;
}

/* ─────────────────────────── Domain results ──────────────────────────────── */

export interface RedeemResult {
  order: Tables<'order'>;
  redemption: Tables<'redemption'>;
  /** True when this call found an existing redemption. NOT an error state. */
  alreadyRedeemed: boolean;
  /** Populated when alreadyRedeemed — the staff member who took it. */
  redeemedBy?: { userId: string; fullName: string; at: string };
  cashDue?: Money;
  undoExpiresAt: string;
}

export interface CheckoutSummary {
  order: Tables<'order'>;
  lines: Array<{ key: string; labelKey: string; amount: Money }>;
  total: Money;
  methods: Array<{ method: PaymentMethod; isDefault: boolean; detailKey?: string }>;
  cancellationCutoffAt: string;
  /** Per market + method, resolved from copy/refund-timing.json. */
  refundTimingKey: string;
}

export interface PayoutComposition {
  digitalCollected: Money;
  digitalNoShowRetained: Money;   // distinct line — economically different
  commissionDigital: Money;
  commissionCash: Money;          // Egypt receivable, netted here
  refunds: Money;
  chargebacks: Money;
  adjustments: Money;
  carryIn: Money;
  net: Money;
  carryOut: Money;                // set when net would be negative
  /** Every line expands to its orders: a partner reaches any number in ≤ 2 taps. */
  drilldown: Record<string, string[]>;
}

export interface ComplianceExportRow {
  orderCode: string;
  category: string;
  quantity: number;
  declaredValue: Money;
  listedAt: string;
  windowStart: string;
  windowEnd: string;
  redeemedClientTs: string | null;
  redeemedServerTs: string | null;
  offlineQueued: boolean;
  staffName: string | null;
  disposition: Enums<'disposition'> | null;
}

/* ─────────────────────────── Offline queue ───────────────────────────────── */

export interface QueuedMutation {
  clientId: string;               // uuidv4, becomes the Idempotency-Key
  operation: 'redeem_order' | 'collect_cash' | 'mark_no_show' | 'publish_listing';
  payload: unknown;
  clientTs: string;
  attempts: number;
  lastError?: string;
}

export type SyncOutcome =
  | { kind: 'applied'; serverTs: string }
  | { kind: 'already_applied'; serverTs: string }
  /** e.g. redeemed offline, cancelled online. Resolves to the earliest
   *  redemption; the bag was handed over, so the order is honoured. */
  | { kind: 'conflict'; resolution: 'honoured' | 'reversed'; note: string };

/* ─────────────────────────── Permissions (navigation only) ───────────────── */

export type PartnerRole = Enums<'partner_role'>;
export type OpsRole = Enums<'ops_role'>;

/**
 * Mirrors RLS for showing and hiding navigation. NEVER the enforcement point —
 * the database decides. If these disagree, RLS is right.
 */
export const PARTNER_CAPABILITIES: Record<string, PartnerRole[]> = {
  viewOrdersBoard: ['owner', 'manager', 'staff'],
  redeemOrder: ['owner', 'manager', 'staff'],
  collectCash: ['owner', 'manager', 'staff'],
  createListing: ['owner', 'manager', 'staff'],   // staff: quantity only
  editListingPrice: ['owner', 'manager'],
  cancelListing: ['owner', 'manager'],
  manageTemplates: ['owner', 'manager'],
  manageSchedules: ['owner', 'manager'],
  editStore: ['owner', 'manager'],
  pauseStore: ['owner', 'manager'],
  viewAnalytics: ['owner', 'manager', 'accountant'],
  viewPayouts: ['owner', 'accountant'],
  exportComplianceLedger: ['owner', 'manager', 'accountant'],
  manageStaff: ['owner', 'manager'],              // manager: 'staff' role only
  editPartnerProfile: ['owner'],
  acceptContract: ['owner'],
  respondToReviews: ['owner', 'manager'],
  manageApiKeys: ['owner'],
};

export const FOUR_EYES_OPERATIONS = [
  'ops_set_commission',
  'ops_approve_payout_run',
  'ops_suspend_partner',
  'ops_propose_config',
  'ops_activate_market',
  'ops_post_adjustment',        // above threshold
  'ops_force_cancel',           // above refund cap
  'ops_request_bulk_export',    // above 100 PII rows
] as const;
```
