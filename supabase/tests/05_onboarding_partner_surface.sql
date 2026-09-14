-- Phase 3 completion: onboarding -> documents -> contract -> store -> hours -> pause; schedules; cancellation; reads.
begin; select plan(12); delete from tests.p3;
insert into auth.users (instance_id, id, aud, role, phone, phone_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-4000-8000-0000000000f9','authenticated','authenticated','+96599999999', now(), now(), now()) on conflict (id) do nothing;
insert into app_user (id, primary_market, locale) values ('bbbbbbbb-0000-4000-8000-0000000000f9','KW','ar-KW') on conflict do nothing;
-- A partner account opens only with a code ops issued (20260914094502). Two fixture codes: one to redeem, one for the alcohol check.
insert into partner_invite_code (code, market, issued_to_name, issued_to_email, legal_name, trading_name, issued_by, expires_at) values
  ('BG-TEST-2345', 'KW', 'New Bakery', 'sara@new.fixture', 'New Bakery Co.', 'New Bakery', tests.uid('ops', 6), now() + interval '14 days'),
  ('BG-TEST-2346', 'KW', 'X', 'x@x.fixture', 'X', 'X', tests.uid('ops', 6), now() + interval '14 days');
select tests.authenticate_as('bbbbbbbb-0000-4000-8000-0000000000f9');
insert into tests.p3 select 'partner', (app.submit_application('BG-TEST-2345','KW','New Bakery Co.','New Bakery','{bakery}','Sara','+96599999999','sara@new.fixture','11111111-0000-4000-8000-000000000001', 1)).partner_id;
select is((select onboarding_status::text from partner where partner_id=(select v from tests.p3 where k='partner')), 'applied', 'O-1: an application creates a partner in applied');
select isnt_empty($$ select 1 from staff_assignment where user_id='bbbbbbbb-0000-4000-8000-0000000000f9' and role='owner' and partner_wide $$, 'O-2: the applicant becomes its owner');
select throws_ok($$ select app.submit_application('BG-TEST-2346','KW','X','X','{alcohol}','S','+96599999998','x@x','11111111-0000-4000-8000-000000000001') $$, 'BG105', null, 'O-3: alcohol is refused at application');
select lives_ok($$ select app.upload_document((select v from tests.p3 where k='partner'),'moci_licence','fixtures/x.pdf', null, current_date + 365) $$, 'O-4: the owner uploads a document');
select is((select onboarding_status::text from partner where partner_id=(select v from tests.p3 where k='partner')), 'under_review', 'O-5: which moves the partner to under_review');
select throws_ok($$ select app.upload_document((select v from tests.p3 where k='partner'),'health_licence','fixtures/x.pdf') $$, 'BG102', null, 'O-6: an Egyptian document type is refused for a Kuwaiti partner');
select tests.clear_auth();
insert into tests.p3 select 'contract', gen_random_uuid();
insert into partner_contract (id, partner_id, version, commission_bp, payout_cadence, payout_min_minor, effective_from) values ((select v from tests.p3 where k='contract'), (select v from tests.p3 where k='partner'), 1, 2200, 'weekly', 5000, current_date);
select tests.authenticate_as('bbbbbbbb-0000-4000-8000-0000000000f9');
select lives_ok($$ select app.accept_contract((select v from tests.p3 where k='contract'), '10.0.0.1'::inet, 'BugshaPartner/1.0', 'sha256:abc') $$, 'O-7: the owner accepts the contract');
select throws_ok($$ select app.upsert_store((select v from tests.p3 where k='partner'),'X','11111111-0000-4000-8000-000000000001','{"governorate":"Al Asimah","district":"Sharq","street":"x","building":"1"}', 29.37, 47.98, 'Counter','الكاونتر','+96522000099') $$, 'BG102', null, 'O-9: an Egyptian-shaped address is refused for a Kuwaiti store');
insert into tests.p3 select 'store', (app.upsert_store((select v from tests.p3 where k='partner'),'New Bakery — Sharq','11111111-0000-4000-8000-000000000001','{"governorate":"Al Asimah","area":"Sharq","block":"3","street":"x","building":"1"}', 29.37, 47.98, 'Counter','الكاونتر','+96522000099')).store_id;
select throws_ok($$ select app.upsert_store((select v from tests.p3 where k='partner'),'Y','11111111-0000-4000-8000-000000000001','{"governorate":"Al Asimah","area":"Sharq","block":"3","street":"x","building":"1"}', 29.37, 47.98, 'Counter','', '+96522000099') $$, 'BG102', null, 'O-11: a pickup point is required in BOTH languages');
select is((select count(*)::int from app.set_hours((select v from tests.p3 where k='store'), '[{"weekday":0,"opens":"08:00","closes":"14:00"},{"weekday":0,"opens":"17:00","closes":"23:00","shift_index":1}]')), 2, 'O-12: split shifts are supported');
select ok((select (app.pause_store((select v from tests.p3 where k='store'),'store_paused', now() + interval '2 hours'))->>'message_key' = 'store.paused_existing_orders_honoured'), 'O-13: pausing says existing orders are honoured');
select tests.authenticate_as(tests.uid('staff', 3));
select is((select (app.cancel_listing((select listing_id from listing where store_id='eeeeeeee-0000-4000-8000-000000000001' and status='active' and local_date = current_date + 6 limit 1), 'quality_concern', 'chiller ran warm'))->>'quality_flag_raised')::boolean, true, 'O-15: cancelling for quality_concern raises a quality flag');
select * from finish(); rollback;
