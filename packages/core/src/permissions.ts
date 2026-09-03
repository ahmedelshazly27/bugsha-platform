/**
 * core/permissions.ts — the role matrix, mirrored from RLS for NAVIGATION ONLY.
 *
 * This is never the enforcement point: the database decides (docs/CLAUDE.md
 * §11). If this file and RLS disagree, RLS is right and this file is the bug.
 * Its only job is to stop the UI offering a control that the server will
 * refuse — showing a payouts tab to a staff member is a bug even though RLS
 * would return no rows.
 */
import type { OpsRole, PartnerRole } from './types';

export const PARTNER_CAPABILITIES: Record<string, readonly PartnerRole[]> = {
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

/** Unknown capabilities are denied. Default-allow is how privilege leaks. */
export function can(role: PartnerRole, capability: string): boolean {
  return PARTNER_CAPABILITIES[capability]?.includes(role) ?? false;
}

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

export type FourEyesOperation = (typeof FOUR_EYES_OPERATIONS)[number];

export function requiresFourEyes(operation: string): operation is FourEyesOperation {
  return (FOUR_EYES_OPERATIONS as readonly string[]).includes(operation);
}

/** Ops roles that may reach money surfaces at all (mirrors 04-rls.sql). */
export const OPS_LEDGER_ROLES: readonly OpsRole[] = ['finance', 'admin'];
