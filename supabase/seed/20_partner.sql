-- ============================================================================
-- Fixtures 20 — partners, contracts, stores, staff, documents
-- Two partners and four stores per market (12-test-plan.md §fixtures), one
-- store with an expired food licence and publishing blocked.
--   dddddddd… partner   d0c00000… contract   eeeeeeee… store
-- A partner trading in both markets is TWO partner rows. Never one. (§14)
-- ============================================================================
set search_path = public, extensions;

insert into partner (partner_id, market, legal_name, trading_name, categories,
                     onboarding_status, branch_count, contact_name, contact_role,
                     contact_phone, contact_email, city_id, activated_at) values
  ('dddddddd-0000-4000-8000-000000000001','KW',
   'Al Diwan Catering Co. W.L.L.','Al Diwan Bakery','{bakery,patisserie}','active',3,
   'Fatima Al Sabah','Owner','+96560000001','owner@aldiwan.fixture','11111111-0000-4000-8000-000000000002', now() - interval '180 days'),
  ('dddddddd-0000-4000-8000-000000000002','KW',
   'Salmiya Juice House Co.','Salmiya Juice House','{juice_bar}','active',1,
   'Yousef Al Rashid','Owner','+96560000006','owner@juicehouse.fixture','11111111-0000-4000-8000-000000000002', now() - interval '120 days'),
  ('dddddddd-0000-4000-8000-000000000003','EG',
   'Zamalek Foods S.A.E.','Zamalek Kitchen','{restaurant,bakery}','active',3,
   'Nour Abdel Rahman','Owner','+201100000009','owner@zamalek.fixture','11111111-0000-4000-8000-000000000007', now() - interval '150 days'),
  ('dddddddd-0000-4000-8000-000000000004','EG',
   'Alexandria Patisserie Co.','Alex Patisserie','{patisserie}','active',1,
   'Mariam Fouad','Owner','+201100000014','owner@alexpat.fixture','11111111-0000-4000-8000-000000000009', now() - interval '90 days');

-- Contracts are immutable and versioned. Al Diwan has TWO versions so ledger
-- test L3 can change the rate and prove a stamped order does not move.
insert into partner_contract (id, partner_id, version, commission_bp, payout_cadence,
                              payout_min_minor, effective_from, effective_to,
                              accepted_at, accepted_by) values
  ('d0c00000-0000-4000-8000-000000000001','dddddddd-0000-4000-8000-000000000001',1,2200,'weekly',5000,
   (now() - interval '180 days')::date, (now() - interval '7 days')::date, now() - interval '180 days','bbbbbbbb-0000-4000-8000-000000000005'),
  ('d0c00000-0000-4000-8000-000000000002','dddddddd-0000-4000-8000-000000000001',2,1800,'weekly',5000,
   (now() - interval '6 days')::date, null, now() - interval '6 days','bbbbbbbb-0000-4000-8000-000000000005'),
  ('d0c00000-0000-4000-8000-000000000003','dddddddd-0000-4000-8000-000000000002',1,2200,'weekly',5000,
   (now() - interval '120 days')::date, null, now() - interval '120 days','bbbbbbbb-0000-4000-8000-000000000006'),
  ('d0c00000-0000-4000-8000-000000000004','dddddddd-0000-4000-8000-000000000003',1,2200,'weekly',25000,
   (now() - interval '150 days')::date, null, now() - interval '150 days','bbbbbbbb-0000-4000-8000-00000000000d'),
  -- Egypt partner 2 settles cash commission by invoice, not netting, so the
  -- payout engine exercises both paths (05-money.md §3.3).
  ('d0c00000-0000-4000-8000-000000000005','dddddddd-0000-4000-8000-000000000004',1,2200,'weekly',25000,
   (now() - interval '90 days')::date, null, now() - interval '90 days','bbbbbbbb-0000-4000-8000-00000000000e');
update partner_contract set cash_settlement_mode = 'invoice'
  where id = 'd0c00000-0000-4000-8000-000000000005';

