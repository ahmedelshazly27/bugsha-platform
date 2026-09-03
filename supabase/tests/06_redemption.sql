-- Phase 8: §13 cases 2, 3, 5, 6, 15; undo; cash; no-show.
begin; select plan(12); delete from tests.p8j; delete from tests.p8; insert into tests.p8 values ('o1', gen_random_uuid()), ('o2', gen_random_uuid());
insert into tests.p8j select 'base', to_jsonb(coalesce((select no_show_count_90d from consumer_profile where user_id=tests.uid('consumer',9)), 0));
insert into "order" (order_id, code, consumer_id, listing_id, store_id, partner_id, market, quantity, unit_price_minor, subtotal_minor, total_minor, currency, commission_bp, commission_minor, contract_version_id, title_snapshot, window_start_utc, window_end_utc, method, payment_status, status)
select (select v from tests.p8 where k='o1'), 'X7K-2W', tests.uid('consumer',9), listing_id, store_id, partner_id, 'KW', 1, 1500, 1500, 1500, 'KWD', 1800, 270, 'd0c00000-0000-4000-8000-000000000002', 'Evening Bakery Bag', now() - interval '10 minutes', now() + interval '50 minutes', 'knet', 'captured', 'reserved'
from listing where store_id='eeeeeeee-0000-4000-8000-000000000001' and status='active' limit 1;
insert into "order" (order_id, code, consumer_id, listing_id, store_id, partner_id, market, quantity, unit_price_minor, subtotal_minor, total_minor, currency, commission_bp, commission_minor, contract_version_id, title_snapshot, window_start_utc, window_end_utc, method, payment_status, status)
select (select v from tests.p8 where k='o2'), 'M9K-3P', tests.uid('consumer',9), listing_id, store_id, partner_id, 'KW', 1, 1500, 1500, 1500, 'KWD', 1800, 270, 'd0c00000-0000-4000-8000-000000000002', 'Evening Bakery Bag', now() - interval '70 minutes', now() - interval '10 minutes', 'knet', 'captured', 'reserved'
from listing where store_id='eeeeeeee-0000-4000-8000-000000000001' and status='active' limit 1;

select tests.authenticate_as(tests.uid('staff', 1));
insert into tests.p8j select 'r1', app.redeem_order((select v from tests.p8 where k='o1'), 'code_shown', gen_random_uuid()::text);
select is((select (v->>'already_redeemed')::boolean from tests.p8j where k='r1'), false, 'R-1: an open-window order redeems');
select tests.authenticate_as(tests.uid('staff', 3));
insert into tests.p8j select 'r2', app.redeem_order((select v from tests.p8 where k='o1'), 'qr_scanned', gen_random_uuid()::text);
select is((select (v->>'already_redeemed')::boolean from tests.p8j where k='r2'), true, '§13-5: the second device gets SUCCESS, not an error');
select is((select v->'redeemed_by'->>'user_id' from tests.p8j where k='r2'), tests.uid('staff',1)::text, '§13-5: naming who took it');
select throws_ok($$ select app.undo_redemption((select v from tests.p8 where k='o1')) $$, 'BG100', null, 'R-4: a different staff member cannot undo');
select tests.authenticate_as(tests.uid('staff', 1));
select lives_ok($$ select app.undo_redemption((select v from tests.p8 where k='o1')) $$, 'R-5: the same staff member undoes within 120 s');
select tests.authenticate_as(tests.uid('staff', 3));
select app.mark_no_show((select v from tests.p8 where k='o2'), 'kept');
select tests.clear_auth();
select is((select no_show_count_90d from consumer_profile where user_id=tests.uid('consumer',9)), (select (v#>>'{}')::int + 1 from tests.p8j where k='base'), 'R-7: a no-show counts against the consumer');
select is((select count(*)::int from financial_entry where order_id=(select v from tests.p8 where k='o2') and reference_type not in ('order','settlement')), 0, 'L5: zero ledger entries for a no-show');
select tests.authenticate_as(tests.uid('staff', 3));
insert into tests.p8j select 'late', app.redeem_order_late((select v from tests.p8 where k='o2'), 'code_shown', gen_random_uuid()::text);
select is((select (v->>'late_grace')::boolean from tests.p8j where k='late'), true, '§13-3: late redemption inside the grace is flagged');
select tests.clear_auth();
select is((select no_show_count_90d from consumer_profile where user_id=tests.uid('consumer',9)), (select (v#>>'{}')::int from tests.p8j where k='base'), '§13-3: and reverses the no-show');
update staff_assignment set revoked_at = now() where user_id = tests.uid('staff',1) and store_id='eeeeeeee-0000-4000-8000-000000000001';
select is((select staff_user_id from redemption where order_id=(select v from tests.p8 where k='o1') order by created_at desc limit 1), tests.uid('staff',1), '§13-15: revocation never rewrites who redeemed');
select throws_ok($$ update incident set resolution = 'edited' where ref = 'BG-INC-0002' $$, 'BG004', null, '§13-2 analogue: a closed record refuses direct edits');
select is_empty($$ select currency from financial_entry group by currency having sum(case when entry_type='debit' then amount_minor else -amount_minor end) <> 0 $$, 'L24: balanced');
select * from finish(); rollback;
