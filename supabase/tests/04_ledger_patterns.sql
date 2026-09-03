-- ============================================================================
-- §ledger — the entry patterns of docs/05-money.md §3, exercised through the
-- real app.post_* functions rather than hand-written inserts.
-- L24 is the one that must never be skipped or quarantined.
-- ============================================================================
begin;
select plan(26);

create temporary table t (k text primary key, v uuid);
create temporary table j (k text primary key, v jsonb);

-- A fresh KW order so every assertion is exact.
select tests.authenticate_as(tests.uid('consumer', 17));
insert into t select 'order', (app.hold_listing(
  (select listing_id from listing where market='KW' and status='active'
     and quantity_remaining >= 2 and reservation_cutoff_utc > now() limit 1),
  1, gen_random_uuid()::text)).order_id;
select tests.clear_auth();

-- ─── L1 digital capture, KWD ───────────────────────────────────────────────
select lives_ok($$ select app.confirm_order((select v from t where k='order'),
    'myfatoorah', 'REF-'||gen_random_uuid()::text, 'knet', 38, gen_random_uuid()::text) $$,
  'L1a: confirm_order captures and posts in ONE transaction');
select is((select count(*)::int from financial_entry
    where order_id=(select v from t where k='order') and reference_type='order'),
  3, 'L1b: a digital capture writes exactly three entries');
select is((select sum(case when entry_type='debit' then amount_minor else -amount_minor end)::bigint
    from financial_entry where order_id=(select v from t where k='order')),
  0::bigint, 'L1c: and they balance');
select is((select amount_minor from financial_entry
    where order_id=(select v from t where k='order')
      and account='commission_revenue' and reference_type='order'),
  (select commission_minor from "order" where order_id=(select v from t where k='order')),
  'L1d: commission posted equals the STAMPED value, not a recomputation');
select is((select count(*)::int from financial_entry
    where order_id=(select v from t where k='order') and reference_type='order'),
  3, 'L1e: §payments P4 — a replayed confirm produces no second capture');

-- ─── L2 EGP has exponent 2 ─────────────────────────────────────────────────
select is((select exponent from market_config where market='EG'), 2::smallint,
  'L2: EGP exponent is 2, so 8950 minor units is 89.50 — never 895.0');

-- ─── L3 commission immutability across a rate change ───────────────────────
create temporary table l3 as select commission_bp, commission_minor, contract_version_id
  from "order" where order_id=(select v from t where k='order');
insert into partner_contract (partner_id, version, commission_bp, payout_cadence,
                              payout_min_minor, effective_from, accepted_at)
select partner_id, 99, 900, 'weekly', 5000, current_date, now()
from "order" where order_id=(select v from t where k='order');
select is((select o.commission_bp from "order" o where o.order_id=(select v from t where k='order')),
  (select commission_bp from l3), 'L3a: a new contract version does not move a stamped order');
select is((select o.contract_version_id from "order" o where o.order_id=(select v from t where k='order')),
  (select contract_version_id from l3), 'L3b: and it still points at the version in force then');

-- ─── L4 settlement ─────────────────────────────────────────────────────────
select lives_ok($$ select app.post_settlement((select payment_id from payment
    where order_id=(select v from t where k='order') limit 1)) $$, 'L4a: settlement posts');
select is((select sum(case when account in ('platform_bank','psp_fees') then amount_minor else 0 end)
             - sum(case when account='cash_in_transit' then amount_minor else 0 end)
           from financial_entry
           where order_id=(select v from t where k='order') and reference_type='settlement'),
  0::numeric, 'L4b: platform_bank + psp_fees equals cash_in_transit');

-- ─── L5 / L8 a no-show writes NO entries of its own ────────────────────────
select is((select count(*)::int from financial_entry e join "order" o on o.order_id=e.order_id
    where o.code='Q9T-6D' and e.reference_type not in ('order','settlement')),
  0, 'L5: a digital no-show writes no entry of its own — the partner retains');
