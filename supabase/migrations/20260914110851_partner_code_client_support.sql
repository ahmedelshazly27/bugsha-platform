-- ============================================================================
-- Partner-code gate: client support.
--
-- Targets bugsha-dev (fxjvxmuporiwpqalbddv). Requires 20260914095840_partner_code_email.
-- APPLIED to bugsha-dev on 2026-09-14 as version 20260914110851.
--
-- 1. The gate's error codes move off BG130–BG136: on the platform BG130 is
--    "four-eyes required" and BG131 "re-auth required" (docs/07-api.md), so a
--    client would have shown the wrong copy. New, unused codes:
--      BG122  a valid partner code is required / the code is not live
--      BG123  the code was issued for another market
--      BG124  request or code not found
--      BG125  a code was already issued for this request
--      BG126  the code was already redeemed (revoke refused — suspend the partner)
--      BG127  the request was declined
--      BG128  the code is no longer live (resend refused)
-- 2. app.my_partners() — the partner app's post-sign-in question: "does this
--    account belong to a partner that has no store yet?" (an applicant mid-onboarding).
--    my_stores_detail() returns nothing until a branch exists, so the app needs this
--    to route to the setup checklist instead of the store picker.
-- ============================================================================

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
    raise exception 'a valid partner code is required to open a partner account' using errcode = 'BG122';
  end if;
  if c.market <> p_market then
    raise exception 'this code was issued for market %', c.market using errcode = 'BG123';
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

create or replace function app.ops_issue_partner_code(p_request uuid, p_days integer default 14, p_reason text default null)
returns public.partner_invite_code language plpgsql security definer set search_path to '' as $$
declare r public.partner_request; c public.partner_invite_code; v_code text; v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  perform app.ops_require(array['ops_manager','admin']::public.ops_role[]);
  select * into r from public.partner_request where id = p_request for update;
  if not found then raise exception 'request not found' using errcode = 'BG124'; end if;
  if r.status = 'code_issued' then raise exception 'a code was already issued for this request' using errcode = 'BG125'; end if;
  if r.status = 'declined' then raise exception 'this request was declined' using errcode = 'BG127'; end if;
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
  if not found then raise exception 'code not found' using errcode = 'BG124'; end if;
  if c.redeemed_at is not null then raise exception 'code already redeemed — suspend the partner instead' using errcode = 'BG126'; end if;
  update public.partner_invite_code set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = p_reason where code = c.code;
  update public.partner_request set status = 'contacted', invite_code = null, updated_at = now() where invite_code = c.code;
  perform app.audit('ops_revoke_partner_code', 'partner_invite_code', null, null, jsonb_build_object('code', c.code), null, p_reason, c.market);
end $$;

create or replace function app.ops_decline_partner_request(p_request uuid, p_reason_code text, p_text text default null)
returns void language plpgsql security definer set search_path to '' as $$
declare r public.partner_request;
begin
  perform app.ops_require(array['ops_manager','admin']::public.ops_role[]);
  select * into r from public.partner_request where id = p_request for update;
  if not found then raise exception 'request not found' using errcode = 'BG124'; end if;
  update public.partner_request set status = 'declined', decline_reason = p_reason_code, notes = coalesce(p_text, notes), updated_at = now() where id = p_request;
  perform app.audit('ops_decline_partner_request', 'partner_request', p_request, null, null, p_reason_code, p_text, r.market);
end $$;

create or replace function app.ops_resend_partner_code(p_code text) returns void
language plpgsql security definer set search_path to '' as $$
declare c public.partner_invite_code;
begin
  perform app.ops_require(array['ops_manager','admin']::public.ops_role[]);
  select * into c from public.partner_invite_code where code = upper(p_code);
  if not found then raise exception 'code not found' using errcode = 'BG124'; end if;
  if c.revoked_at is not null or c.redeemed_at is not null or c.expires_at < now() then
    raise exception 'code is no longer live' using errcode = 'BG128';
  end if;
  perform app.partner_code_email_request(c.code);
  perform app.audit('ops_resend_partner_code', 'partner_invite_code', null, null, jsonb_build_object('code', c.code), null, null, c.market);
end $$;

-- 2. the partner app's post-sign-in lookup
create or replace function app.my_partners()
returns table(partner_id uuid, trading_name text, market public.market, onboarding_status public.onboarding_status, role public.partner_role, store_count integer)
language sql stable security definer set search_path to '' as $$
  select p.partner_id, p.trading_name, p.market, p.onboarding_status, a.role,
         (select count(*)::int from public.store s where s.partner_id = p.partner_id and s.permanently_closed_at is null)
  from public.staff_assignment a
  join public.partner p on p.partner_id = a.partner_id
  where a.user_id = auth.uid() and a.revoked_at is null and a.partner_wide
  order by p.created_at desc;
$$;
revoke all on function app.my_partners() from public, anon;
grant execute on function app.my_partners() to authenticated;
