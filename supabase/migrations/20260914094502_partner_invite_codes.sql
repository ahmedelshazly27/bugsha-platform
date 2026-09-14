-- ============================================================================
-- Code-gated partner sign-up — invite codes, request queue, ops actions.
--
-- Targets the platform Supabase project (bugsha-dev, ref fxjvxmuporiwpqalbddv),
-- whose migration history lives in ahmedelshazly27/bugsha-platform.
-- APPLIED to bugsha-dev on 2026-09-14 as version 20260914094502. Copy this file, together with
-- ../migrations/20260914090455_waitlist_and_partner_request.sql, into
-- bugsha-platform/supabase/migrations/ so that repo's history matches the DB.
--
-- Requires: the waitlist migration above (public.partner_request), and the
-- platform schema as of 20260910155443_partner_activation_fixes
-- (public.market, public.ops_user, app.ops_require, app.audit, app.valid_phone,
-- app.is_ops, app.current_markets, public.reason_code).
--
-- What it does
--   1. public.partner_invite_code — the single-use BG-XXXX-XXXX codes Ops issues.
--   2. public.partner_request      — the website's request table, reconciled so the
--                                    ops console reads one queue (market becomes the
--                                    enum, owner + invite-code link added).
--   3. app.check_partner_code      — what the partner app calls on the "Enter your
--                                    partner code" screen (anon-safe).
--   4. app.submit_application      — now REQUIRES a valid code and redeems it.
--                                    Without a code the call is rejected (BG130).
--                                    The code-less signature is dropped.
--   5. app.ops_issue_partner_code / ops_revoke_partner_code /
--      ops_decline_partner_request / ops_partner_requests / ops_partner_codes
--                                  — the ops console actions, audited.
--
-- Emailing the code to the kitchen is NOT done here: the kitchen has no app
-- user yet, so app.notify() cannot address it. The ops console sends the email
-- (the code, expiry and email are on the returned row). Rollback: see
-- rollback_20260914094502_partner_invite_codes.sql.
-- ============================================================================

-- 1. invite codes -------------------------------------------------------------
create table if not exists public.partner_invite_code (
  code            text primary key,                                   -- BG-XXXX-XXXX
  market          public.market not null,
  request_id      uuid references public.partner_request(id),         -- nullable: ops can issue ad hoc
  issued_to_name  text not null,                                      -- trading name shown on the code screen
  issued_to_email extensions.citext not null,
  legal_name      text,
  trading_name    text,
  issued_by       uuid not null references public.ops_user(user_id),
  issued_at       timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '14 days',
  redeemed_at     timestamptz,
  redeemed_by     uuid references auth.users(id),
  partner_id      uuid references public.partner(partner_id),
  revoked_at      timestamptz,
  revoked_by      uuid references public.ops_user(user_id),
  revoke_reason   text,
  constraint partner_invite_code_shape check (code ~ '^BG-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$')
);
create index if not exists partner_invite_code_email_idx on public.partner_invite_code (issued_to_email);
alter table public.partner_invite_code enable row level security;
-- No policies: reads and writes go through app.* SECURITY DEFINER functions.

-- 2. reconcile the website's request table with the platform ------------------
alter table public.partner_request drop constraint if exists partner_request_market_check;
alter table public.partner_request alter column market type public.market using market::public.market;
alter table public.partner_request add column if not exists owner_ops_user uuid references public.ops_user(user_id);
alter table public.partner_request drop constraint if exists partner_request_invite_code_fkey;
alter table public.partner_request add constraint partner_request_invite_code_fkey
  foreign key (invite_code) references public.partner_invite_code(code);

-- 3. code check for the partner app -------------------------------------------
-- Returns the pre-fill for the application form, or a status the client maps to
-- copy: 'invalid' | 'expired' | 'redeemed' | 'revoked'. Callable by anon so the
-- screen works before sign-in; rate-limit at the edge (5/min/IP).
create or replace function app.check_partner_code(p_code text)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare c public.partner_invite_code; v_code text := upper(regexp_replace(coalesce(p_code,''), '[^A-Za-z0-9]', '', 'g'));
begin
  if length(v_code) = 10 then v_code := 'BG-' || substr(v_code, 3, 4) || '-' || substr(v_code, 7, 4); end if;
  select * into c from public.partner_invite_code where code = v_code;
  if not found then return jsonb_build_object('status', 'invalid'); end if;
  if c.revoked_at is not null then return jsonb_build_object('status', 'revoked'); end if;
  if c.redeemed_at is not null then return jsonb_build_object('status', 'redeemed'); end if;
  if c.expires_at < now() then return jsonb_build_object('status', 'expired'); end if;
  return jsonb_build_object('status', 'ok', 'code', c.code, 'market', c.market, 'trading_name', c.trading_name,
    'legal_name', c.legal_name, 'issued_to_name', c.issued_to_name);
