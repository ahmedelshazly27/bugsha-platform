-- ============================================================================
-- 20260903000100_schema.sql
-- Derived from docs/03-schema.sql, forward-only.
-- Deviations from the spec text are marked DECISION Dn and recorded in
-- docs/DECISIONS.md. Nothing else is changed.
-- ============================================================================

-- ============================================================================
-- Bugsha — 03 schema
-- Forward-only. Split into supabase/migrations/ in the order the sections appear.
-- Read docs/05-money.md before touching section 7.
-- ============================================================================

-- DECISION D4: extension placement is explicit. Hosted Supabase keeps
-- extensions out of `public`; pg_cron lives in its own schema. Unqualified
-- `create extension` would put them in `public` and collide with the app tables.
create schema if not exists extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists postgis    with schema extensions;
create extension if not exists pg_net     with schema extensions;
create schema if not exists cron;
create extension if not exists pg_cron    with schema cron;

-- DECISION D4 (cont.): with postgis in `extensions`, the geography type is not
-- visible unqualified. Put it on the search path for the rest of this migration
-- so `geography(point,4326)` resolves in city.centroid and store.location.
set search_path = public, extensions;

create schema if not exists app;   -- business logic functions
comment on schema app is 'Business logic. Callers are clients via RPC; every function is security definer and asserts authorisation explicitly.';

-- ─── 1. Enums (closed sets that never grow at runtime) ──────────────────────

create type market            as enum ('KW','EG');
create type locale_code       as enum ('en','ar-KW','ar-EG');
create type numeral_system    as enum ('western','arabic_indic');
create type ops_role          as enum ('support_agent','ops_manager','finance','compliance','engineering','admin');
create type partner_role      as enum ('owner','manager','staff','accountant');
create type onboarding_status as enum ('lead','applied','documents_pending','under_review','approved',
                                       'contract_pending','contract_signed','store_setup',
                                       'first_listing_pending','active','rejected','suspended');
create type doc_status        as enum ('pending','under_review','approved','rejected','expired');
create type listing_status    as enum ('draft','active','sold_out','closed','cancelled');
create type moderation_status as enum ('auto_approved','flagged','approved','edited','rejected');
create type order_status      as enum ('held','reserved','redeemed','no_show',
                                       'cancelled_consumer','cancelled_partner','refunded');
create type payment_method    as enum ('knet','apple_pay','card','wallet','instapay','fawry','cash','wallet_credit');
create type payment_status    as enum ('none','pending','authorised','captured','settled',
                                       'failed','cancelled','ambiguous','refunded');
create type redeem_mechanism  as enum ('code_shown','qr_scanned');
create type disposition       as enum ('donated','sold_in_store','kept','disposed');
create type entry_type        as enum ('debit','credit');
create type ledger_account    as enum ('cash_in_transit','platform_bank','partner_payable','partner_receivable',
                                       'commission_revenue','psp_fees','refunds_payable',
                                       'consumer_wallet_liability','promotion_expense_platform',
                                       'promotion_contra_partner','vat_payable','chargeback_losses',
                                       'goodwill_expense','unreconciled_suspense');
create type reference_type    as enum ('order','refund','payout','adjustment','chargeback','invoice','promotion','settlement');
create type payout_status     as enum ('pending','ready','held','approved','executing','paid','failed','carried');
create type promotion_funder  as enum ('platform','partner');
create type dispute_severity  as enum ('critical','high','standard');
create type city_stage        as enum ('waitlist','soft_launch','live');
create type fee_bearer        as enum ('platform','partner');

-- ─── 2. Platform configuration ──────────────────────────────────────────────

