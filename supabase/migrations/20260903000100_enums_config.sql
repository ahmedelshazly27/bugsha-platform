-- Derived from docs/03-schema.sql §1-2. Deviations are marked DECISION Dn.
set search_path = public, extensions;

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
-- Two problems: Postgres does not permit expressions in a PRIMARY KEY, and the
-- coalesce trick will not work in a unique index either, because casting an
-- enum to text is STABLE, not IMMUTABLE (42P17).
-- The sentinels existed only to make NULLs compare equal, which Postgres 15+
-- expresses directly. This is the spec's intent, stated in the grammar:
-- one flag row per (key, market, city, cohort) scope, NULL meaning "any".
create unique index feature_flag_scope_key on feature_flag
  (key, market, city_id, cohort) nulls not distinct;

