set search_path = public, extensions;

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
language plpgsql set search_path = '' as $$
begin
  raise exception 'financial_entry is append-only; post a reversing entry instead'
    using errcode = 'BG001';
end $$;
create trigger ledger_no_update before update or delete on financial_entry
  for each row execute function app.forbid_ledger_mutation();

-- Balance invariant: per transaction_id, per currency, debits = credits.
-- DEFERRABLE so a multi-statement posting function can build a transaction.
-- DECISION D10: search_path pinned and tables schema-qualified. A trigger
-- function inherits the CALLER's search_path, so an unqualified name here fails
-- (42P01) the moment the trigger fires inside a `security definer ... set
-- search_path = ''` function — which 01-architecture.md §5 requires of every
-- mutation. It also closes a search_path capture hole.
create or replace function app.assert_transaction_balanced() returns trigger
language plpgsql set search_path = '' as $$
declare v_drift record;
begin
  for v_drift in
    select currency,
           sum(case when entry_type='debit' then amount_minor else -amount_minor end) as delta
    from public.financial_entry where transaction_id = new.transaction_id
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
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.accounting_period p
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
language plpgsql set search_path = '' as $$
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