create table market_config (
  market                    market primary key,
  currency                  char(3) not null,
  exponent                  smallint not null check (exponent between 0 and 4),
  timezone                  text not null,
  observes_dst              boolean not null,
  locales                   locale_code[] not null,
  default_locale            locale_code not null,
  numerals_default          numeral_system not null default 'western',
  payment_methods           payment_method[] not null,
  cash_enabled              boolean not null default false,
  default_commission_bp     integer not null check (default_commission_bp between 0 and 10000),
  -- Tax: TODO(decision). Never default vat_bp to 0 — null means "undecided", and
  -- app.resolve_tax() raises on null so nobody ships an accidental zero-rate.
  vat_applies               boolean not null default false,
  vat_bp                    integer,
  vat_effective_from        date,
  vat_base                  text check (vat_base in ('commission','gross')),
  invoicing_mode            text,
  regulator_name            text not null,
  price_min_minor           bigint not null,
  price_max_minor           bigint not null,
  max_price_fraction        numeric(3,2) not null default 0.50,
  reservation_cap_default   integer not null default 3,
  reservation_cap_new_user  integer not null default 2,
  reservation_cap_cash      integer not null default 1,
  hold_duration_minutes     integer not null default 10,
  cancel_cutoff_hours       integer not null default 2,
  late_redeem_grace_minutes integer not null default 30,
  undo_redeem_seconds       integer not null default 120,
  payout_cadence            text not null default 'weekly',
  payout_day                smallint,
  payout_min_minor          bigint not null,
  refund_cap_support_minor  bigint not null,
  adjustment_four_eyes_minor bigint not null,
  cash_variance_threshold_minor bigint,
  cash_liability_escalate_minor bigint,
  cash_liability_escalate_days  integer,
  version                   integer not null default 1,
  approved_by_1             uuid,
  approved_by_2             uuid,
  updated_at                timestamptz not null default now(),
  constraint four_eyes_distinct check (approved_by_1 is null or approved_by_1 <> approved_by_2),
  -- DECISION D6: the spec's constraint was
  --   check (not vat_applies or (vat_bp is not null and vat_base is not null))
  -- which makes Egypt's launch row unrepresentable: 13-config.md seeds EG with
  -- vat_applies = true while decision 1 keeps vat_bp and vat_base null. Setting
  -- vat_applies = false instead would make resolve_tax() return zero silently —
  -- the precise failure 13-config.md §2 forbids. This permits the undecided
  -- state (both null, code raises BG150) and still rejects a half-configured one.
  constraint vat_coherent check ((vat_bp is null) = (vat_base is null)),
  constraint vat_off_is_unset check (vat_applies or (vat_bp is null and vat_base is null))
);

create table market_config_history (like market_config);

create table city (
  id                 uuid primary key default uuid_generate_v4(),
  market             market not null,
  name_en            text not null,
  name_ar            text not null,
  governorate        text not null,
  stage              city_stage not null default 'waitlist',
  centroid           geography(point,4326),
  default_radius_m   integer not null default 5000,
  marketplace_hours  jsonb,
  created_at         timestamptz not null default now(),
  unique (market, name_en)
);

create table market_holiday (
  market market not null, holiday_date date not null,
  name_en text not null, name_ar text not null,
  suppress_materialisation boolean not null default true,
  primary key (market, holiday_date)
);

create table market_document_requirement (
  market market not null, doc_type text not null,
  label_en text not null, label_ar text not null,
  per_store boolean not null default false,
  requires_expiry boolean not null default true,
  blocks_publishing_on_expiry boolean not null default false,
  primary key (market, doc_type)
);

create table reason_code (
  code text primary key, domain text not null,
  label_en text not null, label_ar_kw text not null, label_ar_eg text not null,
  requires_free_text boolean not null default false,
  active boolean not null default true
);

create table feature_flag (
  id uuid primary key default uuid_generate_v4(),
  key text not null, market market, city_id uuid references city(id),
  cohort text, enabled boolean not null default false,
  is_kill_switch boolean not null default false,
  updated_by uuid, updated_at timestamptz not null default now()
);
-- DECISION D1: the spec expresses the key as
--   primary key (key, coalesce(market::text,'*'), coalesce(city_id::text,'*'), coalesce(cohort,'*'))
-- Postgres does not permit expressions in a PRIMARY KEY. The identity the spec
-- describes is preserved exactly, as a unique index over the same expressions,
-- with a surrogate uuid primary key for foreign-key targets.
create unique index feature_flag_scope_key on feature_flag
  (key, coalesce(market::text,'*'), coalesce(city_id::text,'*'), coalesce(cohort,'*'));

-- ─── 3. Identity ────────────────────────────────────────────────────────────

