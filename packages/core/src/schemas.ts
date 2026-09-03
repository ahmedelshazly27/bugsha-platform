/**
 * core/schemas.ts — Zod guards at every boundary.
 *
 * Generated row types say what the database holds; these say what a caller is
 * allowed to send. Message strings are i18n KEYS, not prose: the UI resolves
 * them in all three locales, and they match the codes the server raises so a
 * client-side rejection reads identically to a server-side one
 * (docs/10-types.md, docs/11-i18n.md §errors).
 */
import { z } from 'zod';
import type { MarketConfig } from './market';
import type { Market } from './types';

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

/**
 * Address shapes differ by market. Do not union them into one loose object:
 * a Kuwaiti address has a block, an Egyptian one has a district, and a form
 * that accepts either accepts neither properly.
 */
export const zAddressKW = z.object({
  governorate: z.string().min(1), area: z.string().min(1), block: z.string().min(1),
  street: z.string().min(1), building: z.string().min(1), extra: z.string().optional(),
}).strict();

export const zAddressEG = z.object({
  governorate: z.string().min(1), district: z.string().min(1),
  street: z.string().min(1), building: z.string().min(1), extra: z.string().optional(),
}).strict();

export const zAddress = (market: Market) => (market === 'KW' ? zAddressKW : zAddressEG);

type PriceRules = Pick<MarketConfig, 'priceMinMinor' | 'priceMaxMinor' | 'maxPriceFraction'>;

/**
 * Bag template. Mirrors the server-side checks in app.upsert_bag_template so
 * the client fails fast with the same message keys the server would raise.
 */
export const zBagTemplate = (cfg: PriceRules) =>
  z.object({
    titleEn: z.string().min(1).max(60),
    titleAr: z.string().min(1).max(60),
    descriptionEn: z.string().max(400).optional(),
    descriptionAr: z.string().max(400).optional(),
    category: z.string().refine((c) => c !== 'alcohol', 'template.alcohol_forbidden'),
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
    .refine((t) => t.valueMaxMinor >= t.valueMinMinor,
      { message: 'template.value_range', path: ['valueMaxMinor'] })
    .refine((t) => t.priceMinor >= cfg.priceMinMinor && t.priceMinor <= cfg.priceMaxMinor,
      { message: 'template.price_bounds', path: ['priceMinor'] })
    // The rule that keeps the proposition honest: price at or below half the
    // stated minimum value. Integer maths — a float ratio would let a price a
    // single minor unit over the line slip through.
    .refine((t) => t.priceMinor * 100n <= t.valueMinMinor * BigInt(Math.round(cfg.maxPriceFraction * 100)),
      { message: 'template.price_fraction', path: ['priceMinor'] })
    .refine((t) => (t.descriptionEn?.length ?? 0) > 0 || (t.descriptionAr?.length ?? 0) > 0,
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
    account: z.string().min(1),
    amountMinor: zMoneyMinor,
    partnerId: z.string().uuid().optional(),
    orderId: z.string().uuid().optional(),
  })).min(2),
  /** Mandatory. There is no adjustment without a reason. */
  reasonCode: z.string().min(1),
  justification: z.string().min(10),
  effectiveAt: z.string().datetime(),
}).refine((a) => {
  const d = a.entries.filter((e) => e.entryType === 'debit').reduce((s, e) => s + e.amountMinor, 0n);
  const c = a.entries.filter((e) => e.entryType === 'credit').reduce((s, e) => s + e.amountMinor, 0n);
  return d === c;
}, { message: 'adjustment.unbalanced' });