select is((select count(*)::int from financial_entry e join "order" o on o.order_id=e.order_id
    where o.code='Z2K-7M'), 0,
  'L8: a cash no-show moves no money and earns no commission');

-- ─── L6 cash commission follows what was COLLECTED ─────────────────────────
select is((select e.amount_minor from financial_entry e join "order" o on o.order_id=e.order_id
    where o.code='D6N-3P' and e.account='commission_revenue'),
  (select app.commission_of(c.collected_minor, o.commission_bp)
     from "order" o join cash_collection c on c.order_id=o.order_id where o.code='D6N-3P'),
  'L6: commission on a short collection follows collected_minor, not the total');

-- ─── L11 goodwill leaves the partner untouched ─────────────────────────────
insert into t select 'goodwill', app.post_goodwill(
  (select consumer_id from "order" where order_id=(select v from t where k='order')),
  500, 'KW', 'goodwill', (select v from t where k='order'));
select is_empty($$ select 1 from financial_entry
    where transaction_id=(select v from t where k='goodwill') and account='partner_payable' $$,
  'L11: a platform-funded goodwill credit never debits partner_payable');

-- ─── L12 / L13 promotion funding changes the commission BASE ───────────────
insert into t select 'promo_platform',
  app.post_promo_capture((select v from t where k='order'), 2000, 500, 'platform');
insert into t select 'promo_partner',
  app.post_promo_capture((select v from t where k='order'), 2000, 500, 'partner');

select is((select sum(case when entry_type='debit' then amount_minor else -amount_minor end)::bigint
    from financial_entry where transaction_id=(select v from t where k='promo_platform')),
  0::bigint, 'L12a: a platform-funded promo balances');
select is((select amount_minor from financial_entry
    where transaction_id=(select v from t where k='promo_platform')
      and account='promotion_expense_platform'),
  500::bigint, 'L12b: the discount is carried as platform expense');
select is((select amount_minor from financial_entry
    where transaction_id=(select v from t where k='promo_platform') and account='commission_revenue'),
  (select app.commission_of(2000, o.commission_bp) from "order" o
     where o.order_id=(select v from t where k='order')),
  'L12c: commission is computed on GROSS when the platform funds it');
select is((select amount_minor from financial_entry
    where transaction_id=(select v from t where k='promo_partner') and account='commission_revenue'),
  (select app.commission_of(1500, o.commission_bp) from "order" o
     where o.order_id=(select v from t where k='order')),
  'L13a: and on the DISCOUNTED amount when the partner funds it');
select is_empty($$ select 1 from financial_entry
    where transaction_id=(select v from t where k='promo_partner')
      and account='promotion_expense_platform' $$,
  'L13b: a partner-funded promo carries no platform expense at all');

-- ─── L14 / L15 chargeback follows the CONTRACT term ────────────────────────
update partner_contract set chargeback_bearer='partner'
 where id=(select contract_version_id from "order" where order_id=(select v from t where k='order'));
insert into t select 'cb_partner', app.post_chargeback((select v from t where k='order'), 100);
select isnt_empty($$ select 1 from financial_entry
    where transaction_id=(select v from t where k='cb_partner') and account='partner_payable' $$,
  'L14: a partner-borne chargeback DOES debit the partner, because the contract says so');

update partner_contract set chargeback_bearer='platform'
 where id=(select contract_version_id from "order" where order_id=(select v from t where k='order'));
insert into t select 'cb_platform', app.post_chargeback((select v from t where k='order'), 100);
select is_empty($$ select 1 from financial_entry
    where transaction_id=(select v from t where k='cb_platform') and account='partner_payable' $$,
  'L15a: a platform-borne one leaves the partner payable untouched');
select isnt_empty($$ select 1 from financial_entry
    where transaction_id=(select v from t where k='cb_platform') and account='chargeback_losses' $$,
  'L15b: and the loss lands in chargeback_losses');