end $$;
revoke all on function app.check_partner_code(text) from public;
grant execute on function app.check_partner_code(text) to anon, authenticated;

-- 4. submit_application now requires the code ----------------------------------
-- Same body as 20260903141723_phase3_onboarding_and_partner_surface, plus p_code.
create or replace function app.submit_application(
  p_code text,
  p_market public.market, p_legal_name text, p_trading_name text, p_categories text[],
  p_contact_name text, p_contact_phone text, p_contact_email text, p_city_id uuid,
  p_branch_count integer default 1, p_referral_source text default null, p_est_daily_surplus_minor bigint default null)
returns public.partner language plpgsql security definer set search_path to '' as $$
declare v_row public.partner; v_uid uuid := auth.uid(); c public.partner_invite_code;
begin
  if v_uid is null then raise exception 'sign in to apply' using errcode = 'BG100'; end if;
  select * into c from public.partner_invite_code where code = upper(p_code) for update;
  if not found or c.revoked_at is not null or c.redeemed_at is not null or c.expires_at < now() then
    raise exception 'a valid partner code is required to open a partner account' using errcode = 'BG130';
  end if;
  if c.market <> p_market then
    raise exception 'this code was issued for market %', c.market using errcode = 'BG131';
  end if;
  if not app.valid_phone(p_market, p_contact_phone) then
    raise exception 'contact phone does not belong to market %', p_market using errcode = 'BG102';
  end if;
  if 'alcohol' = any(coalesce(p_categories, '{}')) then
    raise exception 'alcohol is never listed' using errcode = 'BG105';
  end if;
  insert into public.partner (market, legal_name, trading_name, categories, onboarding_status,
    branch_count, contact_name, contact_role, contact_phone, contact_email, city_id, referral_source, est_daily_surplus_minor, owner_ops_user)
  values (p_market, p_legal_name, p_trading_name, coalesce(p_categories,'{}'), 'applied',
    p_branch_count, p_contact_name, 'owner', p_contact_phone, p_contact_email, p_city_id, coalesce(p_referral_source, 'partner_code'), p_est_daily_surplus_minor, c.issued_by)
  returning * into v_row;
  update public.partner_invite_code set redeemed_at = now(), redeemed_by = v_uid, partner_id = v_row.partner_id where code = c.code;
  insert into public.partner_user (user_id, full_name, phone) values (v_uid, p_contact_name, p_contact_phone) on conflict (user_id) do nothing;
  insert into public.staff_assignment (user_id, partner_id, store_id, role, partner_wide, claimed_at)
  values (v_uid, v_row.partner_id, null, 'owner', true, now());
  insert into public.partner_status_history (partner_id, from_status, to_status, actor, reason_code)
  values (v_row.partner_id, 'lead', 'applied', v_uid, 'partner_code:' || c.code);
  return v_row;
end $$;
-- Retire the code-less signature so no client can bypass the gate.
drop function if exists app.submit_application(public.market, text, text, text[], text, text, text, uuid, integer, text, bigint);

