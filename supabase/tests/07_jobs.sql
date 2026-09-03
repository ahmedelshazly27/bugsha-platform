-- Phase 9 (§jobs): happy path, idempotency, failure per job.
begin; select plan(9);
insert into market_holiday (market, holiday_date, name_en, name_ar) values ('KW', current_date + 3, 'Test Holiday', 'عطلة');
select app.materialise_schedules();
select is((select count(*)::int from listing where schedule_id is not null and local_date = current_date + 3 and market='KW' and created_at > now() - interval '1 minute'), 0, 'J-5: a holiday suppresses materialisation');
select is((select count(*)::int from (select schedule_id, local_date from listing where schedule_id is not null group by 1,2 having count(*) > 1) d), 0, 'J-6: never two listings per (schedule, date)');
select is((select count(*)::int from jsonb_array_elements((app.dst_integrity_check())->'problems') p where (select market from store where store_id = (p->>'store_id')::uuid) = 'KW'), 0, 'J-7: DST check no-ops for Kuwait');
select throws_ok($$ select app.resolve_local_window('Africa/Cairo', '2027-04-30', time '00:30', time '01:30') $$, 'BG160', null, 'J-8: a listing in the DST gap is refused, not shifted');
select lives_ok($$ select app.check_document_expiry() $$, 'J-9: document expiry runs');
select isnt_empty($$ select 1 from "order" where store_id='eeeeeeee-0000-4000-8000-000000000003' and status in ('reserved','redeemed') $$, 'J-10: and cancels nothing');
select ok((select (app.balance_verification()->>'balanced')::boolean), 'J-11: balance verification is green');
select is((select (app.reconcile_payments('myfatoorah','KW', current_date, '[{"provider_ref":"FIXTURE-R3D-9F","gross_minor":"1500","fee_minor":"38","settled_at":"2026-09-03T10:00:00Z"},{"provider_ref":null,"gross_minor":"x"}]'))->>'written')::int, 0, 'J-13: a malformed settlement file writes nothing');
select is((select count(*)::int from cron.job where jobname like 'bugsha_%'), 10, 'J-15: ten jobs are scheduled in pg_cron');
select * from finish(); rollback;