insert into store (store_id, partner_id, market, city_id, display_name, category_tags,
                   address, location, pickup_point_en, pickup_point_ar,
                   contact_phone, timezone) values
  ('eeeeeeee-0000-4000-8000-000000000001','dddddddd-0000-4000-8000-000000000001','KW','11111111-0000-4000-8000-000000000002',
   'Al Diwan — Salmiya','{bakery}',
   '{"governorate":"Hawalli","area":"Salmiya","block":"10","street":"Salem Al Mubarak","building":"12"}',
   st_setsrid(st_makepoint(48.0783,29.3339),4326)::geography,
   'Side counter, left of the main entrance','الكاونتر الجانبي على يسار المدخل الرئيسي','+96522000001','Asia/Kuwait'),
  ('eeeeeeee-0000-4000-8000-000000000002','dddddddd-0000-4000-8000-000000000001','KW','11111111-0000-4000-8000-000000000001',
   'Al Diwan — Sharq','{bakery,patisserie}',
   '{"governorate":"Al Asimah","area":"Sharq","block":"3","street":"Ahmad Al Jaber","building":"7"}',
   st_setsrid(st_makepoint(47.9840,29.3790),4326)::geography,
   'Ask at the till','اسأل عند الكاشير','+96522000002','Asia/Kuwait'),
  -- Food permit expired: publishing blocked, existing orders still honoured (§13-8)
  ('eeeeeeee-0000-4000-8000-000000000003','dddddddd-0000-4000-8000-000000000001','KW','11111111-0000-4000-8000-000000000003',
   'Al Diwan — Farwaniya','{bakery}',
   '{"governorate":"Farwaniya","area":"Farwaniya","block":"1","street":"Habib Munawer","building":"22"}',
   st_setsrid(st_makepoint(47.9590,29.2770),4326)::geography,
   'Drive-thru window','نافذة الخدمة من السيارة','+96522000003','Asia/Kuwait'),
  ('eeeeeeee-0000-4000-8000-000000000004','dddddddd-0000-4000-8000-000000000002','KW','11111111-0000-4000-8000-000000000002',
   'Salmiya Juice House','{juice_bar}',
   '{"governorate":"Hawalli","area":"Salmiya","block":"12","street":"Baghdad","building":"5"}',
   st_setsrid(st_makepoint(48.0700,29.3300),4326)::geography,
   'Front counter','الكاونتر الأمامي','+96522000004','Asia/Kuwait'),
  ('eeeeeeee-0000-4000-8000-000000000005','dddddddd-0000-4000-8000-000000000003','EG','11111111-0000-4000-8000-000000000007',
   'Zamalek Kitchen — Zamalek','{restaurant}',
   '{"governorate":"Cairo","district":"Zamalek","street":"Bahgat Ali","building":"12"}',
   st_setsrid(st_makepoint(31.2230,30.0600),4326)::geography,
   'Reception desk, ground floor','مكتب الاستقبال بالدور الأرضي','+20221000005','Africa/Cairo'),
  ('eeeeeeee-0000-4000-8000-000000000006','dddddddd-0000-4000-8000-000000000003','EG','11111111-0000-4000-8000-000000000007',
   'Zamalek Kitchen — Maadi','{restaurant,bakery}',
   '{"governorate":"Cairo","district":"Maadi","street":"Road 9","building":"40"}',
   st_setsrid(st_makepoint(31.2570,29.9600),4326)::geography,
   'Takeaway counter','كاونتر التيك أواي','+20221000006','Africa/Cairo'),
  ('eeeeeeee-0000-4000-8000-000000000007','dddddddd-0000-4000-8000-000000000003','EG','11111111-0000-4000-8000-000000000008',
   'Zamalek Kitchen — Dokki','{restaurant}',
   '{"governorate":"Giza","district":"Dokki","street":"Tahrir","building":"90"}',
   st_setsrid(st_makepoint(31.2110,30.0380),4326)::geography,
   'Ask for the pickup shelf','اطلب رف الاستلام','+20221000007','Africa/Cairo'),
  ('eeeeeeee-0000-4000-8000-000000000008','dddddddd-0000-4000-8000-000000000004','EG','11111111-0000-4000-8000-000000000009',
   'Alex Patisserie — Stanley','{patisserie}',
   '{"governorate":"Alexandria","district":"Stanley","street":"Corniche","building":"3"}',
   st_setsrid(st_makepoint(29.9560,31.2400),4326)::geography,
   'Counter by the window','الكاونتر جنب الشباك','+20321000008','Africa/Cairo');

-- Open 7 days; Kuwait and Egypt both weekend Fri-Sat but trade through it.
insert into store_hours (store_id, weekday, opens, closes)
select s.store_id, d.weekday, time '08:00', time '23:00'
from store s cross join generate_series(0, 6) as d(weekday);

