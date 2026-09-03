// GENERATED — never hand-write a row type (docs/10-types.md).
// Regenerate with:  pnpm -C packages/api gen:types
// This placeholder types the RPC surface loosely until the generator runs
// against a linked project.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export interface Database {
  public: { Tables: Record<string, { Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown> }>; Enums: {
    market: 'KW' | 'EG'; locale_code: 'en' | 'ar-KW' | 'ar-EG'; partner_role: 'owner' | 'manager' | 'staff' | 'accountant';
    ops_role: 'support_agent' | 'ops_manager' | 'finance' | 'compliance' | 'engineering' | 'admin';
    order_status: 'held' | 'reserved' | 'redeemed' | 'no_show' | 'cancelled_consumer' | 'cancelled_partner' | 'refunded';
    payment_method: 'knet' | 'apple_pay' | 'card' | 'wallet' | 'instapay' | 'fawry' | 'cash' | 'wallet_credit';
    disposition: 'donated' | 'sold_in_store' | 'kept' | 'disposed'; };
    Functions: Record<string, { Args: Record<string, unknown>; Returns: Json }>; Views: Record<string, { Row: Record<string, unknown> }> };
  app: { Functions: Record<string, { Args: Record<string, unknown>; Returns: Json }>; Tables: Record<string, never>; Views: Record<string, never>; Enums: Record<string, never> };
}
