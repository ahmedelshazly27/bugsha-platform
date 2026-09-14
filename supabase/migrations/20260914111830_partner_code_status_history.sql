-- ============================================================================
-- Fix: submit_application wrote 'partner_code:<code>' into partner_status_history.reason_code,
-- which has a foreign key to reason_code — every code-gated sign-up failed with 23503.
-- Caught by supabase/tests/10_partner_codes.sql (C-15) run against bugsha-dev.
-- Requires 20260914110851_partner_code_client_support.
-- APPLIED to bugsha-dev on 2026-09-14 as version 20260914111830.
--
-- The status row now uses the registered reason 'partner_code' and keeps the code itself in
-- reason_text.
-- ============================================================================

insert into public.reason_code (code, domain, label_en, label_ar_kw, label_ar_eg, requires_free_text, active)
values ('partner_code', 'partner_status', 'Opened with a partner code', 'فُتح برمز شريك', 'اتفتح بكود شريك', false, true)
on conflict do nothing;

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
  insert into public.partner_status_history (partner_id, from_status, to_status, actor, reason_code, reason_text)
  values (v_row.partner_id, 'lead', 'applied', v_uid, 'partner_code', c.code);
  return v_row;
end $$;
