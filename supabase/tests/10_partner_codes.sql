-- Code-gated partner sign-up (20260914094502 … 20260914110851): a kitchen asks for a code, ops issues
-- it (single use, 14 days), the code opens app.submit_application, and nothing else does.
begin; select plan(22);
create temporary table t (k text primary key, v text); grant all on t to anon, authenticated;  -- written while impersonating users

-- a request lands from the website / partner app (service role writes it; here as the test owner)
with r as (insert into partner_request (market, legal_name, trading_name, categories, contact_name, contact_phone, contact_email, city, source)
  values ('KW', 'Code Test Co. W.L.L.', 'Code Test Bakehouse', '{bakery}', 'Noor', '+96551234567', 'code-test@fixture.bugsha.test', 'Hawalli', 'test') returning id)
insert into t select 'req', id::text from r;

-- only ops managers and admins issue codes
select tests.authenticate_as(tests.uid('ops', 1));
select throws_ok($$ select app.ops_issue_partner_code((select v from t where k='req')::uuid) $$, 'BG100', null, 'C-1: a support agent cannot issue a partner code');
select tests.authenticate_as(tests.uid('ops', 2));
insert into t select 'code', (app.ops_issue_partner_code((select v from t where k='req')::uuid, 14, 'reviewed')).code;
select matches((select v from t where k='code'), '^BG-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$', 'C-2: the code has the BG-XXXX-XXXX shape in the unambiguous alphabet');
select is((select status from app.ops_partner_requests() where id=(select v from t where k='req')::uuid), 'code_issued', 'C-3: the request moves to code_issued (read through the ops queue — the table itself is RLS-locked)');
select is((select invite_code from app.ops_partner_requests() where id=(select v from t where k='req')::uuid), (select v from t where k='code'), 'C-4: and carries the code');
select throws_ok($$ select app.ops_issue_partner_code((select v from t where k='req')::uuid) $$, 'BG125', null, 'C-5: a second code for the same request is refused');
select throws_ok($$ select app.ops_issue_partner_code(gen_random_uuid()) $$, 'BG124', null, 'C-6: an unknown request is refused');
select isnt_empty($$ select 1 from app.ops_partner_codes() where code = (select v from t where k='code') $$, 'C-7: the ops queue lists the code');

-- the partner app checks the code before sign-in
select tests.clear_auth(); select tests.authenticate_as_anon();
select is(app.check_partner_code(lower(replace((select v from t where k='code'), '-', '')))->>'status', 'ok', 'C-8: check_partner_code accepts the code typed without dashes or case');
select is(app.check_partner_code((select v from t where k='code'))->>'trading_name', 'Code Test Bakehouse', 'C-9: and returns the pre-fill');
select is(app.check_partner_code('BG-ZZZZ-ZZZZ')->>'status', 'invalid', 'C-10: an unknown code is invalid');
select throws_ok($$ select app.submit_application((select v from t where k='code'),'KW','Code Test Co. W.L.L.','Code Test Bakehouse','{bakery}','Noor','+96551234567','code-test@fixture.bugsha.test','11111111-0000-4000-8000-000000000001') $$, 'BG100', null, 'C-11: applying needs a session');

-- the applicant signs in and applies
select tests.clear_auth();
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-4000-8000-0000000000f8','authenticated','authenticated','code-test@fixture.bugsha.test', now(), now(), now()) on conflict (id) do nothing;
insert into app_user (id, primary_market, locale) values ('bbbbbbbb-0000-4000-8000-0000000000f8','KW','en') on conflict do nothing;
select tests.authenticate_as('bbbbbbbb-0000-4000-8000-0000000000f8');
select throws_ok($$ select app.submit_application('BG-ZZZZ-ZZZZ','KW','X','X','{bakery}','Noor','+96551234567','code-test@fixture.bugsha.test','11111111-0000-4000-8000-000000000001') $$, 'BG122', null, 'C-12: no live code, no partner account');
select throws_ok($$ select app.submit_application((select v from t where k='code'),'EG','X','X','{bakery}','Noor','+201012345678','code-test@fixture.bugsha.test','11111111-0000-4000-8000-000000000001') $$, 'BG123', null, 'C-13: a Kuwaiti code does not open an Egyptian account');
select is((select count(*)::int from app.my_partners()), 0, 'C-14: before applying the account belongs to no partner');
insert into t select 'partner', (app.submit_application((select v from t where k='code'),'KW','Code Test Co. W.L.L.','Code Test Bakehouse','{bakery}','Noor','+96551234567','code-test@fixture.bugsha.test','11111111-0000-4000-8000-000000000001')).partner_id::text;
select is((select onboarding_status::text from app.my_partners()), 'applied', 'C-15: the application creates the partner in applied');
select is((select partner_id::text || ':' || role::text || ':' || store_count from app.my_partners()), (select v from t where k='partner') || ':owner:0', 'C-16: my_partners() shows the applicant as owner of a partner with no branch yet');
select tests.clear_auth();
select is((select redeemed_by from partner_invite_code where code=(select v from t where k='code')), 'bbbbbbbb-0000-4000-8000-0000000000f8'::uuid, 'C-17: the code is redeemed by the applicant');
select tests.authenticate_as('bbbbbbbb-0000-4000-8000-0000000000f8');
select is(app.check_partner_code((select v from t where k='code'))->>'status', 'redeemed', 'C-18: and checks as redeemed');
select throws_ok($$ select app.submit_application((select v from t where k='code'),'KW','Again','Again','{bakery}','Noor','+96551234567','code-test@fixture.bugsha.test','11111111-0000-4000-8000-000000000001') $$, 'BG122', null, 'C-19: a code works once');

-- ops cannot undo a redemption from the code side; a live code can be withdrawn and the request re-issued
select tests.clear_auth(); select tests.authenticate_as(tests.uid('ops', 2));
select throws_ok($$ select app.ops_revoke_partner_code((select v from t where k='code'), 'test') $$, 'BG126', null, 'C-20: a redeemed code cannot be revoked — suspend the partner instead');
select tests.clear_auth();  -- partner_request is RLS-locked: only the service role (or the test owner) writes it
with r as (insert into partner_request (market, legal_name, trading_name, categories, contact_name, contact_phone, contact_email, source) values ('KW','Two Co.','Two','{cafe}','Sam','+96551234568','two@fixture.bugsha.test','test') returning id)
insert into t select 'req2', id::text from r;
select tests.authenticate_as(tests.uid('ops', 2));
insert into t select 'code2', (app.ops_issue_partner_code((select v from t where k='req2')::uuid)).code;
select lives_ok($$ select app.ops_revoke_partner_code((select v from t where k='code2'), 'issued to the wrong email') $$, 'C-21: a live code can be revoked');
select is((select status || ':' || (app.check_partner_code((select v from t where k='code2'))->>'status') from app.ops_partner_requests() where id=(select v from t where k='req2')::uuid), 'contacted:revoked', 'C-22: the request returns to contacted and the code checks as revoked');
select * from finish(); rollback;
