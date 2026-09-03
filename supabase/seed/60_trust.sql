-- ============================================================================
-- Fixtures 60 — reviews, quality flags, disputes, incidents, quality holds
-- One dispute per severity, including an illness case that bypasses the partner
-- and carries a quality hold (02-data-model.md §9).
-- ============================================================================
set search_path = public, extensions;

-- Only a consumer who REDEEMED may rate (00-product.md rule 9).
insert into review (order_id, consumer_id, store_id, rating, tags, body)
select o.order_id, o.consumer_id, o.store_id,
       case when o.code = 'M3J-7Q' then 3 else 5 end,
       case when o.code = 'M3J-7Q' then '{quantity}'::text[] else '{value,friendly}'::text[] end,
       case when o.code = 'M3J-7Q'
            then 'Fewer items than I expected, but the staff were kind about it.'
            else 'Great value and the pickup was quick.' end
from "order" o
where o.status = 'redeemed';

insert into review_response (review_id, body, moderation_status, responded_by)
select r.id, 'Thank you — we have adjusted the bag size for evening pickups.',
       'approved', 'bbbbbbbb-0000-4000-8000-000000000003'
from review r where r.rating = 3;

-- A partner pulling stock they are unsure about. This is the low-friction path
-- that exists so they do not sell it anyway (02-data-model.md §5).
insert into quality_flag (order_id, store_id, partner_id, source, category, body, severity)
values (null,'eeeeeeee-0000-4000-8000-000000000002','dddddddd-0000-4000-8000-000000000001',
        'partner','chiller_temperature',
        'Chiller ran warm overnight; pulled the evening bags rather than risk it.','high');

insert into quality_flag (order_id, store_id, partner_id, source, category, body, severity)
select o.order_id, o.store_id, o.partner_id, 'consumer','packaging',
       'Lid was not sealed properly.','standard'
from "order" o where o.code = 'G2M-6W';

-- ─── Disputes: one per severity ─────────────────────────────────────────────
-- critical goes straight to Compliance; the partner is INFORMED, never asked to
-- triage it (02-data-model.md §9).
insert into dispute (case_ref, order_id, consumer_id, market, category, severity,
                     consumer_statement, illness_detail, owner_ops_user, sla_due_at)
select 'BG-DSP-0001', o.order_id, o.consumer_id, o.market,
       'suspected_foodborne_illness','critical',
       'Felt unwell a few hours after eating. Reporting so you can check the batch.',
       jsonb_build_object('items','["pastry","sandwich"]'::jsonb,
                          'eaten_at', to_char(o.window_start_utc + interval '1 hour','YYYY-MM-DD"T"HH24:MI:SSOF'),
                          'onset_at', to_char(o.window_start_utc + interval '6 hours','YYYY-MM-DD"T"HH24:MI:SSOF'),
                          'symptoms','["nausea","cramps"]'::jsonb),
       'aaaaaaaa-0000-4000-8000-00000000000a', now() + interval '4 hours'
from "order" o where o.code = 'G2M-6W';

insert into dispute (case_ref, order_id, consumer_id, market, category, severity,
                     consumer_statement, owner_ops_user, sla_due_at)
select 'BG-DSP-0002', o.order_id, o.consumer_id, o.market,
       'never_received','high',
       'Store was shut when I arrived inside the window.',
       'aaaaaaaa-0000-4000-8000-000000000002', now() + interval '8 hours'
from "order" o where o.code = 'H4N-2K';

insert into dispute (case_ref, order_id, consumer_id, market, category, severity,
                     consumer_statement, partner_statement, partner_deadline,
                     owner_ops_user, sla_due_at)
select 'BG-DSP-0003', o.order_id, o.consumer_id, o.market,
       'cash_order_disputed','standard',
       'Marked as collected but I never picked it up.',
       null, now() + interval '2 days',
       'aaaaaaaa-0000-4000-8000-000000000001', now() + interval '3 days'
from "order" o where o.code = 'X9H-4K';

-- ─── Incidents ──────────────────────────────────────────────────────────────
-- Open incident for the illness case, and one already closed so the
-- immutability trigger (BG004) has something real to refuse.
insert into incident (id, ref, market, partner_id, store_id, categories, order_refs,
                      consumer_reports, platform_action)
values ('11c1de07-0000-4000-8000-000000000001','BG-INC-0001','EG',
        'dddddddd-0000-4000-8000-000000000003','eeeeeeee-0000-4000-8000-000000000005',
        '{suspected_foodborne_illness}','{G2M-6W}',
        '[{"case_ref":"BG-DSP-0001","severity":"critical"}]'::jsonb,
        '{"quality_hold":true,"partner_informed":true,"listings_cancelled":true}'::jsonb);

insert into incident (id, ref, market, partner_id, store_id, categories, order_refs,
                      resolution, closed_at, signed_off_by)
values ('11c1de07-0000-4000-8000-000000000002','BG-INC-0002','KW',
        'dddddddd-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000002',
        '{packaging}','{}',
        'Packaging supplier changed; no further reports in 30 days.',
        now() - interval '20 days', 'aaaaaaaa-0000-4000-8000-000000000004');

-- Quality hold on the store named in the critical dispute.
insert into quality_hold (store_id, incident_id, reason_text, expected_duration,
                          cancel_existing, placed_by)
values ('eeeeeeee-0000-4000-8000-000000000005','11c1de07-0000-4000-8000-000000000001',
        'Suspected foodborne illness reported; holding all listings pending NFSA guidance.',
        '48 hours', true, 'aaaaaaaa-0000-4000-8000-00000000000a');

-- ─── Compliance ledger ──────────────────────────────────────────────────────
-- Both client and server timestamps are recorded for every redemption
-- (01-architecture.md §4).
insert into compliance_entry (store_id, partner_id, event_type, listing_id, order_id,
                              category, quantity, declared_value_minor, currency,
                              listed_at, window_start_utc, window_end_utc,
                              redeemed_client_ts, redeemed_server_ts, staff_user_id)
select o.store_id, o.partner_id, 'redeemed', o.listing_id, o.order_id,
       'bakery', o.quantity, o.total_minor, o.currency,
       o.created_at, o.window_start_utc, o.window_end_utc,
       r.client_ts, r.server_ts, r.staff_user_id
from "order" o join redemption r on r.order_id = o.order_id;

insert into compliance_entry (store_id, partner_id, event_type, listing_id, order_id,
                              category, quantity, declared_value_minor, currency,
                              window_start_utc, window_end_utc, disposition)
select o.store_id, o.partner_id, 'no_show', o.listing_id, o.order_id,
       'bakery', o.quantity, o.total_minor, o.currency,
       o.window_start_utc, o.window_end_utc, d.disposition
from "order" o join no_show_disposition d on d.order_id = o.order_id;
