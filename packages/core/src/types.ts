/**
 * core/types.ts — the domain vocabulary shared across packages/core.
 *
 * Row types come from `supabase gen types` into @bugsha/api and are never
 * hand-written (docs/10-types.md). What lives here is the small set of unions
 * that core's own modules need without depending on the generated file.
 */
export type Market = 'KW' | 'EG';
export type LocaleCode = 'en' | 'ar-KW' | 'ar-EG';
export type NumeralSystem = 'western' | 'arabic_indic';

export type PaymentMethod =
  | 'knet' | 'apple_pay' | 'card' | 'wallet'
  | 'instapay' | 'fawry' | 'cash' | 'wallet_credit';

export type PartnerRole = 'owner' | 'manager' | 'staff' | 'accountant';
export type OpsRole =
  | 'support_agent' | 'ops_manager' | 'finance'
  | 'compliance' | 'engineering' | 'admin';

/** Coded errors the UI resolves in all three locales (docs/11-i18n.md §errors). */
export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly context: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'AppError';
  }
}