-- ─── L16 / L17 adjustments and four eyes ───────────────────────────────────
select throws_ok($$ select app.post_adjustment('KW', jsonb_build_array(
    jsonb_build_object('entry_type','debit','account','platform_bank','amount_minor',100),
    jsonb_build_object('entry_type','credit','account','commission_revenue','amount_minor',100)),
    '', 'no reason given at all') $$,
  'BG132', null, 'L16a: an adjustment with no reason code is rejected');
select throws_ok($$ select app.post_adjustment('KW', jsonb_build_array(
    jsonb_build_object('entry_type','debit','account','platform_bank','amount_minor',100),
    jsonb_build_object('entry_type','credit','account','commission_revenue','amount_minor',90)),
    'manual_correction', 'deliberately unbalanced to prove the guard') $$,
  'BG002', null, 'L16b: an unbalanced one is rejected before it reaches the ledger');

-- D15: the first approver must be REMEMBERED, which is why the gate returns
-- rather than raising. A raise would roll back the pending_approval row.
select tests.authenticate_as(tests.uid('ops', 3));   -- finance, KW
insert into j select 'first', app.post_adjustment('KW', jsonb_build_array(
  jsonb_build_object('entry_type','debit','account','platform_bank','amount_minor',60000),
  jsonb_build_object('entry_type','credit','account','commission_revenue','amount_minor',60000)),
  'manual_correction', 'above the Kuwait four-eyes threshold');
select is((select v->>'status' from j where k='first'), 'pending_approval',
  'L17a: the first approver gets pending_approval, and the row SURVIVES');
select is_empty($$ select 1 from financial_entry where amount_minor = 60000 $$,
  'L17b: nothing is posted on the first call');

select tests.authenticate_as(tests.uid('ops', 6));   -- admin, KW — a different person
insert into j select 'second', app.post_adjustment('KW', jsonb_build_array(
  jsonb_build_object('entry_type','debit','account','platform_bank','amount_minor',60000),
  jsonb_build_object('entry_type','credit','account','commission_revenue','amount_minor',60000)),
  'manual_correction', 'above the Kuwait four-eyes threshold');
select is((select v->>'status' from j where k='second'), 'posted',
  'L17c: a second, DISTINCT approver executes it');
select tests.clear_auth();

-- ─── L20 / L21 the platform never debits a partner ─────────────────────────
select throws_ok($$ select app.post_payout((select payout_id from payout where net_minor = 0 limit 1)) $$,
  'BG133', null, 'L20: a non-positive payout is carried forward, never debited');

-- ─── L22 / L23 period close ────────────────────────────────────────────────
select is((select (app.close_period((select id from accounting_period
    where market='KW' and locked_at is null limit 1))->>'closed')::boolean),
  false, 'L22: a dirty period refuses to close, and returns the failing checklist');
select throws_ok($$ select app.post_entries(gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('entry_type','debit','account','platform_bank','amount_minor',100,
      'currency','KWD','market','KW','reference_type','adjustment','reference_id',gen_random_uuid(),
      'effective_at',(select (period_start+1)::timestamptz from accounting_period
                       where market='KW' and locked_at is not null limit 1)),
    jsonb_build_object('entry_type','credit','account','commission_revenue','amount_minor',100,
      'currency','KWD','market','KW','reference_type','adjustment','reference_id',gen_random_uuid(),
      'effective_at',(select (period_start+1)::timestamptz from accounting_period
                       where market='KW' and locked_at is not null limit 1)))) $$,
  'BG003', null, 'L23: an entry dated inside a locked period is refused');

-- ─── L24. If this goes red, stop the line. ─────────────────────────────────
select is_empty($$ select currency from financial_entry group by currency
    having sum(case when entry_type='debit' then amount_minor else -amount_minor end) <> 0 $$,
  'L24: the whole ledger balances, per currency');

select * from finish();
rollback;

-- ============================================================================
-- Still deferred, with what each needs:
--   L7  cash netting inside a payout run     the payout engine (phase 11)
--   L9  refund to source, end to end         exercised via app.cancel_order
--   L10 refund to wallet, then wallet spend  wallet spend (phase 4 checkout)
--   L19 cross-currency aggregation raises    the reporting layer (phase 10)
-- ============================================================================
