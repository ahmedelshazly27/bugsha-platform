-- ============================================================================
-- Phases 2–4 — identity, templates and listings, the reservation hold.
-- Requires 00_helpers.sql. Every assertion runs as a real fixture user.
-- ============================================================================
begin;
select plan(30);

-- ─── Phase 2: a consumer signs in by phone, in BOTH markets ────────────────
insert into auth.users (instance_id, id, aud, role, phone, phone_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000','cccccccc-0000-4000-8000-0000000000f1',
        'authenticated','authenticated','+96555555555', now(), now(), now()),
       ('00000000-0000-0000-0000-000000000000','cccccccc-0000-4000-8000-0000000000f2',
        'authenticated','authenticated','+201555555555', now(), now(), now())
on conflict (id) do nothing;

select tests.authenticate_as('cccccccc-0000-4000-8000-0000000000f1');
select lives_ok($$ select app.complete_profile('Noura','KW','11111111-0000-4000-8000-000000000002') $$,
  'P2-1: a Kuwaiti consumer completes a profile with only a first name');
select is((select market::text from consumer_profile where user_id='cccccccc-0000-4000-8000-0000000000f1'),
  'KW', 'P2-2: and lands in the Kuwait market');
select is((select phone from consumer_profile where user_id='cccccccc-0000-4000-8000-0000000000f1'),
  '+96555555555', 'P2-3: the phone comes from the verified JWT, never the caller');
select is((select locale::text from app_user where id='cccccccc-0000-4000-8000-0000000000f1'),
  'ar-KW', 'P2-4: locale defaults to the market default, Gulf Arabic');
select throws_ok($$ select app.complete_profile('','KW','11111111-0000-4000-8000-000000000002') $$,
  'BG102', null, 'P2-5: a blank first name is refused');
select throws_ok($$ select app.complete_profile('Noura','EG','11111111-0000-4000-8000-000000000007') $$,
  'BG102', null, 'P2-6: a +965 number cannot claim an Egyptian profile');
select throws_ok($$ select app.complete_profile('Noura','KW','11111111-0000-4000-8000-00000000000a') $$,
  'BG119', null, 'P2-7: a waitlist city is refused, not silently accepted');

select tests.authenticate_as('cccccccc-0000-4000-8000-0000000000f2');
select lives_ok($$ select app.complete_profile('Mariam','EG','11111111-0000-4000-8000-000000000007') $$,
  'P2-8: an Egyptian consumer signs in in the same launch');
select is((select locale::text from app_user where id='cccccccc-0000-4000-8000-0000000000f2'),
  'ar-EG', 'P2-9: and gets the Egyptian register, not the Gulf one');
select throws_ok($$ select app.set_market('KW','11111111-0000-4000-8000-000000000002', false) $$,
  'BG103', null, 'P2-10: switching market without confirmation is refused');
select lives_ok($$ select app.set_market('KW','11111111-0000-4000-8000-000000000002', true) $$,
  'P2-11: and succeeds once the client has shown what changes');
select throws_ok($$ select app.set_dietary(array['nuts'], false) $$,
  'BG104', null, 'P2-12: an allergy flag without acknowledgement is refused');
select lives_ok($$ select app.set_dietary(array['nuts'], true) $$,
  'P2-13: and is accepted with it');
select isnt_empty($$ select id from app.cities_for('KW') where stage = 'live' $$,
  'P2-14: live cities are listed for selection');

-- ─── Phase 3: templates and the one-call publish ───────────────────────────
select tests.authenticate_as(tests.uid('staff', 3));   -- manager at Salmiya
select lives_ok($$ select app.upsert_bag_template('eeeeeeee-0000-4000-8000-000000000001'::uuid,
  'Late Pastry Box','صندوق المعجنات','bakery', 4000, 8000, 2000, 6,
  time '21:00', time '22:00', 'What the counter still has at close.') $$,
  'P3-1: a manager creates a template');
select throws_ok($$ select app.upsert_bag_template('eeeeeeee-0000-4000-8000-000000000001'::uuid,
  'Wine Box','نبيذ','alcohol', 4000, 8000, 2000, 6, time '21:00', time '22:00', 'x') $$,
  'BG105', null, 'P3-2: alcohol is rejected outright, in both markets');
select throws_ok($$ select app.upsert_bag_template('eeeeeeee-0000-4000-8000-000000000001'::uuid,
  'Overpriced','غالي','bakery', 4000, 8000, 2100, 6, time '21:00', time '22:00', 'x') $$,
  'BG108', null, 'P3-3: a price above half the stated minimum value is rejected');
select throws_ok($$ select app.upsert_bag_template('eeeeeeee-0000-4000-8000-000000000001'::uuid,
  'No words','بدون','bakery', 4000, 8000, 2000, 6, time '21:00', time '22:00', null, null) $$,
  'BG109', null, 'P3-4: a template with no description in any language is rejected');

