-- ============================================================================
-- §RLS — 15 tests, one per line of docs/04-rls.sql
-- docs/12-test-plan.md §RLS. Every line of that checklist is a test here.
-- Requires 00_helpers.sql to have run first (pg_prove runs files in order).
-- ============================================================================
begin;
select plan(38);

-- ─── 1. Staff at store A cannot read orders at store B, same partner ────────
select tests.authenticate_as(tests.uid('staff', 1));   -- staff at store 1

select isnt_empty(
  $$ select order_id from "order" where store_id = 'eeeeeeee-0000-4000-8000-000000000001' $$,
  '1a: staff at store A can read store A orders');

select is_empty(
  $$ select order_id from "order" where store_id = 'eeeeeeee-0000-4000-8000-000000000002' $$,
  '1b: staff at store A cannot read store B orders under the same partner');

-- ─── 2. Staff cannot read payout, statement or financial_entry at all ───────
select is_empty($$ select payout_id from payout $$,
  '2a: staff reads no payout row');
select is_empty($$ select id from statement $$,
  '2b: staff reads no statement row');
select is_empty($$ select id from financial_entry $$,
  '2c: staff reads no ledger row');

-- ─── 3. Manager cannot read payout; accountant can, and sees no orders ──────
select tests.authenticate_as(tests.uid('staff', 3));   -- manager at store 1
select is_empty($$ select payout_id from payout $$,
  '3a: a manager never sees payouts');
select isnt_empty($$ select order_id from "order" $$,
  '3b: a manager does see the orders board');

select tests.authenticate_as(tests.uid('staff', 4));   -- accountant, partner-wide
select isnt_empty($$ select payout_id from payout $$,
  '3c: an accountant does see payouts');
select is_empty($$ select order_id from "order" $$,
  '3d: an accountant sees no orders board');

-- ─── 4. Manager may invite staff, but not another manager (BG100) ───────────
select tests.authenticate_as(tests.uid('staff', 3));
-- The invitee must be an existing partner_user: staff_assignment has a foreign
-- key to it, so inviting an unknown uuid raises 23503, not BG100, and the test
-- would pass for the wrong reason. Staff 7 works at another store today.
select lives_ok(
  $$ select app.invite_staff('bbbbbbbb-0000-4000-8000-000000000007'::uuid,
       'dddddddd-0000-4000-8000-000000000001'::uuid,
       'eeeeeeee-0000-4000-8000-000000000001'::uuid, 'staff') $$,
  '4a: a manager may invite a staff member');
select throws_ok(
  $$ select app.invite_staff('bbbbbbbb-0000-4000-8000-000000000002'::uuid,
       'dddddddd-0000-4000-8000-000000000001'::uuid,
       'eeeeeeee-0000-4000-8000-000000000001'::uuid, 'manager') $$,
  'BG100',
  null,
  '4b: a manager may not invite another manager');

-- ─── 5. Consumer isolation ──────────────────────────────────────────────────
select tests.authenticate_as(tests.uid('consumer', 2));
select isnt_empty($$ select order_id from "order" $$,
  '5a: a consumer sees their own orders');
select is_empty(
  $$ select order_id from "order" where consumer_id <> tests.uid('consumer', 2) $$,
  '5b: a consumer sees no other consumer''s order');
select is_empty(
  $$ select p.payment_id from payment p join "order" o on o.order_id = p.order_id
     where o.consumer_id <> tests.uid('consumer', 2) $$,
  '5c: a consumer sees no other consumer''s payment');
select is_empty(
  $$ select id from wallet_transaction where consumer_id <> tests.uid('consumer', 2) $$,
  '5d: a consumer sees no other consumer''s wallet');
select is_empty(
  $$ select id from dispute where consumer_id is distinct from tests.uid('consumer', 2) $$,
  '5e: a consumer sees no other consumer''s dispute');

-- ─── 6. Anonymous browsing, and nothing else ────────────────────────────────
select tests.authenticate_as_anon();
select isnt_empty($$ select listing_id from v_browse_listing $$,
  '6a: anon can browse listings');
select is_empty($$ select user_id from consumer_profile $$,
  '6b: anon reads zero consumer_profile rows');

-- ─── 7. Market scoping: a KW ops_manager sees nothing Egyptian ──────────────
select tests.authenticate_as(tests.uid('ops', 2));   -- ops_manager, KW-scoped
select is_empty(
  $$ select user_id from consumer_profile where market = 'EG' $$,
  '7a: KW ops_manager sees no EG consumer_profile');
select is_empty(
  $$ select order_id from "order" where market = 'EG' $$,
  '7b: KW ops_manager sees no EG order');
select is_empty(
  $$ select id from dispute where market = 'EG' $$,
  '7c: KW ops_manager sees no EG dispute');
select isnt_empty(
  $$ select user_id from consumer_profile where market = 'KW' $$,
  '7d: KW ops_manager does see KW consumers');

-- ─── 8. support_agent cannot read the ledger ────────────────────────────────
select tests.authenticate_as(tests.uid('ops', 1));   -- support_agent, KW
select is_empty($$ select id from financial_entry $$,
  '8: a support agent reads no ledger row');

-- ─── 9. finance cannot mutate the catalogue or the partner record ───────────
select tests.authenticate_as(tests.uid('ops', 3));   -- finance, KW
select is_empty(
  $$ update partner set trading_name = trading_name || ' X' returning partner_id $$,
  '9a: finance cannot update partner');
