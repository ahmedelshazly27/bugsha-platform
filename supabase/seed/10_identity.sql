-- ============================================================================
-- Fixtures 10 — identity
-- Stable UUIDs, because the pgTAP suite authenticates as these users by id.
--   cccccccc… consumers   bbbbbbbb… partner staff   aaaaaaaa… ops
-- consumer_profile and partner_user are separate namespaces on purpose; the
-- same phone may appear in both (docs/02-data-model.md §2). Do not merge.
-- ============================================================================
set search_path = public, extensions;

-- ─── auth.users ─────────────────────────────────────────────────────────────
-- Fixture identities only. No real credential is seeded; these accounts sign in
-- by phone OTP in every environment that matters.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000'::uuid, u.id,
       'authenticated', 'authenticated', u.email,
       '$2a$10$fixtureonlynotarealpasswordhashXXXXXXXXXXXXXXXXXXXXXXX',
       now(), now(), now(),
       '{"provider":"phone","providers":["phone"]}'::jsonb, '{}'::jsonb
from (
  -- consumers: 6 named (referenced by tests) + 34 filler
  select ('cccccccc-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid as id,
         'consumer' || n || '@fixture.bugsha.test' as email
  from generate_series(1, 40) n
  union all
  select ('bbbbbbbb-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
         'staff' || n || '@fixture.bugsha.test'
  from generate_series(1, 16) n
  union all
  select ('aaaaaaaa-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
         'ops' || n || '@fixture.bugsha.test'
  from generate_series(1, 12) n
) u
on conflict (id) do nothing;

-- ─── app_user ───────────────────────────────────────────────────────────────
-- Consumers 1-3 and 7-23 are KW; 4-6 and 24-40 are EG.
insert into app_user (id, primary_market, locale, numerals)
select ('cccccccc-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
       c.mk::market,
       case when c.mk = 'KW' then 'ar-KW' else 'ar-EG' end::locale_code,
       'western'::numeral_system
from generate_series(1, 40) n
cross join lateral (
  select case when n in (1,2,3) or n between 7 and 23 then 'KW' else 'EG' end as mk
) c;

insert into app_user (id, primary_market, locale)
select ('bbbbbbbb-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
       case when n <= 8 then 'KW' else 'EG' end::market,
       case when n <= 8 then 'ar-KW' else 'ar-EG' end::locale_code
from generate_series(1, 16) n;

insert into app_user (id, primary_market, locale)
select ('aaaaaaaa-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
       case when n <= 6 then 'KW' else 'EG' end::market,
       'en'::locale_code
from generate_series(1, 12) n;

-- ─── consumer_profile ───────────────────────────────────────────────────────
-- Three cohorts the caps and reliability rules distinguish (00-product.md §6):
--   new          — no completed orders, reservation_cap_new_user applies
--   established  — history, full cap
--   restricted   — 3 no-shows in 90 days, restricted_until in the future
insert into consumer_profile (
  user_id, first_name, last_name, email, phone, market, city_id,
  dietary_flags, no_show_count_90d, reliability_score,
  restricted_until, restriction_reason_code, created_at
)
select
  ('cccccccc-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
  'Fixture', 'Consumer ' || n,
  'consumer' || n || '@fixture.bugsha.test',
  case when mk = 'KW' then '+965' || lpad((50000000 + n)::text, 8, '0')
       else '+20' || lpad((1000000000 + n)::text, 10, '0') end,
  mk::market,
  case when mk = 'KW'
       then ('11111111-0000-4000-8000-' || lpad(to_hex(1 + (n % 6)), 12, '0'))::uuid
       else ('11111111-0000-4000-8000-' || lpad(to_hex(7 + (n % 3)), 12, '0'))::uuid end,
  case when n % 7 = 0 then '{vegetarian}'::text[] else '{}'::text[] end,
  case when n in (3, 6) then 3 else 0 end,
  case when n in (3, 6) then 55.00 else 100.00 end,
  case when n in (3, 6) then now() + interval '14 days' else null end,
  case when n in (3, 6) then 'repeat_no_show' else null end,
  -- "new" cohort registered this week; everyone else has history
  case when n in (1, 4) then now() - interval '2 days' else now() - interval '200 days' end
from generate_series(1, 40) n
cross join lateral (
  select case when n in (1,2,3) or n between 7 and 23 then 'KW' else 'EG' end as mk
) c;

-- ─── partner_user ───────────────────────────────────────────────────────────
-- 1-8 Kuwait, 9-16 Egypt. Role is per store, assigned in 20_partner.sql.
insert into partner_user (user_id, full_name, phone)
select ('bbbbbbbb-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
       'Fixture Staff ' || n,
       case when n <= 8 then '+965' || lpad((60000000 + n)::text, 8, '0')
            else '+20' || lpad((1100000000 + n)::text, 10, '0') end
from generate_series(1, 16) n;

-- ─── ops_user ───────────────────────────────────────────────────────────────
-- All six roles, once KW-scoped and once EG-scoped. RLS test 7 depends on a
-- KW-scoped ops_manager being unable to see any Egyptian row.
insert into ops_user (user_id, role, market_scope, full_name)
select ('aaaaaaaa-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
       r.role,
       case when n <= 6 then '{KW}' else '{EG}' end::market[],
       r.label || ' (' || case when n <= 6 then 'KW' else 'EG' end || ')'
from generate_series(1, 12) n
cross join lateral (
  select (array['support_agent','ops_manager','finance','compliance','engineering','admin'])
           [((n - 1) % 6) + 1]::ops_role as role,
         (array['Support Agent','Ops Manager','Finance','Compliance','Engineering','Admin'])
           [((n - 1) % 6) + 1] as label
) r;