-- 5. ops actions -----------------------------------------------------------------
create or replace function app.ops_issue_partner_code(p_request uuid, p_days integer default 14, p_reason text default null)
returns public.partner_invite_code language plpgsql security definer set search_path to '' as $$
declare r public.partner_request; c public.partner_invite_code; v_code text; v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  perform app.ops_require(array['ops_manager','admin']::public.ops_role[]);
  select * into r from public.partner_request where id = p_request for update;
  if not found then raise exception 'request not found' using errcode = 'BG132'; end if;
  if r.status = 'code_issued' then raise exception 'a code was already issued for this request' using errcode = 'BG133'; end if;
  if r.status = 'declined' then raise exception 'this request was declined' using errcode = 'BG135'; end if;
  loop
    v_code := 'BG-' || (select string_agg(substr(v_alphabet, 1 + floor(random() * 32)::int, 1), '') from generate_series(1, 4))
                    || '-' || (select string_agg(substr(v_alphabet, 1 + floor(random() * 32)::int, 1), '') from generate_series(1, 4));
    exit when not exists (select 1 from public.partner_invite_code where code = v_code);
  end loop;
  insert into public.partner_invite_code (code, market, request_id, issued_to_name, issued_to_email, legal_name, trading_name, issued_by, expires_at)
  values (v_code, r.market, r.id, r.trading_name, r.contact_email, r.legal_name, r.trading_name, auth.uid(), now() + make_interval(days => greatest(1, p_days)))
  returning * into c;
  update public.partner_request
     set status = 'code_issued', invite_code = v_code, code_issued_at = now(), code_issued_by = auth.uid()::text,
         owner_ops_user = coalesce(owner_ops_user, auth.uid()), updated_at = now()
   where id = r.id;
  perform app.audit('ops_issue_partner_code', 'partner_request', r.id, null, jsonb_build_object('code', v_code, 'expires_at', c.expires_at), null, p_reason, r.market);
  return c;
end $$;

create or replace function app.ops_revoke_partner_code(p_code text, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare c public.partner_invite_code;
begin
  perform app.ops_require(array['ops_manager','admin']::public.ops_role[]);
  select * into c from public.partner_invite_code where code = upper(p_code) for update;
  if not found then raise exception 'code not found' using errcode = 'BG132'; end if;
  if c.redeemed_at is not null then raise exception 'code already redeemed — suspend the partner instead' using errcode = 'BG134'; end if;
  update public.partner_invite_code set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = p_reason where code = c.code;
  -- Let the request be issued a fresh code.
  update public.partner_request set status = 'contacted', invite_code = null, updated_at = now() where invite_code = c.code;
  perform app.audit('ops_revoke_partner_code', 'partner_invite_code', null, null, jsonb_build_object('code', c.code), null, p_reason, c.market);
end $$;

create or replace function app.ops_decline_partner_request(p_request uuid, p_reason_code text, p_text text default null)
returns void language plpgsql security definer set search_path to '' as $$
declare r public.partner_request;
begin
  perform app.ops_require(array['ops_manager','admin']::public.ops_role[]);
  select * into r from public.partner_request where id = p_request for update;
  if not found then raise exception 'request not found' using errcode = 'BG132'; end if;
  update public.partner_request set status = 'declined', decline_reason = p_reason_code, notes = coalesce(p_text, notes), updated_at = now() where id = p_request;
  perform app.audit('ops_decline_partner_request', 'partner_request', p_request, null, null, p_reason_code, p_text, r.market);
end $$;

create or replace function app.ops_partner_requests(p_status text default null, p_market public.market default null)
returns setof public.partner_request language sql stable security definer set search_path to '' as $$
  select * from public.partner_request
  where app.is_ops() and market = any(app.current_markets())
    and (p_status is null or status = p_status) and (p_market is null or market = p_market)
  order by created_at desc;
$$;

create or replace function app.ops_partner_codes(p_market public.market default null)
returns setof public.partner_invite_code language sql stable security definer set search_path to '' as $$
  select * from public.partner_invite_code
  where app.is_ops() and market = any(app.current_markets()) and (p_market is null or market = p_market)
  order by issued_at desc;
$$;

-- reason codes for the new domain
insert into public.reason_code (code, domain, label_en, label_ar_kw, label_ar_eg, requires_free_text, active) values
  ('category_not_eligible', 'partner_request', 'Category not eligible', 'الفئة غير مؤهلة', 'الفئة غير مؤهلة', false, true),
  ('outside_launch_area',   'partner_request', 'Outside launch area',   'خارج منطقة الإطلاق', 'خارج منطقة الإطلاق', false, true),
  ('duplicate',             'partner_request', 'Duplicate request',     'طلب مكرر', 'طلب مكرر', false, true),
  ('no_response',           'partner_request', 'No response',           'ما فيه رد', 'مفيش رد', false, true),
  ('other',                 'partner_request', 'Other',                 'غير', 'تاني', true, true)
on conflict do nothing;
