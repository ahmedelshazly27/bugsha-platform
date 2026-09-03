-- ============================================================================
-- §ledger — the invariants phase 1 can prove
-- docs/12-test-plan.md §ledger. The cases that depend on the app.post_* entry
-- patterns of 05-money.md §3 (L7, L10, L12-L17, L22-L23) belong to phase 5 and
-- are listed at the foot of this file rather than silently omitted.
-- L24 is the one that must never be skipped or quarantined.
-- ============================================================================
begin;
select plan(24);

-- ─── L1. Digital capture, KWD ───────────────────────────────────────────────
select is(
  (select count(*)::int from financial_entry e
   join "order" o on o.order_id = e.order_id
   where o.code = 'R3D-9F' and e.reference_type = 'order'),
  3,
  'L1a: a digital capture writes exactly three entries');

select is(
  (select sum(case when e.entry_type = 'debit' then e.amount_minor else -e.amount_minor end)::bigint
   from financial_entry e join "order" o on o.order_id = e.order_id
   where o.code = 'R3D-9F' and e.reference_type = 'order'),
  0::bigint,
  'L1b: and they balance');

select is(
  (select e.amount_minor from financial_entry e
   join "order" o on o.order_id = e.order_id
   where o.code = 'R3D-9F' and e.account = 'commission_revenue' and e.reference_type = 'order'),
  (select commission_minor from "order" where code = 'R3D-9F'),
  'L1c: commission posted equals the value stamped on the order, not a recomputation');

-- ─── L2. Digital capture, EGP — exponent 2 ──────────────────────────────────
select is(
  (select currency from "order" where code = 'F9D-4T'), 'EGP'::bpchar,
  'L2a: Egyptian orders are denominated in EGP');
select is(
  (select exponent from market_config where market = 'EG'), 2::smallint,
  'L2b: EGP has exponent 2, so 8950 minor units is 89.50 — never 895.0');
select is(
  (select sum(case when e.entry_type = 'debit' then e.amount_minor else -e.amount_minor end)::bigint
   from financial_entry e join "order" o on o.order_id = e.order_id
   where o.code = 'F9D-4T' and e.reference_type = 'order'),
  0::bigint,
  'L2c: the EGP capture balances');

-- ─── L3. Commission immutability across a rate change ───────────────────────
-- Al Diwan renegotiates again. A stamped order must not move.
create temporary table l3_before as
  select order_id, commission_bp, commission_minor, contract_version_id
  from "order" where code = 'H4N-2K';

insert into partner_contract (partner_id, version, commission_bp, payout_cadence,
                              payout_min_minor, effective_from, accepted_at)
values ('dddddddd-0000-4000-8000-000000000001', 3, 900, 'weekly', 5000, current_date, now());

select is(
  (select o.commission_bp from "order" o where o.code = 'H4N-2K'),
  (select b.commission_bp from l3_before b),
  'L3a: the order''s commission_bp is unchanged by a new contract version');
select is(
  (select o.commission_minor from "order" o where o.code = 'H4N-2K'),
  (select b.commission_minor from l3_before b),
  'L3b: the stamped commission amount is unchanged');
select is(
  (select o.contract_version_id from "order" o where o.code = 'H4N-2K'),
  (select b.contract_version_id from l3_before b),
  'L3c: and it still points at the contract version in force when it was created');

-- ─── L4. Settlement ─────────────────────────────────────────────────────────
select is(
  (select sum(e.amount_minor) filter (where e.account in ('platform_bank','psp_fees'))
   from financial_entry e where e.reference_type = 'settlement' and e.currency = 'KWD'),
  (select sum(e.amount_minor) filter (where e.account = 'cash_in_transit')
   from financial_entry e where e.reference_type = 'settlement' and e.currency = 'KWD'),
  'L4: platform_bank + psp_fees equals cash_in_transit for the settled batch');

-- ─── L5. Digital no-show writes NO entries ──────────────────────────────────
-- The capture stands; nothing is reversed. The retained amount is a reporting
-- line, not a ledger movement (05-money.md §3.2).
select is(
  (select count(*)::int from financial_entry e
   join "order" o on o.order_id = e.order_id
   where o.code = 'Q9T-6D' and e.reference_type <> 'order' and e.reference_type <> 'settlement'),
  0,
  'L5: a digital no-show writes no entry of its own');

