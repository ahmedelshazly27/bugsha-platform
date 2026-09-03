set search_path = public, extensions;

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