-- ─── Staff assignments — roles are PER STORE (02-data-model.md §3) ──────────
-- RLS test 1 turns on staff 1 (store 1) being unable to read store 2's orders,
-- both stores belonging to the same partner.
insert into staff_assignment (user_id, partner_id, store_id, role, partner_wide, claimed_at) values
  -- Kuwait, Al Diwan
  ('bbbbbbbb-0000-4000-8000-000000000001','dddddddd-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000001','staff',      false, now()),
  ('bbbbbbbb-0000-4000-8000-000000000002','dddddddd-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000002','staff',      false, now()),
  ('bbbbbbbb-0000-4000-8000-000000000003','dddddddd-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000001','manager',    false, now()),
  ('bbbbbbbb-0000-4000-8000-000000000004','dddddddd-0000-4000-8000-000000000001', null,                                 'accountant', true,  now()),
  ('bbbbbbbb-0000-4000-8000-000000000005','dddddddd-0000-4000-8000-000000000001', null,                                 'owner',      true,  now()),
  -- Kuwait, Juice House
  ('bbbbbbbb-0000-4000-8000-000000000006','dddddddd-0000-4000-8000-000000000002', null,                                 'owner',      true,  now()),
  ('bbbbbbbb-0000-4000-8000-000000000007','dddddddd-0000-4000-8000-000000000002','eeeeeeee-0000-4000-8000-000000000004','staff',      false, now()),
  -- store 3 has publishing blocked but still has staff: its outstanding orders
  -- must remain redeemable (§13-8)
  ('bbbbbbbb-0000-4000-8000-000000000008','dddddddd-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000003','staff',      false, now()),
  -- Egypt, Zamalek Kitchen
  ('bbbbbbbb-0000-4000-8000-000000000009','dddddddd-0000-4000-8000-000000000003','eeeeeeee-0000-4000-8000-000000000005','staff',      false, now()),
  ('bbbbbbbb-0000-4000-8000-00000000000a','dddddddd-0000-4000-8000-000000000003','eeeeeeee-0000-4000-8000-000000000006','staff',      false, now()),
  ('bbbbbbbb-0000-4000-8000-00000000000b','dddddddd-0000-4000-8000-000000000003','eeeeeeee-0000-4000-8000-000000000005','manager',    false, now()),
  ('bbbbbbbb-0000-4000-8000-00000000000c','dddddddd-0000-4000-8000-000000000003', null,                                 'accountant', true,  now()),
  ('bbbbbbbb-0000-4000-8000-00000000000d','dddddddd-0000-4000-8000-000000000003', null,                                 'owner',      true,  now()),
  -- Egypt, Alex Patisserie
  ('bbbbbbbb-0000-4000-8000-00000000000e','dddddddd-0000-4000-8000-000000000004', null,                                 'owner',      true,  now()),
  ('bbbbbbbb-0000-4000-8000-00000000000f','dddddddd-0000-4000-8000-000000000004','eeeeeeee-0000-4000-8000-000000000008','staff',      false, now()),
  ('bbbbbbbb-0000-4000-8000-000000000010','dddddddd-0000-4000-8000-000000000003','eeeeeeee-0000-4000-8000-000000000007','staff',      false, now());

-- ─── Documents ──────────────────────────────────────────────────────────────
-- Every required type, approved, except one food permit that has expired.
-- Partner-level documents (everything that is not per-store).
insert into partner_document (partner_id, store_id, market, doc_type, storage_path,
                              status, expires_on, verified_at)
select p.partner_id, null, p.market, r.doc_type,
       'fixtures/' || p.partner_id || '/' || r.doc_type || '.pdf',
       'approved'::doc_status,
       case when r.requires_expiry then (now() + interval '300 days')::date else null end,
       now() - interval '60 days'
from partner p
join market_document_requirement r on r.market = p.market
where not r.per_store;

-- Per-store food permits / health licences, one of them expired.
insert into partner_document (partner_id, store_id, market, doc_type, storage_path,
                              status, expires_on, verified_at)
select st.partner_id, st.store_id, st.market,
       case when st.market = 'KW' then 'food_permit' else 'health_licence' end,
       'fixtures/' || st.store_id || '/permit.pdf',
       case when st.store_id = 'eeeeeeee-0000-4000-8000-000000000003' then 'expired' else 'approved' end::doc_status,
       case when st.store_id = 'eeeeeeee-0000-4000-8000-000000000003'
            then (now() - interval '3 days')::date else (now() + interval '300 days')::date end,
       now() - interval '60 days'
from store st;

-- The expiry job's effect, pre-applied: new listings blocked, existing orders
-- honoured. It cancels nothing (12-test-plan.md §jobs).
update store
   set publishing_blocked_at = now() - interval '3 days',
       publishing_blocked_reason = 'Food permit expired on ' || (now() - interval '3 days')::date
 where store_id = 'eeeeeeee-0000-4000-8000-000000000003';