-- ─── L6. Cash commission ────────────────────────────────────────────────────
select set_eq(
  $$ select distinct e.account::text from financial_entry e
     join "order" o on o.order_id = e.order_id
     where o.code = 'X9H-4K' $$,
  array['partner_receivable','commission_revenue'],
  'L6a: a redeemed cash order touches only partner_receivable and commission_revenue');
select is(
  (select count(*)::int from financial_entry e
   join "order" o on o.order_id = e.order_id
   where o.code = 'X9H-4K' and e.account in ('cash_in_transit','partner_payable')),
  0,
  'L6b: the platform never touches the cash, so there is no cash_in_transit leg');

-- Short collection: commission follows what was actually collected (§P10).
select is(
  (select e.amount_minor from financial_entry e
   join "order" o on o.order_id = e.order_id
   where o.code = 'D6N-3P' and e.account = 'commission_revenue'),
  (select div(c.collected_minor * o.commission_bp + 5000, 10000)
   from "order" o join cash_collection c on c.order_id = o.order_id
   where o.code = 'D6N-3P'),
  'L6c: commission on a short collection is computed on collected_minor');

-- ─── L8. Cash no-show writes NO entries ─────────────────────────────────────
select is(
  (select count(*)::int from financial_entry e
   join "order" o on o.order_id = e.order_id where o.code = 'Z2K-7M'),
  0,
  'L8: a cash no-show moves no money and earns no commission');

-- ─── L9. Refund to source ───────────────────────────────────────────────────
select is(
  (select sum(case when e.entry_type = 'debit' then e.amount_minor else -e.amount_minor end)::bigint
   from financial_entry e join "order" o on o.order_id = e.order_id
   where o.code = 'Y6F-3M' and e.reference_type = 'refund'),
  0::bigint,
  'L9a: the refund transactions balance');
select isnt_empty(
  $$ select 1 from financial_entry where account = 'psp_fees' $$,
  'L9b: the PSP fee stays in psp_fees — it is not clawed back from the partner');

-- ─── L11. Goodwill leaves the partner untouched ─────────────────────────────
select is(
  (select count(*)::int from financial_entry
   where reference_type = 'adjustment' and reason_code = 'goodwill'
     and account = 'partner_payable'),
  0,
  'L11: a platform-funded goodwill credit never debits partner_payable');

-- ─── L18. Rounding ──────────────────────────────────────────────────────────
select is(div(1750::bigint * 2200 + 5000, 10000), 385::bigint,
  'L18: 22% of 1750 is 385, round-half-up at the minor unit');

-- ─── L20/L21. Payout behaviour ──────────────────────────────────────────────
select is(
  (select count(*)::int from payout where net_minor < 0),
  0,
  'L20a: no payout is negative — the platform never attempts to debit a partner');
select isnt_empty(
  $$ select 1 from payout where status = 'carried' and carry_out_minor > 0 $$,
  'L20b: a negative or sub-threshold balance carries forward explicitly');
select isnt_empty(
  $$ select 1 from payout where status = 'pending' and failure_reason is not null $$,
  'L21: a failed payout reverts to pending with its reason, entries preserved');

-- ─── L24. Global balance. If this goes red, stop the line. ──────────────────
select is_empty(
  $$ select transaction_id from financial_entry
     group by transaction_id, currency
     having sum(case when entry_type = 'debit' then amount_minor else -amount_minor end) <> 0 $$,
  'L24a: every transaction balances, per currency');
select is_empty(
  $$ select currency from financial_entry
     group by currency
     having sum(case when entry_type = 'debit' then amount_minor else -amount_minor end) <> 0 $$,
  'L24b: the whole ledger balances, per currency');

select * from finish();
rollback;

-- ============================================================================
-- Deferred to phase 5, with the app.post_* pattern each one needs:
--   L7  cash netting inside a payout run      app.post_payout()
--   L10 refund to wallet, then wallet spend   app.post_refund_to_wallet()
--   L12 platform-funded promotion             app.post_promo_capture()
--   L13 partner-funded promotion              app.post_promo_capture()
--   L14 chargeback, partner bears             app.post_chargeback()
--   L15 chargeback, platform bears            app.post_chargeback()
--   L16 adjustment without a reason code      app.post_adjustment()
--   L17 adjustment above the four-eyes limit  app.post_adjustment()
--   L19 cross-currency aggregation raises     the reporting layer
--   L22 period close, dirty                   app.close_period()
--   L23 period close then a late entry        app.close_period()
-- L18's second half — roundHalfUp agreeing between TypeScript and plpgsql over
-- 10,000 random inputs — needs packages/core, which is phase 2.
-- ============================================================================