select lives_ok($$ select app.publish_listing(
    (select id from bag_template where store_id='eeeeeeee-0000-4000-8000-000000000001'
       and title_en='Late Pastry Box' limit 1),
    6, (current_date + 5), time '21:00', time '22:00', gen_random_uuid()::text) $$,
  'P3-5: publishing from a template is ONE call — the 15-second path');
select is((select quantity_remaining from listing
    where title_snapshot='Late Pastry Box' and local_date=current_date + 5),
  6, 'P3-6: the listing goes live with its full stock');
select isnt_empty($$ select 1 from compliance_entry where event_type='listing_published' $$,
  'P3-7: publishing writes a compliance ledger entry');

-- The snapshot is a COPY: a later template edit must not rewrite history.
select app.upsert_bag_template('eeeeeeee-0000-4000-8000-000000000001'::uuid,
  'Renamed After Publish','اسم جديد','bakery', 4000, 8000, 1900, 6,
  time '21:00', time '22:00', 'Edited later.', null, '{}',
  (select id from bag_template where title_en='Late Pastry Box' limit 1));
select is((select title_snapshot from listing
    where local_date=current_date + 5 and title_snapshot='Late Pastry Box'),
  'Late Pastry Box', 'P3-8: the listing snapshot survives a later template rename');

select tests.authenticate_as(tests.uid('staff', 8));   -- staff at the blocked branch
select throws_ok($$ select app.publish_listing(
    (select id from bag_template where store_id='eeeeeeee-0000-4000-8000-000000000003' limit 1),
    4, (current_date + 5), time '21:00', time '22:00', gen_random_uuid()::text) $$,
  'BG117', null, 'P3-9: §13-8 a lapsed food permit blocks new listings');
select isnt_empty($$ select order_id from "order" where store_id='eeeeeeee-0000-4000-8000-000000000003' $$,
  'P3-10: while its existing orders stand untouched');

select tests.authenticate_as(tests.uid('staff', 3));
select throws_ok($$ select app.update_listing(
    (select listing_id from listing where store_id='eeeeeeee-0000-4000-8000-000000000001'
       and quantity_remaining < quantity_total limit 1), 0) $$,
  'BG114', null, 'P3-11: §13-4 quantity cannot drop below the sold count');
select throws_ok($$ select app.update_listing(
    (select listing_id from listing where store_id='eeeeeeee-0000-4000-8000-000000000001'
       and quantity_remaining < quantity_total limit 1), null, 999) $$,
  'BG115', null, 'P3-12: price is frozen after the first sale');

-- ─── Phase 4: the ten-minute hold ──────────────────────────────────────────
create temporary table p4 as
  select listing_id from listing
   where market='KW' and status='active' and quantity_remaining >= 5
     and reservation_cutoff_utc > now()
     and store_id='eeeeeeee-0000-4000-8000-000000000001' limit 1;
create temporary table p4o (order_id uuid);

select tests.authenticate_as(tests.uid('consumer', 16));   -- KW, no order history
select lives_ok($$ insert into p4o
  select (app.hold_listing((select listing_id from p4), 1, gen_random_uuid()::text)).order_id $$,
  'P4-1: a consumer holds a bag');
select is((select o.status::text from "order" o join p4o p on p.order_id=o.order_id),
  'held', 'P4-2: the order is HELD, not reserved — nothing was paid');
select is((select o.payment_status::text from "order" o join p4o p on p.order_id=o.order_id),
  'none', 'P4-3: and carries no payment');
select ok((select o.hold_expires_at between now() + interval '9 minutes' and now() + interval '11 minutes'
    from "order" o join p4o p on p.order_id=o.order_id),
  'P4-4: the hold lasts the market''s ten minutes');
select matches((select o.code from "order" o join p4o p on p.order_id=o.order_id),
  '^[234679ACDEFGHJKMNPQRTUVWXYZ]{3}-[234679ACDEFGHJKMNPQRTUVWXYZ]{2}$',
  'P4-5: the code uses the unambiguous alphabet — no 0/O, 1/I/L, 5/S, 8/B');
select is((select o.commission_minor from "order" o join p4o p on p.order_id=o.order_id),
  (select app.commission_of(o.subtotal_minor, o.commission_bp)
     from "order" o join p4o p on p.order_id=o.order_id),
  'P4-6: commission is stamped, and equals round-half-up of the subtotal');
select throws_ok($$ select app.hold_listing((select listing_id from p4), 99, gen_random_uuid()::text) $$,
  'BG113', null, 'P4-7: the per-person cap is enforced and names the limit');

select tests.authenticate_as(tests.uid('consumer', 3));   -- restricted: 3 no-shows
select throws_ok($$ select app.hold_listing((select listing_id from p4), 1, gen_random_uuid()::text) $$,
  'BG112', null, 'P4-8: a restricted account cannot reserve');

select tests.clear_auth();
select lives_ok($$ select app.release_expired_holds(); select app.release_expired_holds() $$,
  'P4-9: release_expired_holds is idempotent and safe to run twice');

select * from finish();
rollback;
