-- ============================================================================
-- Fixtures 40 — orders in every order_status, payments, redemptions, cash
-- Order codes use the restricted alphabet 23467 9ACDEFGHJKMNPQRTUVWXYZ:
-- no 0/O, 1/I/L, 5/S, 8/B (02-data-model.md §6).
-- Commission is RESOLVED FROM THE CONTRACT IN FORCE and STAMPED here, exactly
-- as app.resolve_commission() will do. It is never recomputed afterwards.
-- ============================================================================
set search_path = public, extensions;

with spec (n, code, market, store_id, consumer_id, day_offset, status, method, pay_status) as (values
  -- Kuwait, digital
  ( 1,'K7M-4C','KW','eeeeeeee-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000002', 2,'held',              'knet','pending'),
  ( 2,'R3D-9F','KW','eeeeeeee-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000002', 1,'reserved',          'knet','captured'),
  ( 3,'H4N-2K','KW','eeeeeeee-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000007',-1,'redeemed',          'knet','captured'),
  ( 4,'Q9T-6D','KW','eeeeeeee-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000003',-2,'no_show',           'knet','captured'),
  ( 5,'W2C-7J','KW','eeeeeeee-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000008',-3,'cancelled_consumer','knet','refunded'),
  ( 6,'Y6F-3M','KW','eeeeeeee-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000009',-3,'cancelled_partner', 'knet','refunded'),
  ( 7,'P4K-9R','KW','eeeeeeee-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-00000000000a',-2,'refunded',          'knet','refunded'),
  -- Kuwait, on the store whose food permit expired: the order still stands (§13-8)
  ( 8,'M3J-7Q','KW','eeeeeeee-0000-4000-8000-000000000003','cccccccc-0000-4000-8000-00000000000b',-1,'redeemed',          'knet','captured'),
  -- Egypt, digital
  ( 9,'C7R-2N','EG','eeeeeeee-0000-4000-8000-000000000005','cccccccc-0000-4000-8000-000000000005', 2,'held',              'card','pending'),
  (10,'F9D-4T','EG','eeeeeeee-0000-4000-8000-000000000005','cccccccc-0000-4000-8000-000000000005', 1,'reserved',          'card','captured'),
  (11,'G2M-6W','EG','eeeeeeee-0000-4000-8000-000000000005','cccccccc-0000-4000-8000-000000000018',-1,'redeemed',          'card','captured'),
  (12,'J6Q-3Y','EG','eeeeeeee-0000-4000-8000-000000000005','cccccccc-0000-4000-8000-000000000006',-2,'no_show',           'card','captured'),
  (13,'N4W-9C','EG','eeeeeeee-0000-4000-8000-000000000005','cccccccc-0000-4000-8000-000000000019',-3,'cancelled_consumer','card','refunded'),
  (14,'T7Y-2F','EG','eeeeeeee-0000-4000-8000-000000000006','cccccccc-0000-4000-8000-00000000001a',-3,'cancelled_partner', 'card','refunded'),
  (15,'V3G-6H','EG','eeeeeeee-0000-4000-8000-000000000006','cccccccc-0000-4000-8000-00000000001b',-2,'refunded',          'card','refunded'),
  -- Egypt, CASH ON PICKUP — no payment row, no PSP, commission is a receivable
  (16,'X9H-4K','EG','eeeeeeee-0000-4000-8000-000000000005','cccccccc-0000-4000-8000-00000000001c',-1,'redeemed',          'cash','none'),
  (17,'Z2K-7M','EG','eeeeeeee-0000-4000-8000-000000000005','cccccccc-0000-4000-8000-00000000001d',-2,'no_show',           'cash','none'),
  (18,'D6N-3P','EG','eeeeeeee-0000-4000-8000-000000000006','cccccccc-0000-4000-8000-00000000001e',-1,'redeemed',          'cash','none')
),
resolved as (
  select
    ('00de0000-0000-4000-8000-' || lpad(to_hex(s.n), 12, '0'))::uuid as order_id,
    s.*, l.listing_id, l.price_minor, l.currency, l.title_snapshot, l.description_snapshot,
    l.window_start_utc, l.window_end_utc, st.partner_id,
    (current_date + s.day_offset) as order_date,
    k.id as contract_id, k.commission_bp
  from spec s
  join store st on st.store_id = s.store_id::uuid
  join listing l on l.store_id = st.store_id and l.local_date = current_date + s.day_offset
  -- app.resolve_commission() in fixture form: the version in force on the day
  -- the order was created, not today's version.
  join lateral (
    select c.id, c.commission_bp
    from partner_contract c
    where c.partner_id = st.partner_id
      and c.effective_from <= (current_date + s.day_offset)
      and (c.effective_to is null or c.effective_to >= (current_date + s.day_offset))
    order by c.version desc
    limit 1
  ) k on true
)
insert into "order" (
  order_id, code, consumer_id, listing_id, store_id, partner_id, market, quantity,
  unit_price_minor, subtotal_minor, total_minor, currency,
  commission_bp, commission_minor, contract_version_id,
  title_snapshot, description_snapshot, window_start_utc, window_end_utc,
  method, payment_status, status, hold_expires_at, cancelled_reason_code, cancelled_at,
  created_at
)
select
  r.order_id, r.code, r.consumer_id::uuid, r.listing_id, r.store_id::uuid, r.partner_id,
  r.market::market, 1,
  r.price_minor, r.price_minor, r.price_minor, r.currency,
  r.commission_bp,
  -- round half up at the minor unit, the one rounding rule (05-money.md §1.5)
  div(r.price_minor * r.commission_bp + 5000, 10000),
  r.contract_id,
  r.title_snapshot, r.description_snapshot, r.window_start_utc, r.window_end_utc,
  r.method::payment_method, r.pay_status::payment_status, r.status::order_status,
  case when r.status = 'held' then now() + interval '10 minutes' end,
  case when r.status = 'cancelled_partner' then 'unexpected_closure'
       when r.status = 'cancelled_consumer' then 'consumer_request' end,
  case when r.status like 'cancelled%' then r.window_start_utc - interval '3 hours' end,
  r.window_start_utc - interval '1 day'