select is_empty(
  $$ update listing set title_snapshot = title_snapshot || ' X' returning listing_id $$,
  '9b: finance cannot update listing');

-- ─── 10. engineering cannot approve a payout run ────────────────────────────
select tests.authenticate_as(tests.uid('ops', 5));   -- engineering, KW
select is_empty(
  $$ update payout_run set approved_by_1 = tests.uid('ops', 5) returning id $$,
  '10: engineering cannot approve a payout run');

-- ─── 11. Append-only tables reject UPDATE and DELETE for every role ─────────
select tests.clear_auth();
select ok(not has_table_privilege('authenticated', 'financial_entry', 'UPDATE'),
  '11a: authenticated has no UPDATE on financial_entry');
select ok(not has_table_privilege('authenticated', 'financial_entry', 'DELETE'),
  '11b: authenticated has no DELETE on financial_entry');
select ok(not has_table_privilege('authenticated', 'compliance_entry', 'UPDATE'),
  '11c: authenticated has no UPDATE on compliance_entry');
select ok(not has_table_privilege('authenticated', 'audit_log', 'UPDATE'),
  '11d: authenticated has no UPDATE on audit_log');
-- and the trigger refuses even the owner
select throws_ok(
  $$ update financial_entry set amount_minor = amount_minor + 1 $$,
  'BG001', null,
  '11e: the ledger trigger refuses an in-place edit; corrections are reversing entries');

-- ─── 12. No direct INSERT into the ledger — only app.post_* ─────────────────
select tests.authenticate_as(tests.uid('ops', 6));   -- admin, the widest role
select throws_ok(
  $$ insert into financial_entry (transaction_id, entry_type, account, amount_minor,
       currency, market, reference_type, reference_id, effective_at, created_by)
     values (gen_random_uuid(), 'debit', 'platform_bank', 100, 'KWD', 'KW',
             'adjustment', gen_random_uuid(), now(), 'test') $$,
  '42501', null,
  '12: not even an admin may INSERT a ledger entry directly');

-- ─── 13. An entry inside a locked period is refused (BG003) ────────────────
select tests.clear_auth();
select throws_ok(
  $$ select app.post_entries(gen_random_uuid(), jsonb_build_array(
       jsonb_build_object('entry_type','debit','account','platform_bank',
         'amount_minor',100,'currency','KWD','market','KW',
         'reference_type','adjustment','reference_id',gen_random_uuid(),
         'effective_at',(select (period_start + 1)::timestamptz from accounting_period
                          where market = 'KW' and locked_at is not null limit 1)),
       jsonb_build_object('entry_type','credit','account','commission_revenue',
         'amount_minor',100,'currency','KWD','market','KW',
         'reference_type','adjustment','reference_id',gen_random_uuid(),
         'effective_at',(select (period_start + 1)::timestamptz from accounting_period
                          where market = 'KW' and locked_at is not null limit 1)))) $$,
  'BG003', null,
  '13: an entry dated inside a locked period is rejected');

-- ─── 15. bi_reader sees masked PII and cannot reach the source table ────────
select matches(
  (select phone from bi.consumer_masked where user_id = tests.uid('consumer', 2)),
  '•',
  '15a: the BI view masks the phone number');
select matches(
  (select email from bi.consumer_masked where user_id = tests.uid('consumer', 2)),
  '•',
  '15b: the BI view masks the email address');
select ok(not has_table_privilege('bi_reader', 'public.consumer_profile', 'SELECT'),
  '15c: bi_reader cannot reach consumer_profile at all');

-- ─── 14. An unbalanced transaction is rejected at commit (BG002) ───────────
-- The post and the constraint check both happen inside throws_ok's implicit
-- subtransaction, so the half-written transaction is rolled back there and
-- never reaches COMMIT. A balanced control in the identical shape follows, so
-- this cannot pass for the wrong reason.
select throws_ok(
  $$ do $x$
     begin
       perform app.post_entries(gen_random_uuid(), jsonb_build_array(
         jsonb_build_object('entry_type','debit','account','platform_bank',
           'amount_minor',100,'currency','KWD','market','KW',
           'reference_type','adjustment','reference_id',gen_random_uuid(),'effective_at',now()),
         jsonb_build_object('entry_type','credit','account','commission_revenue',
           'amount_minor',90,'currency','KWD','market','KW',
           'reference_type','adjustment','reference_id',gen_random_uuid(),'effective_at',now())));
       set constraints all immediate;
     end $x$; $$,
  'BG002', null,
  '14a: an unbalanced transaction_id is rejected when the constraint is checked');

select lives_ok(
  $$ do $x$
     begin
       perform app.post_entries(gen_random_uuid(), jsonb_build_array(
         jsonb_build_object('entry_type','debit','account','platform_bank',
           'amount_minor',100,'currency','KWD','market','KW',
           'reference_type','adjustment','reference_id',gen_random_uuid(),'effective_at',now()),
         jsonb_build_object('entry_type','credit','account','commission_revenue',
           'amount_minor',100,'currency','KWD','market','KW',
           'reference_type','adjustment','reference_id',gen_random_uuid(),'effective_at',now())));
       set constraints all immediate;
     end $x$; $$,
  '14b: the same shape, balanced, is accepted');

select * from finish();
rollback;