create table app_user (
  id             uuid primary key references auth.users(id) on delete cascade,
  primary_market market not null,
  locale         locale_code not null,
  numerals       numeral_system not null default 'western',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table consumer_profile (
  user_id           uuid primary key references app_user(id) on delete cascade,
  first_name        text not null,
  last_name         text,
  email             text,
  phone             text not null,
  market            market not null,
  city_id           uuid references city(id),
  dietary_flags     text[] not null default '{}',
  allergen_ack_at   timestamptz,
  no_show_count_90d integer not null default 0,
  reliability_score numeric(5,2) not null default 100,
  restricted_until  timestamptz,
  restriction_reason_code text references reason_code(code),
  deletion_requested_at timestamptz,
  created_at        timestamptz not null default now(),
  unique (market, phone)
);

-- Deliberately a separate namespace from consumer_profile. The same phone may
-- exist in both; unifying them makes a JWT's role ambiguous. Do not merge.
create table partner_user (
  user_id    uuid primary key references app_user(id) on delete cascade,
  full_name  text not null,
  phone      text not null,
  created_at timestamptz not null default now()
);

create table ops_user (
  user_id      uuid primary key references app_user(id) on delete cascade,
  role         ops_role not null,
  market_scope market[] not null,
  full_name    text not null,
  created_by   uuid references ops_user(user_id),
  disabled_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- ─── 4. Partner, contract, store, staff, documents ──────────────────────────

create table partner (
  partner_id        uuid primary key default uuid_generate_v4(),
  market            market not null,          -- one market per legal entity, always
  legal_name        text not null,
  trading_name      text not null,
  categories        text[] not null default '{}',
  onboarding_status onboarding_status not null default 'lead',
  branch_count      integer,
  contact_name      text, contact_role text, contact_phone text, contact_email text,
  city_id           uuid references city(id),
  referral_source   text,
  est_daily_surplus_minor bigint,
  current_disposal  text,
  reliability_score numeric(5,2) not null default 100,
  reliability_override numeric(5,2),
  reliability_override_reason text,
  activated_at      timestamptz,
  suspended_until   timestamptz,
  suspend_reason_code text references reason_code(code),
  owner_ops_user    uuid references ops_user(user_id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table partner_status_history (
  id uuid primary key default uuid_generate_v4(),
  partner_id uuid not null references partner(partner_id),
  from_status onboarding_status, to_status onboarding_status not null,
  actor uuid, reason_code text references reason_code(code), reason_text text,
  at timestamptz not null default now()
);

-- Immutable. A renegotiated rate is a NEW ROW. Never UPDATE commission_bp.
create table partner_contract (
  id uuid primary key default uuid_generate_v4(),
  partner_id uuid not null references partner(partner_id),
  version integer not null,
  commission_bp integer not null check (commission_bp between 0 and 10000),
  payout_cadence text not null,
  payout_min_minor bigint not null,
  psp_fee_bearer fee_bearer not null default 'platform',       -- TODO(decision)
  chargeback_bearer fee_bearer not null default 'platform',    -- TODO(decision)
  no_show_policy text not null default 'partner_retains',      -- TODO(decision)
  cash_settlement_mode text not null default 'net',            -- net | invoice
  effective_from date not null,
  effective_to date,
  accepted_at timestamptz, accepted_by uuid, accepted_ip inet, accepted_ua text,
  document_hash text,
  created_at timestamptz not null default now(),
  unique (partner_id, version),
  constraint effective_range check (effective_to is null or effective_to > effective_from)
);
create index on partner_contract (partner_id, effective_from desc);

create table store (
  store_id uuid primary key default uuid_generate_v4(),
  partner_id uuid not null references partner(partner_id),
  market market not null,
  city_id uuid not null references city(id),
  display_name text not null,
  category_tags text[] not null default '{}',
  address jsonb not null,                     -- market-shaped; validated by Zod
  location geography(point,4326) not null,    -- partner-dragged pin: authoritative
  geocoded_location geography(point,4326),    -- suggestion only
  pickup_point_en text not null,
  pickup_point_ar text not null,
  contact_phone text not null,
  timezone text not null,
  photos text[] not null default '{}',
  publishing_blocked_at timestamptz,
  publishing_blocked_reason text,
  paused_until timestamptz,
  pause_reason_code text references reason_code(code),
  reliability_score numeric(5,2) not null default 100,
  permanently_closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on store using gist (location);
create index on store (partner_id);
create index on store (market, city_id) where permanently_closed_at is null;

create table store_hours (
  id uuid primary key default uuid_generate_v4(),
  store_id uuid not null references store(store_id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  opens time not null, closes time not null,
  shift_index smallint not null default 0,      -- >0 = split shift
  is_ramadan boolean not null default false,
  unique (store_id, weekday, shift_index, is_ramadan)
);

create table store_closure (
  store_id uuid not null references store(store_id) on delete cascade,
  closure_date date not null, reason text,
  primary key (store_id, closure_date)
);

create table staff_assignment (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references partner_user(user_id) on delete cascade,
  partner_id uuid not null references partner(partner_id),
  store_id uuid references store(store_id) on delete cascade,   -- null = partner-wide
  role partner_role not null,
  partner_wide boolean not null default false,
  invited_by uuid, invited_at timestamptz not null default now(),
  claimed_at timestamptz, revoked_at timestamptz,
  constraint scope_coherent check (partner_wide = (store_id is null))
);
create unique index on staff_assignment (user_id, coalesce(store_id::text, partner_id::text))
  where revoked_at is null;

create table partner_document (
  id uuid primary key default uuid_generate_v4(),
  partner_id uuid not null references partner(partner_id),
  store_id uuid references store(store_id),
  market market not null,
  doc_type text not null,
  storage_path text not null,
  extracted jsonb,
  expires_on date,
  status doc_status not null default 'pending',
  rejection_reason_code text references reason_code(code),
  rejection_text text,          -- sent to the partner VERBATIM
  verified_by uuid references ops_user(user_id),
  verified_at timestamptz,
  uploaded_at timestamptz not null default now(),
  foreign key (market, doc_type) references market_document_requirement(market, doc_type)
);
create index on partner_document (expires_on) where status = 'approved';
create index on partner_document (partner_id, status);

-- ─── 5. Catalog ─────────────────────────────────────────────────────────────

create table bag_template (
  id uuid primary key default uuid_generate_v4(),
  partner_id uuid not null references partner(partner_id),
  store_id uuid references store(store_id),      -- null = shared across partner
  title_en text not null, title_ar text not null,
  description_en text, description_ar text,
  category text not null,
  value_min_minor bigint not null, value_max_minor bigint not null,
  price_minor bigint not null,
  default_quantity integer not null check (default_quantity > 0),
  default_window_start time not null, default_window_end time not null,
  dietary_flags text[] not null default '{}',
  allergen_notes_en text, allergen_notes_ar text,
  image_path text,
  archived_at timestamptz,                        -- archived, NEVER deleted
  created_at timestamptz not null default now(),
  constraint value_range check (value_max_minor >= value_min_minor),
  constraint no_alcohol check (category <> 'alcohol')
);

create table listing_schedule (
  id uuid primary key default uuid_generate_v4(),
  store_id uuid not null references store(store_id),
  template_id uuid not null references bag_template(id),
  weekdays smallint[] not null,
  local_start time not null, local_end time not null,
  quantity integer not null check (quantity > 0),
  publish_lead_minutes integer not null default 150,
  active boolean not null default true,
  ramadan_affected boolean not null default false,
  ramadan_suspended_from date, ramadan_suspended_to date,
  paused_at timestamptz,
  created_at timestamptz not null default now()
);

create table listing (
  listing_id uuid primary key default uuid_generate_v4(),
  store_id uuid not null references store(store_id),
  partner_id uuid not null references partner(partner_id),
  market market not null,
  city_id uuid not null references city(id),
  template_id uuid references bag_template(id),
  schedule_id uuid references listing_schedule(id),
  -- SNAPSHOTS: copied at creation so later template edits never rewrite history
  title_snapshot text not null,
  description_snapshot text,
  allergen_snapshot text,
  category text not null,
  price_minor bigint not null,
  currency char(3) not null,
  value_min_minor bigint not null, value_max_minor bigint not null,
  quantity_total integer not null check (quantity_total > 0),
  quantity_remaining integer not null check (quantity_remaining >= 0),
  -- both the partner's local intent AND the resolved instants are persisted
  local_date date not null, local_start time not null, local_end time not null,
  window_start_utc timestamptz not null, window_end_utc timestamptz not null,
  reservation_cutoff_utc timestamptz not null,
  status listing_status not null default 'active',
  moderation_status moderation_status not null default 'auto_approved',
  dietary_flags text[] not null default '{}',
  cancelled_reason_code text references reason_code(code),
  cancelled_reason_text text,
  cancelled_at timestamptz,
  created_by uuid, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quantity_sane check (quantity_remaining <= quantity_total),
  constraint window_sane check (window_end_utc > window_start_utc)
);
create index on listing (market, city_id, status, window_end_utc) where status = 'active';
create index on listing (store_id, local_date);
create index on listing (schedule_id, local_date);

-- ─── 6. Commerce ────────────────────────────────────────────────────────────

create table promotion (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,
  market market not null,
  discount_type text not null check (discount_type in ('fixed','percent')),
  discount_value integer not null,
  -- NOT NULL, NO DEFAULT: a promotion without funding attribution cannot be
  -- represented in the ledger, so the schema makes it impossible to create.
  funded_by promotion_funder not null,
  eligibility jsonb not null default '{}',
  cap_per_user integer, cap_total integer,
  budget_cap_minor bigint not null,
  budget_spent_minor bigint not null default 0,
  valid_from timestamptz not null, valid_to timestamptz not null,
  stackable boolean not null default false,
  created_by uuid, created_at timestamptz not null default now()
);

create table "order" (
  order_id uuid primary key default uuid_generate_v4(),
  code text not null unique,          -- alphabet excludes 0/O 1/I/L 5/S 8/B
  consumer_id uuid not null references consumer_profile(user_id),
  listing_id uuid not null references listing(listing_id),
  store_id uuid not null references store(store_id),
  partner_id uuid not null references partner(partner_id),
  market market not null,
  quantity integer not null check (quantity > 0),
  unit_price_minor bigint not null,
  subtotal_minor bigint not null,
  service_fee_minor bigint not null default 0,
  discount_minor bigint not null default 0,
  tax_minor bigint not null default 0,
  total_minor bigint not null,
  currency char(3) not null,
  -- STAMPED AT CREATION from the contract in force. Never recomputed.
  commission_bp integer not null,
  commission_minor bigint not null,
  contract_version_id uuid not null references partner_contract(id),
  promotion_id uuid references promotion(id),
  discount_funded_by promotion_funder,
  title_snapshot text not null,
  description_snapshot text,
  window_start_utc timestamptz not null,
  window_end_utc timestamptz not null,
  method payment_method not null,
  payment_status payment_status not null default 'none',
  status order_status not null default 'held',
  hold_expires_at timestamptz,
  cancelled_reason_code text references reason_code(code),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promo_coherent check (promotion_id is null or discount_funded_by is not null)
);
create index on "order" (store_id, window_start_utc, status);
create index on "order" (consumer_id, created_at desc);
create index on "order" (hold_expires_at) where status = 'held';
create index on "order" (window_end_utc) where status = 'reserved';
create index on "order" (code text_pattern_ops);

create table payment (
  payment_id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references "order"(order_id),
  provider text not null,               -- myfatoorah | tap | paymob | cash
  provider_ref text,
  method payment_method not null,
  amount_minor bigint not null,
  currency char(3) not null,
  status payment_status not null default 'pending',
  psp_fee_minor bigint,
  fawry_reference text, fawry_expires_at timestamptz,
  redirect_url text,
  authorised_at timestamptz, captured_at timestamptz, settled_at timestamptz,
  failure_code text, failure_message text,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index on payment (provider, provider_ref) where provider_ref is not null;
create index on payment (order_id);

-- Append-only. Every webhook, including duplicates and replays.
create table payment_event (
  id uuid primary key default uuid_generate_v4(),
  payment_id uuid references payment(payment_id),
  provider text not null, provider_ref text,
  event_type text not null,
  signature_valid boolean not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz, processing_result text
);
create index on payment_event (provider, provider_ref);

create table refund (
  refund_id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references "order"(order_id),
  payment_id uuid references payment(payment_id),
  amount_minor bigint not null,
  destination text not null check (destination in ('source','wallet')),
  reason_code text not null references reason_code(code),
  cost_bearer fee_bearer not null,
  requested_by uuid, approved_by uuid,
  status text not null default 'requested',
  provider_ref text, disbursed_at timestamptz,
  created_at timestamptz not null default now()
);

create table wallet_transaction (
  id uuid primary key default uuid_generate_v4(),
  consumer_id uuid not null references consumer_profile(user_id),
  amount_minor bigint not null,          -- signed
  currency char(3) not null,
  market market not null,
  source text not null,                  -- refund | referral | goodwill | spend
  reference_type reference_type, reference_id uuid,
  expires_on date,
  created_at timestamptz not null default now()
);
create index on wallet_transaction (consumer_id, created_at desc);

-- ─── 7. Fulfilment ──────────────────────────────────────────────────────────

create table redemption (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references "order"(order_id) unique,
  store_id uuid not null references store(store_id),
  mechanism redeem_mechanism not null,
  staff_user_id uuid references partner_user(user_id),
  client_ts timestamptz,                 -- device clock, when offline-queued
  server_ts timestamptz not null default now(),
  offline_queued boolean not null default false,
  late_grace boolean not null default false,
  idempotency_key text not null,
  undone_at timestamptz, undone_by uuid,
  created_at timestamptz not null default now()
);

create table no_show_disposition (
  order_id uuid primary key references "order"(order_id),
  disposition disposition not null,
  recorded_by uuid, at timestamptz not null default now()
);

create table cash_collection (
  order_id uuid primary key references "order"(order_id),
  expected_minor bigint not null,
  collected_minor bigint not null,
  short_minor bigint not null default 0,
  staff_user_id uuid references partner_user(user_id),
  at timestamptz not null default now()
);

create table cash_reconciliation (
  id uuid primary key default uuid_generate_v4(),
  store_id uuid not null references store(store_id),
  business_date date not null,
  expected_minor bigint not null,
  reported_minor bigint not null,
  variance_minor bigint not null,
  note text,
  submitted_by uuid, submitted_at timestamptz not null default now(),
  unique (store_id, business_date)
);

-- ─── 8. Money ───────────────────────────────────────────────────────────────

create table accounting_period (
  id uuid primary key default uuid_generate_v4(),
  market market not null,
  period_start date not null, period_end date not null,
  locked_at timestamptz, locked_by uuid,
  unique (market, period_start)
);

create table financial_entry (
  id uuid primary key default uuid_generate_v4(),
  transaction_id uuid not null,
  entry_type entry_type not null,
  account ledger_account not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null,
  market market not null,
  partner_id uuid references partner(partner_id),
  store_id uuid references store(store_id),
  order_id uuid references "order"(order_id),
  payment_id uuid references payment(payment_id),
  payout_id uuid,
  reference_type reference_type not null,
  reference_id uuid not null,
  effective_at timestamptz not null,     -- business event time
  recorded_at timestamptz not null default now(),   -- system write time
  contract_version_id uuid references partner_contract(id),
  created_by text not null,              -- 'system' or a user id
  reason_code text references reason_code(code),
  reverses_entry_id uuid references financial_entry(id)
);
create index on financial_entry (transaction_id);
create index on financial_entry (partner_id, effective_at);
create index on financial_entry (account, market, effective_at);
create index on financial_entry (order_id);
create index on financial_entry (payout_id) where payout_id is not null;

-- Immutability, enforced. Corrections are reversing entries.
revoke update, delete on financial_entry from public, authenticated, anon, service_role;
create or replace function app.forbid_ledger_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'financial_entry is append-only; post a reversing entry instead'
    using errcode = 'BG001';
end $$;
create trigger ledger_no_update before update or delete on financial_entry
  for each row execute function app.forbid_ledger_mutation();

-- Balance invariant: per transaction_id, per currency, debits = credits.
-- DEFERRABLE so a multi-statement posting function can build a transaction.
create or replace function app.assert_transaction_balanced() returns trigger
language plpgsql as $$
declare v_drift record;
begin
  for v_drift in
    select currency,
           sum(case when entry_type='debit' then amount_minor else -amount_minor end) as delta
    from financial_entry where transaction_id = new.transaction_id
    group by currency having sum(case when entry_type='debit' then amount_minor else -amount_minor end) <> 0
  loop
    raise exception 'unbalanced transaction % in %: delta %', new.transaction_id, v_drift.currency, v_drift.delta
      using errcode = 'BG002';
  end loop;
  return null;
end $$;
create constraint trigger transaction_balanced
  after insert on financial_entry deferrable initially deferred
  for each row execute function app.assert_transaction_balanced();

-- No entry may land inside a locked period.
create or replace function app.assert_period_open() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from accounting_period p
             where p.market = new.market and p.locked_at is not null
               and new.effective_at::date between p.period_start and p.period_end) then
    raise exception 'period is locked for market %; post to the current period with a reference', new.market
      using errcode = 'BG003';
  end if;
  return new;
end $$;
create trigger entry_period_open before insert on financial_entry
  for each row execute function app.assert_period_open();

create table payout_run (
  id uuid primary key default uuid_generate_v4(),
  market market not null,
  period_start date not null, period_end date not null,
  status text not null default 'draft',
  frozen_at timestamptz,
  approved_by_1 uuid, approved_by_1_at timestamptz,
  approved_by_2 uuid, approved_by_2_at timestamptz,
  executed_at timestamptz, executed_by uuid,
  created_at timestamptz not null default now(),
  constraint four_eyes_distinct check (approved_by_1 is null or approved_by_1 <> approved_by_2)
);

create table payout (
  payout_id uuid primary key default uuid_generate_v4(),
  run_id uuid not null references payout_run(id),
  partner_id uuid not null references partner(partner_id),
  currency char(3) not null,
  gross_minor bigint not null,
  netted_minor bigint not null default 0,
  carry_in_minor bigint not null default 0,
  net_minor bigint not null,
  carry_out_minor bigint not null default 0,
  status payout_status not null default 'pending',
  hold_reason text,
  provider_ref text, failure_reason text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (run_id, partner_id, currency)
);

create table statement (
  id uuid primary key default uuid_generate_v4(),
  payout_id uuid references payout(payout_id),
  partner_id uuid not null references partner(partner_id),
  period_start date not null, period_end date not null,
  pdf_path text, csv_path text, totals jsonb not null,
  generated_at timestamptz not null default now()
);

create table settlement_batch (
  id uuid primary key default uuid_generate_v4(),
  provider text not null, market market not null,
  settlement_date date not null,
  gross_minor bigint not null, fee_minor bigint not null, net_minor bigint not null,
  file_path text, matched_count integer, exception_count integer,
  imported_at timestamptz not null default now(),
  unique (provider, settlement_date)
);

create table reconciliation_exception (
  id uuid primary key default uuid_generate_v4(),
  kind text not null,                    -- psp | bank | cash
  exception_type text not null,
  provider_ref text, payment_id uuid references payment(payment_id),
  store_id uuid references store(store_id),
  expected_minor bigint, actual_minor bigint, currency char(3),
  market market not null,
  status text not null default 'open',
  resolution text, resolved_by uuid, resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- ─── 9. Trust & safety ──────────────────────────────────────────────────────

create table review (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references "order"(order_id) unique,
  consumer_id uuid not null references consumer_profile(user_id),
  store_id uuid not null references store(store_id),
  rating smallint not null check (rating between 1 and 5),
  tags text[] not null default '{}',
  body text, photo_path text,
  published boolean not null default true,
  hidden_reason text, hidden_by uuid,
  created_at timestamptz not null default now()
);

create table review_response (
  review_id uuid primary key references review(id),
  body text not null,
  moderation_status moderation_status not null default 'flagged',
  responded_by uuid, created_at timestamptz not null default now()
);

create table quality_flag (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid references "order"(order_id),
  store_id uuid not null references store(store_id),
  partner_id uuid not null references partner(partner_id),
  source text not null check (source in ('consumer','partner','ops')),
  category text not null, body text,
  severity dispute_severity not null default 'high',
  acknowledged_at timestamptz, acknowledged_by uuid, acknowledgement_text text,
  ack_deadline timestamptz, escalated_at timestamptz,
  created_at timestamptz not null default now()
);

create table dispute (
  id uuid primary key default uuid_generate_v4(),
  case_ref text not null unique,
  order_id uuid references "order"(order_id),
  consumer_id uuid references consumer_profile(user_id),
  market market not null,
  category text not null, severity dispute_severity not null,
  consumer_statement text, photos text[] not null default '{}',
  illness_detail jsonb,                  -- items, eaten_at, onset_at, symptoms
  partner_statement text, partner_deadline timestamptz,
  owner_ops_user uuid references ops_user(user_id),
  sla_due_at timestamptz not null,
  resolution text, financial_outcome jsonb,
  opened_at timestamptz not null default now(), resolved_at timestamptz
);
create index on dispute (severity, sla_due_at) where resolved_at is null;

create table incident (
  id uuid primary key default uuid_generate_v4(),
  ref text not null unique,
  market market not null,
  partner_id uuid not null references partner(partner_id),
  store_id uuid not null references store(store_id),
  categories text[] not null,
  order_refs text[] not null default '{}',
  consumer_reports jsonb, partner_response text,
  platform_action jsonb, resolution text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz, signed_off_by uuid references ops_user(user_id),
  amends_incident_id uuid references incident(id),
  created_at timestamptz not null default now()
);

-- Immutable once closed. Corrections are new rows with amends_incident_id.
create or replace function app.forbid_closed_incident_edit() returns trigger
language plpgsql as $$
begin
  if old.closed_at is not null then
    raise exception 'incident % is closed; file an amendment referencing it', old.ref
      using errcode = 'BG004';
  end if;
  return new;
end $$;
create trigger incident_immutable before update on incident
  for each row execute function app.forbid_closed_incident_edit();

create table quality_hold (
  id uuid primary key default uuid_generate_v4(),
  store_id uuid not null references store(store_id),
  incident_id uuid references incident(id),
  reason_text text not null,
  expected_duration text,
  cancel_existing boolean not null default false,
  placed_by uuid references ops_user(user_id),
  placed_at timestamptz not null default now(),
  released_at timestamptz, released_by uuid
);

-- ─── 10. Compliance ledger (partner + regulator facing) ─────────────────────

create table compliance_entry (
  id uuid primary key default uuid_generate_v4(),
  store_id uuid not null references store(store_id),
  partner_id uuid not null references partner(partner_id),
  event_type text not null,     -- listing_published | listing_edited | listing_cancelled
                                -- order_reserved | redeemed | no_show | quality_flag | dispute_resolved
  listing_id uuid references listing(listing_id),
  order_id uuid references "order"(order_id),
  category text, quantity integer, declared_value_minor bigint, currency char(3),
  listed_at timestamptz, window_start_utc timestamptz, window_end_utc timestamptz,
  redeemed_client_ts timestamptz, redeemed_server_ts timestamptz,
  staff_user_id uuid references partner_user(user_id),
  disposition disposition,
  reason_code text references reason_code(code), detail jsonb,
  recorded_at timestamptz not null default now(),
  corrects_entry_id uuid references compliance_entry(id)
);
create index on compliance_entry (store_id, recorded_at);
revoke update, delete on compliance_entry from public, authenticated, anon, service_role;
create trigger compliance_no_update before update or delete on compliance_entry
  for each row execute function app.forbid_ledger_mutation();

-- ─── 11. Platform tooling ───────────────────────────────────────────────────

create table idempotency_key (
  key text primary key,
  actor uuid,
  operation text not null,
  request_hash text not null,
  response jsonb,
  created_at timestamptz not null default now()
);
create index on idempotency_key (created_at);   -- 30-day sweep

create table notification_template (
  key text not null, locale locale_code not null,
  title text not null, body text not null, deep_link text,
  bypasses_quiet_hours boolean not null default false,
  authored_by uuid, reviewed_by uuid, reviewed_at timestamptz,
  published boolean not null default false,
  version integer not null default 1,
  primary key (key, locale, version),
  -- an author may not approve their own locale
  constraint reviewer_not_author check (reviewed_by is null or reviewed_by <> authored_by)
);

create table notification_log (
  id uuid primary key default uuid_generate_v4(),
  template_key text not null, locale locale_code not null,
  recipient_user uuid, order_id uuid references "order"(order_id),
  channels text[] not null, results jsonb,
  suppressed_reason text,
  sent_at timestamptz not null default now()
);
create index on notification_log (recipient_user, sent_at desc);
create index on notification_log (order_id);

create table notification_preference (
  user_id uuid primary key references app_user(id) on delete cascade,
  categories jsonb not null default '{}',
  quiet_from time, quiet_to time,
  channel_pref text[] not null default '{push}'
);

create table audit_log (
  id uuid primary key default uuid_generate_v4(),
  actor_user uuid, actor_role text,
  operation text not null,
  target_type text not null, target_id uuid,
  before jsonb, after jsonb,
  reason_code text references reason_code(code),
  justification text,
  market market,
  ip inet, session_id text, user_agent text,
  at timestamptz not null default now()
);
create index on audit_log (at desc);
create index on audit_log (actor_user, at desc);
create index on audit_log (target_type, target_id);
revoke update, delete on audit_log from public, authenticated, anon, service_role;

create table impersonation_session (
  id uuid primary key default uuid_generate_v4(),
  ops_user uuid not null references ops_user(user_id),
  target_user uuid not null references app_user(id),
  mode text not null default 'read_only',
  reason text not null, consent_captured text,
  started_at timestamptz not null default now(),
  hard_expires_at timestamptz not null,
  ended_at timestamptz
);

create table partner_api_key (
  id uuid primary key default uuid_generate_v4(),
  partner_id uuid not null references partner(partner_id),
  label text not null,
  key_prefix text not null, key_hash text not null,
  scopes text[] not null,
  store_ids uuid[],
  rate_limit_per_min integer not null default 120,
  is_test boolean not null default false,
  last_used_at timestamptz, revoked_at timestamptz,
  created_by uuid, created_at timestamptz not null default now()
);

create table partner_webhook (
  id uuid primary key default uuid_generate_v4(),
  partner_id uuid not null references partner(partner_id),
  endpoint text not null, secret text not null,
  events text[] not null,
  created_at timestamptz not null default now()
);

create table partner_webhook_delivery (
  id uuid primary key default uuid_generate_v4(),
  webhook_id uuid not null references partner_webhook(id),
  event text not null, payload jsonb not null,
  attempts integer not null default 0,
  status text not null default 'pending',
  last_error text, delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create table job_run (
  id uuid primary key default uuid_generate_v4(),
  job_name text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  rows_affected integer, error text,
  runbook_key text
);
create index on job_run (job_name, started_at desc);

-- ─── 12. Views the clients read ─────────────────────────────────────────────

create view v_browse_listing as
select l.listing_id, l.market, l.city_id, l.title_snapshot, l.category,
       l.price_minor, l.currency, l.value_min_minor, l.value_max_minor,
       l.quantity_remaining, l.window_start_utc, l.window_end_utc,
       l.local_start, l.local_end, l.dietary_flags,
       s.store_id, s.display_name, s.location, s.timezone, s.pickup_point_en, s.pickup_point_ar,
       coalesce(r.avg_rating, 0)::numeric(3,2) as rating,
       coalesce(r.rating_count, 0) as rating_count
from listing l
join store s on s.store_id = l.store_id
left join (select store_id, avg(rating) avg_rating, count(*) rating_count
           from review where published group by store_id) r on r.store_id = s.store_id
where l.status = 'active'
  and s.paused_until is null and s.permanently_closed_at is null
  and l.window_end_utc > now()
  and l.quantity_remaining > 0;

create view v_ledger_balance as
select market, currency, account,
       sum(case when entry_type = 'debit' then amount_minor else -amount_minor end) as balance_minor
from financial_entry group by market, currency, account;
