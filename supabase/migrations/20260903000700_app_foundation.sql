-- ============================================================================
-- Shared mutation infrastructure (docs/07-api.md "Conventions", §four-eyes).
-- Implemented ONCE so every app.* function behaves identically.
-- ============================================================================
set search_path = public, extensions;

-- ─── Rounding: the plpgsql twin of core/money.ts roundHalfUp ────────────────
-- Change both or neither (05-money.md §1.5). Ledger test L18 asserts they
-- agree across 10,000 inputs, including factors where round-half-up and
-- round-half-to-even diverge. Integer arithmetic throughout: the factor is
-- scaled to a bigint before it touches the amount, so no float ever holds a
-- money value.
create or replace function app.round_half_up(p_minor bigint, p_factor numeric)
returns bigint language sql immutable set search_path = '' as $$
  select case
    when (p_minor * (round(p_factor * 1000000))::bigint) % 1000000 * 2 >= 1000000
      then (p_minor * (round(p_factor * 1000000))::bigint) / 1000000 + 1
      else (p_minor * (round(p_factor * 1000000))::bigint) / 1000000
  end;
$$;

comment on function app.round_half_up is
  'Round-half-up at the minor unit. Mirrors roundHalfUp in packages/core/src/money.ts exactly.';

create or replace function app.commission_of(p_base bigint, p_bp integer)
returns bigint language sql immutable set search_path = '' as $$
  select app.round_half_up(p_base, p_bp::numeric / 10000);
$$;

-- ─── Commission resolution ─────────────────────────────────────────────────
-- The contract version in force AT AN INSTANT. Never "the current one":
-- changing a rate today can never restate last month (05-money.md §1.4).
create or replace function app.resolve_commission(p_partner uuid, p_at timestamptz)
returns public.partner_contract language sql stable set search_path = '' as $$
  select c.* from public.partner_contract c
  where c.partner_id = p_partner
    and c.effective_from <= p_at::date
    and (c.effective_to is null or c.effective_to >= p_at::date)
  order by c.version desc
  limit 1;
$$;

-- ─── Idempotency ───────────────────────────────────────────────────────────
-- Same key + same payload      -> return the stored response.
-- Same key + different payload -> BG101. Retention 30 days.
create or replace function app.idempotent_replay(
  p_key text, p_operation text, p_request jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.idempotency_key; v_hash text;
begin
  if p_key is null then
    raise exception 'idempotency key is required' using errcode = 'BG101';
  end if;
  v_hash := encode(extensions.digest(p_request::text, 'sha256'), 'hex');

  select * into v_row from public.idempotency_key where key = p_key;
  if not found then
    insert into public.idempotency_key (key, actor, operation, request_hash)
    values (p_key, auth.uid(), p_operation, v_hash);
    return null;                       -- caller proceeds and records the result
  end if;

  if v_row.request_hash <> v_hash then
    raise exception 'idempotency key reused with a different payload'
      using errcode = 'BG101';
  end if;
  -- A replay that arrived before the first call finished has no response yet.
  return coalesce(v_row.response, '{"pending":true}'::jsonb);
end $$;

create or replace function app.idempotent_record(p_key text, p_response jsonb)
returns void language sql security definer set search_path = '' as $$
  update public.idempotency_key set response = p_response where key = p_key;
$$;

-- ─── Four eyes ─────────────────────────────────────────────────────────────
create table if not exists pending_approval (
  id uuid primary key default uuid_generate_v4(),
  operation text not null,
  target_id uuid,
  payload_hash text not null,
  first_actor uuid not null,
  first_at timestamptz not null default now(),
  second_actor uuid,
  second_at timestamptz,
  consumed_at timestamptz,
  unique (operation, target_id, payload_hash, first_actor)
);
alter table pending_approval enable row level security;
alter table pending_approval force row level security;
create policy ops_pending_approval on pending_approval for select using (app.is_ops());

-- NOTE: the working definition of app.require_four_eyes lives in
-- 20260903001200_four_eyes_durable.sql — see DECISION D15 for why it returns
-- its verdict instead of raising.

/** Money operations re-authenticate regardless of session age -> BG131. */
create or replace function app.require_recent_auth(p_max_age interval default '5 minutes')
returns void language plpgsql stable set search_path = '' as $$
declare v_auth_time bigint;
begin
  v_auth_time := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'auth_time', '')::bigint;
  if v_auth_time is null or to_timestamp(v_auth_time) < now() - p_max_age then
    raise exception 're-authentication required for this operation'
      using errcode = 'BG131';
  end if;
end $$;

create or replace function app.audit(
  p_operation text, p_target_type text, p_target uuid,
  p_before jsonb default null, p_after jsonb default null,
  p_reason_code text default null, p_justification text default null,
  p_market public.market default null
) returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor_user, actor_role, operation, target_type, target_id,
                                before, after, reason_code, justification, market)
  values (auth.uid(), coalesce(app.ops_role()::text, 'partner'), p_operation,
          p_target_type, p_target, p_before, p_after, p_reason_code, p_justification, p_market);
$$;

grant execute on function app.round_half_up, app.commission_of to authenticated, anon;
