import { describe, it, expect } from 'vitest';
import { can, PARTNER_CAPABILITIES, FOUR_EYES_OPERATIONS, requiresFourEyes } from './permissions';

describe('partner capability matrix (navigation only — RLS decides)', () => {
  it('staff may work the till but never see money', () => {
    expect(can('staff', 'viewOrdersBoard')).toBe(true);
    expect(can('staff', 'redeemOrder')).toBe(true);
    expect(can('staff', 'collectCash')).toBe(true);
    expect(can('staff', 'viewPayouts')).toBe(false);
    expect(can('staff', 'editListingPrice')).toBe(false);
  });

  it('a manager runs the shop but never sees payouts', () => {
    expect(can('manager', 'editListingPrice')).toBe(true);
    expect(can('manager', 'manageStaff')).toBe(true);
    expect(can('manager', 'viewPayouts')).toBe(false);
  });

  it('an accountant sees money but not the orders board', () => {
    expect(can('accountant', 'viewPayouts')).toBe(true);
    expect(can('accountant', 'viewAnalytics')).toBe(true);
    expect(can('accountant', 'viewOrdersBoard')).toBe(false);
    expect(can('accountant', 'redeemOrder')).toBe(false);
  });

  it('only an owner edits the partner profile or accepts a contract', () => {
    for (const role of ['manager', 'staff', 'accountant'] as const) {
      expect(can(role, 'editPartnerProfile')).toBe(false);
      expect(can(role, 'acceptContract')).toBe(false);
    }
    expect(can('owner', 'editPartnerProfile')).toBe(true);
    expect(can('owner', 'acceptContract')).toBe(true);
  });

  it('an unknown capability is denied, never allowed by default', () => {
    expect(can('owner', 'summonTheKraken')).toBe(false);
  });

  it('every capability lists at least one role', () => {
    for (const [name, roles] of Object.entries(PARTNER_CAPABILITIES)) {
      expect(roles.length, name).toBeGreaterThan(0);
    }
  });
});

describe('four-eyes operations', () => {
  it('names the operations that need two distinct approvers', () => {
    expect(requiresFourEyes('ops_approve_payout_run')).toBe(true);
    expect(requiresFourEyes('ops_post_adjustment')).toBe(true);
    expect(requiresFourEyes('ops_read_dispute')).toBe(false);
  });
  it('covers every operation the money and config docs call four-eyes', () => {
    for (const op of ['ops_set_commission', 'ops_approve_payout_run', 'ops_suspend_partner',
                      'ops_propose_config', 'ops_activate_market', 'ops_post_adjustment',
                      'ops_force_cancel', 'ops_request_bulk_export']) {
      expect(FOUR_EYES_OPERATIONS).toContain(op);
    }
  });
});
