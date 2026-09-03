-- ============================================================================
-- Fixtures 50 — accounting periods, ledger, payout run, reconciliation
-- Entry patterns are docs/05-money.md §3, written through app.post_entries()
-- so RLS rule 12 holds. Every transaction balances per currency; the deferred
-- constraint trigger proves it at COMMIT.
-- ============================================================================
set search_path = public, extensions;

-- ─── Accounting periods: one closed, one open, per market ───────────────────
-- The closed period sits two months back so no fixture entry lands inside it;
-- an entry that did would raise BG003, which is exactly ledger test L23.
insert into accounting_period (market, period_start, period_end, locked_at, locked_by)
select m,
       (date_trunc('month', current_date) - interval '2 months')::date,
       (date_trunc('month', current_date) - interval '1 month' - interval '1 day')::date,
       now() - interval '25 days', 'aaaaaaaa-0000-4000-8000-000000000003'::uuid
from unnest(array['KW','EG']::market[]) m;

insert into accounting_period (market, period_start, period_end)
select m, date_trunc('month', current_date)::date,
          (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date
from unnest(array['KW','EG']::market[]) m;

-- ─── 3.1 Digital order, captured ────────────────────────────────────────────
--   DR cash_in_transit  gross
--     CR partner_payable      gross − commission
--     CR commission_revenue   commission
-- commission is o.commission_minor, STAMPED at creation. Not derived here.
do $$
declare o record; tx uuid;
begin
  for o in
    select ord.*, p.payment_id, p.psp_fee_minor
    from "order" ord
    join payment p on p.order_id = ord.order_id
    where ord.method <> 'cash' and ord.payment_status in ('captured','refunded')
  loop
    tx := gen_random_uuid();
    perform app.post_entries(tx, jsonb_build_array(
      jsonb_build_object('entry_type','debit','account','cash_in_transit',
        'amount_minor', o.total_minor,'currency',o.currency,'market',o.market,
        'partner_id',o.partner_id,'store_id',o.store_id,'order_id',o.order_id,
        'payment_id',o.payment_id,'reference_type','order','reference_id',o.order_id,
        'effective_at',o.created_at,'contract_version_id',o.contract_version_id),
      jsonb_build_object('entry_type','credit','account','partner_payable',
        'amount_minor', o.total_minor - o.commission_minor,'currency',o.currency,'market',o.market,
        'partner_id',o.partner_id,'store_id',o.store_id,'order_id',o.order_id,
        'payment_id',o.payment_id,'reference_type','order','reference_id',o.order_id,
        'effective_at',o.created_at,'contract_version_id',o.contract_version_id),
      jsonb_build_object('entry_type','credit','account','commission_revenue',
        'amount_minor', o.commission_minor,'currency',o.currency,'market',o.market,
        'partner_id',o.partner_id,'store_id',o.store_id,'order_id',o.order_id,
        'payment_id',o.payment_id,'reference_type','order','reference_id',o.order_id,
        'effective_at',o.created_at,'contract_version_id',o.contract_version_id)
    ));
  end loop;
end $$;

-- ─── 3.1 Settlement ─────────────────────────────────────────────────────────
--   DR platform_bank  gross − psp_fee
--   DR psp_fees       psp_fee
--     CR cash_in_transit  gross
do $$
declare o record; tx uuid;
begin
  for o in
    select ord.*, p.payment_id, p.psp_fee_minor, p.settled_at
    from "order" ord
    join payment p on p.order_id = ord.order_id
    where p.settled_at is not null
  loop
    tx := gen_random_uuid();
    perform app.post_entries(tx, jsonb_build_array(
      jsonb_build_object('entry_type','debit','account','platform_bank',
        'amount_minor', o.total_minor - o.psp_fee_minor,'currency',o.currency,'market',o.market,
        'partner_id',o.partner_id,'order_id',o.order_id,'payment_id',o.payment_id,
        'reference_type','settlement','reference_id',o.payment_id,'effective_at',o.settled_at),
      jsonb_build_object('entry_type','debit','account','psp_fees',
        'amount_minor', o.psp_fee_minor,'currency',o.currency,'market',o.market,
        'partner_id',o.partner_id,'order_id',o.order_id,'payment_id',o.payment_id,
        'reference_type','settlement','reference_id',o.payment_id,'effective_at',o.settled_at),
      jsonb_build_object('entry_type','credit','account','cash_in_transit',
        'amount_minor', o.total_minor,'currency',o.currency,'market',o.market,
        'partner_id',o.partner_id,'order_id',o.order_id,'payment_id',o.payment_id,
        'reference_type','settlement','reference_id',o.payment_id,'effective_at',o.settled_at)
    ));
  end loop;
end $$;

-- ─── 3.3 Cash order, redeemed (Egypt) ───────────────────────────────────────
--   DR partner_receivable  commission
--     CR commission_revenue  commission
-- The platform never touches the money. On a short collection the commission is
-- computed on collected_minor, not total_minor (§payments P10).
do $$
declare o record; tx uuid; v_base bigint; v_commission bigint;
begin
  for o in
    select ord.*, c.collected_minor, r.server_ts
    from "order" ord
    join cash_collection c on c.order_id = ord.order_id
    join redemption r      on r.order_id = ord.order_id
    where ord.method = 'cash' and ord.status = 'redeemed'
  loop
    v_base := o.collected_minor;
    v_commission := div(v_base * o.commission_bp + 5000, 10000);
    tx := gen_random_uuid();
    perform app.post_entries(tx, jsonb_build_array(
      jsonb_build_object('entry_type','debit','account','partner_receivable',
        'amount_minor', v_commission,'currency',o.currency,'market',o.market,
        'partner_id',o.partner_id,'store_id',o.store_id,'order_id',o.order_id,
        'reference_type','order','reference_id',o.order_id,
        'effective_at',o.server_ts,'contract_version_id',o.contract_version_id),
      jsonb_build_object('entry_type','credit','account','commission_revenue',
        'amount_minor', v_commission,'currency',o.currency,'market',o.market,
        'partner_id',o.partner_id,'store_id',o.store_id,'order_id',o.order_id,
        'reference_type','order','reference_id',o.order_id,
        'effective_at',o.server_ts,'contract_version_id',o.contract_version_id)
    ));
  end loop;
end $$;

-- ─── 3.2 / 3.4 No-show: NO ENTRIES, digital or cash ─────────────────────────
-- Deliberately empty. The partner retains the revenue under the contract's
-- no_show_policy; the capture entries already posted stand, and nothing is
-- reversed. Ledger tests L5 and L8 assert this absence.

-- ─── 3.5 Refund to source ───────────────────────────────────────────────────
--   DR partner_payable     gross − commission
--   DR commission_revenue  commission
--     CR refunds_payable     gross
-- then on disbursement: DR refunds_payable / CR platform_bank.
-- The PSP fee is NOT returned: it stays in psp_fees, because every fixture
-- contract has psp_fee_bearer = 'platform' (decision 5).
do $$
declare o record; tx uuid; v_refund uuid;
begin
  for o in
    select ord.*, p.payment_id
    from "order" ord
    join payment p on p.order_id = ord.order_id
    where ord.status in ('cancelled_consumer','cancelled_partner','refunded')
  loop
    insert into refund (order_id, payment_id, amount_minor, destination, reason_code,
                        cost_bearer, status, disbursed_at)
    values (o.order_id, o.payment_id, o.total_minor, 'source',
            case when o.status = 'cancelled_partner' then 'partner_cancelled'
                 when o.status = 'cancelled_consumer' then 'consumer_request'
                 else 'quality_issue' end,
            'platform', 'disbursed', o.cancelled_at + interval '1 day')
    returning refund_id into v_refund;

    tx := gen_random_uuid();
    perform app.post_entries(tx, jsonb_build_array(
      jsonb_build_object('entry_type','debit','account','partner_payable',
        'amount_minor', o.total_minor - o.commission_minor,'currency',o.currency,'market',o.market,
        'partner_id',o.partner_id,'order_id',o.order_id,'payment_id',o.payment_id,
        'reference_type','refund','reference_id',v_refund,
        'effective_at',coalesce(o.cancelled_at, o.created_at),'contract_version_id',o.contract_version_id),
      jsonb_build_object('entry_type','debit','account','commission_revenue',
        'amount_minor', o.commission_minor,'currency',o.currency,'market',o.market,
        'partner_id',o.partner_id,'order_id',o.order_id,'payment_id',o.payment_id,
        'reference_type','refund','reference_id',v_refund,
        'effective_at',coalesce(o.cancelled_at, o.created_at),'contract_version_id',o.contract_version_id),
      jsonb_build_object('entry_type','credit','account','refunds_payable',
        'amount_minor', o.total_minor,'currency',o.currency,'market',o.market,
        'partner_id',o.partner_id,'order_id',o.order_id,'payment_id',o.payment_id,
        'reference_type','refund','reference_id',v_refund,
        'effective_at',coalesce(o.cancelled_at, o.created_at))
    ));

    tx := gen_random_uuid();
    perform app.post_entries(tx, jsonb_build_array(
      jsonb_build_object('entry_type','debit','account','refunds_payable',
        'amount_minor', o.total_minor,'currency',o.currency,'market',o.market,
        'partner_id',o.partner_id,'order_id',o.order_id,
        'reference_type','refund','reference_id',v_refund,
        'effective_at',coalesce(o.cancelled_at, o.created_at) + interval '1 day'),
      jsonb_build_object('entry_type','credit','account','platform_bank',
        'amount_minor', o.total_minor,'currency',o.currency,'market',o.market,
        'partner_id',o.partner_id,'order_id',o.order_id,
        'reference_type','refund','reference_id',v_refund,
        'effective_at',coalesce(o.cancelled_at, o.created_at) + interval '1 day')
    ));
  end loop;
end $$;

-- ─── 3.7 Goodwill credit, platform-funded ───────────────────────────────────
--   DR goodwill_expense / CR consumer_wallet_liability
-- The partner is untouched. This is the default whenever the failure was the
-- platform's (05-money.md §3.7); ledger test L11 asserts payable is unchanged.
do $$
declare tx uuid := gen_random_uuid(); o record;
begin
  select * into o from "order" where code = 'P4K-9R';
  insert into wallet_transaction (consumer_id, amount_minor, currency, market, source,
                                  reference_type, reference_id)
  values (o.consumer_id, 500, o.currency, o.market, 'goodwill', 'order', o.order_id);
  perform app.post_entries(tx, jsonb_build_array(
    jsonb_build_object('entry_type','debit','account','goodwill_expense',
      'amount_minor',500,'currency',o.currency,'market',o.market,
      'reference_type','adjustment','reference_id',o.order_id,
      'effective_at',now() - interval '1 day','reason_code','goodwill'),
    jsonb_build_object('entry_type','credit','account','consumer_wallet_liability',
      'amount_minor',500,'currency',o.currency,'market',o.market,
      'reference_type','adjustment','reference_id',o.order_id,
      'effective_at',now() - interval '1 day','reason_code','goodwill')
  ));
end $$;

-- ─── Payout run, with all five review exception types (05-money.md §5.7) ────
insert into payout_run (id, market, period_start, period_end, status, frozen_at)
values ('9a1d0000-0000-4000-8000-000000000001','KW',
        (current_date - 7), (current_date - 1), 'review', now() - interval '2 hours');

insert into payout (run_id, partner_id, currency, gross_minor, netted_minor,
                    carry_in_minor, net_minor, carry_out_minor, status, hold_reason) values
  -- 1. negative balance → carries forward. NO DEBIT IS EVER ATTEMPTED (§5).
  ('9a1d0000-0000-4000-8000-000000000001','dddddddd-0000-4000-8000-000000000001','KWD',
   1200, 2000, 0, 0, 800, 'carried', 'negative_balance: refunds exceeded payable this period'),
  -- 2. below the market minimum → carried, not paid
  ('9a1d0000-0000-4000-8000-000000000001','dddddddd-0000-4000-8000-000000000002','KWD',
   3000, 0, 0, 0, 3000, 'carried', 'below_threshold: under payout_min_minor 5000');

insert into payout_run (id, market, period_start, period_end, status, frozen_at)
values ('9a1d0000-0000-4000-8000-000000000002','EG',
        (current_date - 7), (current_date - 1), 'review', now() - interval '2 hours');

insert into payout (run_id, partner_id, currency, gross_minor, netted_minor,
                    carry_in_minor, net_minor, carry_out_minor, status, hold_reason,
                    failure_reason) values
  -- 3. first payout for this partner → manual review
  ('9a1d0000-0000-4000-8000-000000000002','dddddddd-0000-4000-8000-000000000004','EGP',
   26700, 1958, 0, 24742, 0, 'held', 'first_payout: no prior run for this partner', null),
  -- 4. large variance vs the prior period
  ('9a1d0000-0000-4000-8000-000000000002','dddddddd-0000-4000-8000-000000000003','EGP',
   89000, 5874, 0, 83126, 0, 'held', 'large_variance: 214% of prior period', null);

-- 5. payout failure, from the PRIOR run: reverted to pending, entries are NOT
--    lost, the next run picks them up (05-money.md §5, ledger test L21).
insert into payout_run (id, market, period_start, period_end, status, frozen_at, executed_at)
values ('9a1d0000-0000-4000-8000-000000000003','KW',
        (current_date - 14), (current_date - 8), 'executed',
        now() - interval '8 days', now() - interval '7 days');

insert into payout (run_id, partner_id, currency, gross_minor, netted_minor,
                    carry_in_minor, net_minor, carry_out_minor, status, failure_reason)
values ('9a1d0000-0000-4000-8000-000000000003','dddddddd-0000-4000-8000-000000000002','KWD',
        7500, 0, 0, 7500, 0, 'pending', 'bank_rejected: IBAN failed validation at the bank');

insert into statement (payout_id, partner_id, period_start, period_end, totals)
select p.payout_id, p.partner_id, current_date - 7, current_date - 1,
       jsonb_build_object('gross_minor', p.gross_minor, 'netted_minor', p.netted_minor,
                          'net_minor', p.net_minor, 'currency', p.currency)
from payout p;

-- ─── Reconciliation exceptions, one of every type (05-money.md §6) ──────────
insert into settlement_batch (provider, market, settlement_date, gross_minor, fee_minor,
                              net_minor, matched_count, exception_count)
values ('myfatoorah','KW', current_date - 2, 4500, 112, 4388, 3, 4),
       ('paymob','EG', current_date - 2, 26700, 667, 26033, 3, 2);

insert into reconciliation_exception (kind, exception_type, provider_ref, market,
                                      expected_minor, actual_minor, currency, status)
values
  ('psp','captured_not_settled','FIXTURE-R3D-9F','KW', 1500, null,  'KWD','open'),
  ('psp','settled_not_recorded','FIXTURE-UNKNOWN-1','KW', null, 1500,'KWD','open'),
  ('psp','amount_mismatch','FIXTURE-H4N-2K','KW', 1500, 1450, 'KWD','open'),
  ('psp','duplicate_capture','FIXTURE-Q9T-6D','KW', 1500, 3000, 'KWD','open'),
  ('bank','unmatched_credit', null,'KW', null, 9900, 'KWD','open'),
  ('cash','store_variance', null,'EG', 8900, 7700, 'EGP','open');
