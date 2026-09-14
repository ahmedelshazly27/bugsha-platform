-- ============================================================================
-- Client surface the design-system screens need and the RPCs did not expose.
-- Targets bugsha-dev (fxjvxmuporiwpqalbddv). Requires 20260914111830_partner_code_status_history.
-- APPLIED to bugsha-dev on 2026-09-14 as version 20260914133248.
--
--   my_profile()        + restricted_until, restriction_reason_code, deletion_requested_at   (S-C-064, S-C-042)
--   cancel_deletion()   undo inside the deletion clock                                         (S-C-042)
--   my_partner(uuid)    + suspended_until, suspend_reason_code, activated_at, contract bearers, history (P-010)
--   my_quality_flags()  the partner's open and acknowledged quality flags                       (Console · Quality)
--   my_disputes()       customer reports on the partner's orders, with the partner's statement (Console · Quality)
--   respond_dispute()   the partner's written statement, before the deadline
-- ============================================================================

create or replace function app.my_profile() returns jsonb
language sql stable security definer set search_path to '' as $$
  select jsonb_build_object('first_name', c.first_name, 'last_name', c.last_name, 'email', c.email, 'phone', c.phone, 'market', c.market, 'city_id', c.city_id,
    'dietary_flags', c.dietary_flags, 'allergen_ack', c.allergen_ack_at is not null, 'locale', u.locale, 'no_show_count_90d', c.no_show_count_90d,
    'city_name_en', ci.name_en, 'city_name_ar', ci.name_ar,
    'restricted_until', case when c.restricted_until > now() then c.restricted_until end, 'restriction_reason_code', case when c.restricted_until > now() then c.restriction_reason_code end,
    'deletion_requested_at', c.deletion_requested_at,
    'deletion_scheduled_for', case when c.deletion_requested_at is not null then c.deletion_requested_at + make_interval(days => coalesce(mc.deletion_clock_days, 30)) end)
  from public.consumer_profile c join public.app_user u on u.id = c.user_id left join public.city ci on ci.id = c.city_id left join public.market_config mc on mc.market = c.market
  where c.user_id = auth.uid();
$$;

create or replace function app.cancel_deletion() returns jsonb
language plpgsql security definer set search_path to '' as $$
declare c public.consumer_profile;
begin
  if auth.uid() is null then raise exception 'sign in' using errcode = 'BG100'; end if;
  update public.consumer_profile set deletion_requested_at = null where user_id = auth.uid() and deletion_requested_at is not null returning * into c;
  if not found then raise exception 'no deletion is scheduled' using errcode = 'BG110'; end if;
  return jsonb_build_object('cancelled', true);
end $$;
revoke all on function app.cancel_deletion() from public, anon;
grant execute on function app.cancel_deletion() to authenticated;

create or replace function app.my_partner(p_partner uuid) returns jsonb
language sql stable security definer set search_path to '' as $$
  select jsonb_build_object('partner_id', p.partner_id, 'trading_name', p.trading_name, 'legal_name', p.legal_name, 'market', p.market, 'onboarding_status', p.onboarding_status, 'reliability_score', p.reliability_score,
    'activated_at', p.activated_at, 'suspended_until', p.suspended_until, 'suspend_reason_code', p.suspend_reason_code,
    'contract', (select jsonb_build_object('id', c.id, 'version', c.version, 'commission_bp', c.commission_bp, 'payout_cadence', c.payout_cadence, 'payout_min_minor', c.payout_min_minor, 'accepted_at', c.accepted_at, 'cash_settlement_mode', c.cash_settlement_mode,
        'psp_fee_bearer', c.psp_fee_bearer, 'chargeback_bearer', c.chargeback_bearer, 'no_show_policy', c.no_show_policy, 'effective_from', c.effective_from)
      from public.partner_contract c where c.partner_id = p.partner_id order by c.version desc limit 1),
    'stores', (select coalesce(jsonb_agg(jsonb_build_object('store_id', s.store_id, 'display_name', s.display_name, 'paused_until', s.paused_until, 'pause_reason_code', s.pause_reason_code)), '[]') from public.store s where s.partner_id = p.partner_id and s.permanently_closed_at is null),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('from', h.from_status, 'to', h.to_status, 'at', h.at, 'reason_code', h.reason_code, 'reason_text', h.reason_text) order by h.at desc), '[]') from (select * from public.partner_status_history where partner_id = p.partner_id order by at desc limit 12) h))
  from public.partner p where p.partner_id = p_partner and app.can_partner(p_partner, array['owner','manager','accountant','staff']::public.partner_role[]);
$$;

create or replace function app.my_quality_flags(p_partner uuid)
returns table(id uuid, store_id uuid, store_name text, order_code text, source text, category text, body text, severity text, ack_deadline timestamptz, acknowledged_at timestamptz, acknowledgement_text text, escalated_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path to '' as $$
  select f.id, f.store_id, s.display_name, o.code, f.source::text, f.category::text, f.body, f.severity::text, f.ack_deadline, f.acknowledged_at, f.acknowledgement_text, f.escalated_at, f.created_at
  from public.quality_flag f join public.store s on s.store_id = f.store_id left join public."order" o on o.order_id = f.order_id
  where f.partner_id = p_partner and app.can_partner(p_partner, array['owner','manager']::public.partner_role[])
  order by f.acknowledged_at nulls first, f.created_at desc;
$$;
revoke all on function app.my_quality_flags(uuid) from public, anon;
grant execute on function app.my_quality_flags(uuid) to authenticated;

create or replace function app.my_disputes(p_partner uuid)
returns table(id uuid, case_ref text, order_code text, store_name text, category text, severity text, consumer_statement text, partner_statement text, partner_deadline timestamptz, opened_at timestamptz, resolved_at timestamptz, resolution text)
language sql stable security definer set search_path to '' as $$
  select d.id, d.case_ref, o.code, s.display_name, d.category::text, d.severity::text, d.consumer_statement, d.partner_statement, d.partner_deadline, d.opened_at, d.resolved_at, d.resolution
  from public.dispute d join public."order" o on o.order_id = d.order_id join public.store s on s.store_id = o.store_id
  where o.partner_id = p_partner and app.can_partner(p_partner, array['owner','manager']::public.partner_role[])
  order by d.resolved_at nulls first, d.opened_at desc;
$$;
revoke all on function app.my_disputes(uuid) from public, anon;
grant execute on function app.my_disputes(uuid) to authenticated;

create or replace function app.respond_dispute(p_dispute uuid, p_statement text) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare d public.dispute; o public."order";
begin
  select * into d from public.dispute where id = p_dispute for update;
  if not found then raise exception 'unknown dispute' using errcode = 'BG102'; end if;
  select * into o from public."order" where order_id = d.order_id;
  if not app.can_store(o.store_id, array['owner','manager']::public.partner_role[]) then raise exception 'not authorised' using errcode = 'BG100'; end if;
  if d.resolved_at is not null then raise exception 'dispute already resolved' using errcode = 'BG110'; end if;
  if length(coalesce(p_statement, '')) < 10 then raise exception 'statement required' using errcode = 'BG102'; end if;
  update public.dispute set partner_statement = p_statement where id = p_dispute;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function app.respond_dispute(uuid, text) from public, anon;
grant execute on function app.respond_dispute(uuid, text) to authenticated;