from resolved r;

-- ─── Payments: digital orders only. A cash order has NO payment row (P9). ───
insert into payment (order_id, provider, provider_ref, method, amount_minor, currency,
                     status, psp_fee_minor, authorised_at, captured_at, settled_at)
select o.order_id,
       case when o.market = 'KW' then 'myfatoorah' else 'paymob' end,
       'FIXTURE-' || o.code,
       o.method, o.total_minor, o.currency,
       o.payment_status,
       -- PSP fee ~2.5%, retained on refund unless the contract says otherwise
       div(o.total_minor * 250 + 5000, 10000),
       o.created_at, o.created_at + interval '40 seconds',
       case when o.payment_status in ('captured','refunded') then o.created_at + interval '2 days' end
from "order" o
where o.method <> 'cash' and o.payment_status <> 'pending';

insert into payment (order_id, provider, provider_ref, method, amount_minor, currency, status, redirect_url)
select o.order_id,
       case when o.market = 'KW' then 'myfatoorah' else 'paymob' end,
       'FIXTURE-' || o.code, o.method, o.total_minor, o.currency, 'pending',
       'https://sandbox.fixture.invalid/pay/' || o.code
from "order" o
where o.method <> 'cash' and o.payment_status = 'pending';

-- ─── Redemptions ────────────────────────────────────────────────────────────
insert into redemption (order_id, store_id, mechanism, staff_user_id, server_ts,
                        offline_queued, idempotency_key)
select o.order_id, o.store_id, 'code_shown', sa.user_id,
       o.window_start_utc + interval '20 minutes',
       false, 'fixture-redeem-' || o.code
from "order" o
join lateral (
  select user_id from staff_assignment
  where (store_id = o.store_id or (partner_wide and partner_id = o.partner_id))
    and revoked_at is null and role = 'staff'
  order by user_id limit 1
) sa on true
where o.status = 'redeemed';

-- ─── No-show dispositions: one tap, feeds compliance and impact ─────────────
insert into no_show_disposition (order_id, disposition)
select o.order_id,
       case when o.market = 'EG' then 'donated' else 'sold_in_store' end::disposition
from "order" o where o.status = 'no_show';

-- ─── Cash collection, including one short-collected order (§13-10) ──────────
-- Commission on a short collection is computed on collected_minor, not
-- total_minor (12-test-plan.md §payments P10).
insert into cash_collection (order_id, expected_minor, collected_minor, short_minor, staff_user_id)
select o.order_id, o.total_minor,
       case when o.code = 'D6N-3P' then o.total_minor - 1500 else o.total_minor end,
       case when o.code = 'D6N-3P' then 1500 else 0 end,
       'bbbbbbbb-0000-4000-8000-000000000009'
from "order" o
where o.method = 'cash' and o.status = 'redeemed';

-- ─── Cash reconciliation, with a variance that trips the threshold ──────────
insert into cash_reconciliation (store_id, business_date, expected_minor, reported_minor,
                                 variance_minor, note, submitted_by)
select 'eeeeeeee-0000-4000-8000-000000000006'::uuid, current_date - 1,
       coalesce(sum(c.collected_minor), 0),
       coalesce(sum(c.collected_minor), 0) - 1200,
       -1200,
       'Till short at close; escalated to the partner health queue.',
       'bbbbbbbb-0000-4000-8000-00000000000b'::uuid
from cash_collection c
join "order" o on o.order_id = c.order_id
where o.store_id = 'eeeeeeee-0000-4000-8000-000000000006';
