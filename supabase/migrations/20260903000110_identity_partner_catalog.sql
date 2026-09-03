set search_path = public, extensions;

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

