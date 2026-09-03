-- Phase 12 — ops console operations (docs/07-api.md §Ops). Every mutation is a
-- named operation, reason-coded and audited. Nothing edits a record directly.
set search_path = public, extensions;

create or replace function app.ops_require(p_roles public.ops_role[]) returns void language plpgsql stable set search_path = '' as $$
begin if not app.is_ops(p_roles) then raise exception 'not authorised' using errcode = 'BG100'; end if; end $$;

-- ─── Partner lifecycle ──────────────────────────────────────────────────────
create or replace function app.ops_partners(p_status public.onboarding_status default null, p_market public.market default null)
returns setof public.partner language sql stable security definer set search_path = '' as $$
  select * from public.partner where app.is_ops() and market = any(app.current_markets())
    and (p_status is null or onboarding_status = p_status) and (p_market is null or market = p_market) order by created_at desc;
$$;
create or replace function app.ops_partner_detail(p_partner uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('partner', to_jsonb(p),
    'stores', (select coalesce(jsonb_agg(to_jsonb(s) - 'location' - 'geocoded_location'), '[]') from public.store s where s.partner_id = p.partner_id),
    'contracts', (select coalesce(jsonb_agg(to_jsonb(c) order by c.version desc), '[]') from public.partner_contract c where c.partner_id = p.partner_id),
    'documents', (select coalesce(jsonb_agg(to_jsonb(d)), '[]') from public.partner_document d where d.partner_id = p.partner_id),
    'history', (select coalesce(jsonb_agg(to_jsonb(h) order by h.at), '[]') from public.partner_status_history h where h.partner_id = p.partner_id),
    'staff', (select coalesce(jsonb_agg(jsonb_build_object('user_id', a.user_id, 'name', u.full_name, 'role', a.role, 'store_id', a.store_id, 'revoked', a.revoked_at is not null)), '[]')
      from public.staff_assignment a join public.partner_user u on u.user_id = a.user_id where a.partner_id = p.partner_id),
    'reliability', app.reliability(p.partner_id), 'health', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.partner_health_task t where t.partner_id = p.partner_id and t.resolved_at is null))
  from public.partner p where p.partner_id = p_partner and app.is_ops() and p.market = any(app.current_markets());
$$;

create or replace function app.ops_approve_partner(p_partner uuid, p_reason text)
returns public.partner language plpgsql security definer set search_path = '' as $$
declare p public.partner;
begin
  perform app.ops_require(array['ops_manager','admin']::public.ops_role[]);
  select * into p from public.partner where partner_id = p_partner;
  if exists (select 1 from public.market_document_requirement r where r.market = p.market and not r.per_store
      and not exists (select 1 from public.partner_document d where d.partner_id = p_partner and d.doc_type = r.doc_type and d.status = 'approved')) then
    raise exception 'required documents are not all approved' using errcode = 'BG110';
  end if;
  perform app.transition_partner(p_partner, 'approved', null, p_reason);
  -- Contract is issued at the market default rate; a renegotiation is a NEW version.
  insert into public.partner_contract (partner_id, version, commission_bp, payout_cadence, payout_min_minor, effective_from)
  select p_partner, 1, mc.default_commission_bp, mc.payout_cadence, mc.payout_min_minor, current_date from public.market_config mc where mc.market = p.market
  on conflict (partner_id, version) do nothing;
  perform app.transition_partner(p_partner, 'contract_pending');
  perform app.audit('ops_approve_partner', 'partner', p_partner, null, null, null, p_reason, p.market);
  return (select x from public.partner x where x.partner_id = p_partner);
end $$;

create or replace function app.ops_reject_partner(p_partner uuid, p_reason_code text, p_text text)
returns public.partner language plpgsql security definer set search_path = '' as $$
begin
  perform app.ops_require(array['ops_manager','admin']::public.ops_role[]);
  perform app.transition_partner(p_partner, 'rejected', p_reason_code, p_text);   -- shown to the partner verbatim
  perform app.audit('ops_reject_partner', 'partner', p_partner, null, null, p_reason_code, p_text);
  return (select x from public.partner x where x.partner_id = p_partner);
end $$;

/** Four eyes. honour_existing keeps reserved orders redeemable. */
create or replace function app.ops_suspend_partner(p_partner uuid, p_reason_code text, p_until timestamptz, p_honour_existing boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_gate jsonb; l record;
begin
  perform app.ops_require(array['ops_manager','admin']::public.ops_role[]);
  v_gate := app.require_four_eyes('ops_suspend_partner', p_partner, jsonb_build_object('until', p_until, 'r', p_reason_code));
  if not (v_gate->>'approved')::boolean then return v_gate; end if;
  update public.partner set suspended_until = p_until, suspend_reason_code = p_reason_code where partner_id = p_partner;
  perform app.transition_partner(p_partner, 'suspended', p_reason_code);
  update public.store set paused_until = p_until, pause_reason_code = p_reason_code where partner_id = p_partner;
  if not p_honour_existing then
    for l in select listing_id from public.listing where partner_id = p_partner and status in ('active','sold_out') loop
      perform app.cancel_listing(l.listing_id, 'unexpected_closure', 'partner suspended');
    end loop;
  end if;
  perform app.audit('ops_suspend_partner', 'partner', p_partner, null, v_gate, p_reason_code);
  return jsonb_build_object('approved', true, 'partner_id', p_partner);
end $$;

create or replace function app.ops_reinstate_partner(p_partner uuid, p_reason text)
returns public.partner language plpgsql security definer set search_path = '' as $$
begin
  perform app.ops_require(array['ops_manager','admin']::public.ops_role[]);
  update public.partner set suspended_until = null, suspend_reason_code = null where partner_id = p_partner;
  update public.store set paused_until = null, pause_reason_code = null where partner_id = p_partner;
  perform app.transition_partner(p_partner, 'active', null, p_reason);
  perform app.audit('ops_reinstate_partner', 'partner', p_partner, null, null, null, p_reason);
  return (select x from public.partner x where x.partner_id = p_partner);
end $$;

/** A NEW CONTRACT VERSION, four eyes. Never UPDATE commission_bp. */
create or replace function app.ops_set_commission(p_partner uuid, p_bp integer, p_effective_from date, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_gate jsonb; c public.partner_contract; v_new public.partner_contract;
begin
  perform app.ops_require(array['ops_manager','finance','admin']::public.ops_role[]);
  v_gate := app.require_four_eyes('ops_set_commission', p_partner, jsonb_build_object('bp', p_bp, 'from', p_effective_from));
  if not (v_gate->>'approved')::boolean then return v_gate; end if;
  c := app.resolve_commission(p_partner, now());
  update public.partner_contract set effective_to = p_effective_from - 1 where id = c.id and effective_to is null;
  insert into public.partner_contract (partner_id, version, commission_bp, payout_cadence, payout_min_minor, psp_fee_bearer, chargeback_bearer, no_show_policy, cash_settlement_mode, effective_from)
  values (p_partner, c.version + 1, p_bp, c.payout_cadence, c.payout_min_minor, c.psp_fee_bearer, c.chargeback_bearer, c.no_show_policy, c.cash_settlement_mode, p_effective_from)
  returning * into v_new;
  perform app.audit('ops_set_commission', 'partner_contract', v_new.id, to_jsonb(c), to_jsonb(v_new), null, p_reason);
  return jsonb_build_object('approved', true, 'contract', to_jsonb(v_new));
end $$;

create or replace function app.ops_override_reliability(p_partner uuid, p_score numeric, p_justification text)
returns public.partner language plpgsql security definer set search_path = '' as $$
declare p public.partner;
begin
  perform app.ops_require(array['ops_manager','admin']::public.ops_role[]);
  if length(coalesce(p_justification,'')) < 10 then raise exception 'justification required' using errcode = 'BG132'; end if;
  update public.partner set reliability_override = p_score, reliability_override_reason = p_justification where partner_id = p_partner returning * into p;
  perform app.audit('ops_override_reliability', 'partner', p_partner, null, jsonb_build_object('score', p_score), null, p_justification);
  return p;
end $$;

/** Rejection text is sent to the partner VERBATIM. */
create or replace function app.ops_verify_document(p_doc uuid, p_approve boolean, p_reason_code text default null, p_text text default null)
returns public.partner_document language plpgsql security definer set search_path = '' as $$
declare d public.partner_document;
begin
  perform app.ops_require(array['compliance','ops_manager','admin']::public.ops_role[]);
  update public.partner_document set status = case when p_approve then 'approved' else 'rejected' end::public.doc_status,
    rejection_reason_code = case when p_approve then null else p_reason_code end, rejection_text = case when p_approve then null else p_text end,
    verified_by = auth.uid(), verified_at = now() where id = p_doc returning * into d;
  if not p_approve then perform app.transition_partner(d.partner_id, 'documents_pending', p_reason_code, p_text); end if;
  perform app.audit('ops_verify_document', 'partner_document', p_doc, null, to_jsonb(d), p_reason_code, p_text, d.market);
  return d;
end $$;

create or replace function app.ops_partner_health()
returns setof public.partner_health_task language sql stable security definer set search_path = '' as $$
  select t.* from public.partner_health_task t join public.partner p on p.partner_id = t.partner_id
  where app.is_ops() and p.market = any(app.current_markets()) and t.resolved_at is null order by t.severity desc, t.opened_at;
$$;
create or replace function app.ops_onboarding_funnel(p_from date, p_to date)
returns table (stage public.onboarding_status, partners bigint) language sql stable security definer set search_path = '' as $$
  select onboarding_status, count(*) from public.partner where app.is_ops() and market = any(app.current_markets())
    and created_at::date between p_from and p_to group by 1 order by 1;
$$;

-- ─── Marketplace ────────────────────────────────────────────────────────────
create or replace function app.ops_live_dashboard(p_market public.market)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'live_listings', (select count(*) from public.v_browse_listing where market = p_market),
    'bags_remaining', (select coalesce(sum(quantity_remaining),0) from public.v_browse_listing where market = p_market),
    'orders_today', (select count(*) from public."order" where market = p_market and created_at >= date_trunc('day', now())),
    'gmv_today_minor', (select coalesce(sum(total_minor),0) from public."order" where market = p_market and created_at >= date_trunc('day', now()) and status in ('reserved','redeemed')),
    'open_disputes', (select count(*) from public.dispute where market = p_market and resolved_at is null),
    'paused_stores', (select count(*) from public.store where market = p_market and paused_until > now()),
    'jobs_alerting', (select count(*) from app.ops_jobs() j where j.alerting))
  where app.is_ops() and p_market = any(app.current_markets());
$$;
create or replace function app.ops_supply_demand(p_market public.market, p_from date, p_to date)
returns table (day date, listings bigint, bags bigint, orders bigint, sell_through numeric) language sql stable security definer set search_path = '' as $$
  select l.local_date, count(distinct l.listing_id), sum(l.quantity_total), count(o.order_id),
         round(coalesce(sum(l.quantity_total - l.quantity_remaining)::numeric / nullif(sum(l.quantity_total),0),0),3)
  from public.listing l left join public."order" o on o.listing_id = l.listing_id and o.status in ('reserved','redeemed','no_show')
  where app.is_ops() and l.market = p_market and l.local_date between p_from and p_to group by 1 order by 1;
$$;
create or replace function app.ops_orders(p_market public.market default null, p_status public.order_status default null, p_code text default null, p_limit integer default 100)
returns setof public."order" language sql stable security definer set search_path = '' as $$
  select * from public."order" where app.is_ops() and market = any(app.current_markets())
    and (p_market is null or market = p_market) and (p_status is null or status = p_status) and (p_code is null or code ilike '%' || p_code || '%')
  order by created_at desc limit least(p_limit, 500);
$$;
create or replace function app.ops_order_detail(p_order uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select app.order_detail(p_order) || jsonb_build_object('ledger', (select coalesce(jsonb_agg(to_jsonb(e) order by e.recorded_at), '[]') from public.financial_entry e where e.order_id = p_order),
    'audit', (select coalesce(jsonb_agg(to_jsonb(a) order by a.at), '[]') from public.audit_log a where a.target_id = p_order))
  where app.is_ops();
$$;

create or replace function app.ops_force_redeem(p_order uuid, p_reason_code text, p_justification text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public."order"; r public.redemption;
begin
  perform app.ops_require(array['support_agent','ops_manager','admin']::public.ops_role[]);
  select * into o from public."order" where order_id = p_order for update;
  if o.status <> 'reserved' then raise exception 'order is %', o.status using errcode = 'BG110'; end if;
  insert into public.redemption (order_id, store_id, mechanism, staff_user_id, server_ts, idempotency_key) values (p_order, o.store_id, 'code_shown', null, now(), 'ops-force-' || p_order) returning * into r;
  update public."order" set status = 'redeemed', updated_at = now() where order_id = p_order;
  perform app.audit('ops_force_redeem', 'order', p_order, null, to_jsonb(r), p_reason_code, p_justification, o.market);
  return jsonb_build_object('redemption', to_jsonb(r));
end $$;

/** cost_bearer is explicit; the UI defaults to platform when the failure was ours (§3.7). Four eyes above the refund cap. */
create or replace function app.ops_force_cancel(p_order uuid, p_reason_code text, p_cost_bearer public.fee_bearer, p_justification text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public."order"; v_cfg public.market_config; v_gate jsonb; v_refund uuid; v_payment uuid;
begin
  perform app.ops_require(array['support_agent','ops_manager','admin']::public.ops_role[]);
  select * into o from public."order" where order_id = p_order for update;
  select * into v_cfg from public.market_config where market = o.market;
  if o.status not in ('held','reserved') then raise exception 'order is %', o.status using errcode = 'BG110'; end if;
  if o.total_minor > v_cfg.refund_cap_support_minor then
    v_gate := app.require_four_eyes('ops_force_cancel', p_order, jsonb_build_object('bearer', p_cost_bearer));
    if not (v_gate->>'approved')::boolean then return v_gate; end if;
  end if;
  perform app.restore_stock(o.listing_id, o.quantity);
  if o.payment_status = 'captured' then
    select payment_id into v_payment from public.payment where order_id = p_order limit 1;
    insert into public.refund (order_id, payment_id, amount_minor, destination, reason_code, cost_bearer, status, approved_by)
    values (p_order, v_payment, o.total_minor, 'source', p_reason_code, p_cost_bearer, 'approved', auth.uid()) returning refund_id into v_refund;
    perform app.post_refund(v_refund, true);
    -- Platform-borne: the partner is made whole via goodwill-equivalent expense rather than losing the payable.
    if p_cost_bearer = 'platform' then
      perform app.post_entries(extensions.uuid_generate_v4(), jsonb_build_array(
        jsonb_build_object('entry_type','debit','account','goodwill_expense','amount_minor', o.total_minor - o.commission_minor,'currency',o.currency,'market',o.market,'partner_id',o.partner_id,'order_id',o.order_id,'reference_type','adjustment','reference_id',o.order_id,'effective_at',now(),'reason_code',p_reason_code),
        jsonb_build_object('entry_type','credit','account','partner_payable','amount_minor', o.total_minor - o.commission_minor,'currency',o.currency,'market',o.market,'partner_id',o.partner_id,'order_id',o.order_id,'reference_type','adjustment','reference_id',o.order_id,'effective_at',now(),'reason_code',p_reason_code)));
    end if;
  end if;
  update public."order" set status = 'cancelled_partner', cancelled_at = now(), cancelled_reason_code = p_reason_code,
    payment_status = case when o.payment_status = 'captured' then 'refunded'::public.payment_status else o.payment_status end where order_id = p_order;
  perform app.audit('ops_force_cancel', 'order', p_order, to_jsonb(o), jsonb_build_object('cost_bearer', p_cost_bearer), p_reason_code, p_justification, o.market);
  return jsonb_build_object('approved', true, 'order_id', p_order, 'refund_id', v_refund);
end $$;

create or replace function app.ops_reissue_code(p_order uuid, p_reason_code text)
returns public."order" language plpgsql security definer set search_path = '' as $$
declare o public."order";
begin
  perform app.ops_require(array['support_agent','ops_manager','admin']::public.ops_role[]);
  update public."order" set code = app.generate_order_code(), updated_at = now() where order_id = p_order and status = 'reserved' returning * into o;
  if not found then raise exception 'only a reserved order gets a new code' using errcode = 'BG110'; end if;
  perform app.audit('ops_reissue_code', 'order', p_order, null, jsonb_build_object('code', o.code), p_reason_code, null, o.market);
  return o;
end $$;

/** Ambiguous return resolved from the provider's record: confirm on a reference, never on the return URL. */
create or replace function app.ops_reconcile_payment(p_payment uuid, p_provider_ref text, p_reason_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.payment; o public."order";
begin
  perform app.ops_require(array['finance','support_agent','ops_manager','admin']::public.ops_role[]);
  select * into p from public.payment where payment_id = p_payment for update;
  select * into o from public."order" where order_id = p.order_id for update;
  update public.payment set provider_ref = p_provider_ref, status = 'captured', captured_at = coalesce(captured_at, now()) where payment_id = p_payment;
  if o.status = 'held' then
    update public."order" set status = 'reserved', payment_status = 'captured', hold_expires_at = null where order_id = o.order_id;
    perform app.post_order_capture(o.order_id, p_payment);
  end if;
  update public.reconciliation_exception set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(), resolution = 'reconciled to ' || p_provider_ref where payment_id = p_payment and status = 'open';
  perform app.audit('ops_reconcile_payment', 'payment', p_payment, to_jsonb(p), jsonb_build_object('provider_ref', p_provider_ref), p_reason_code, null, o.market);
  return jsonb_build_object('order_id', o.order_id, 'status', 'reserved');
end $$;

create or replace function app.ops_extend_window(p_order uuid, p_new_end timestamptz, p_reason_code text)
returns public."order" language plpgsql security definer set search_path = '' as $$
declare o public."order";
begin
  perform app.ops_require(array['support_agent','ops_manager','admin']::public.ops_role[]);
  update public."order" set window_end_utc = p_new_end, updated_at = now() where order_id = p_order and status = 'reserved' and p_new_end > window_end_utc returning * into o;
  if not found then raise exception 'cannot extend' using errcode = 'BG110'; end if;
  perform app.audit('ops_extend_window', 'order', p_order, null, jsonb_build_object('new_end', p_new_end), p_reason_code, null, o.market);
  return o;
end $$;

create or replace function app.ops_moderation_queue() returns setof public.listing language sql stable security definer set search_path = '' as $$
  select * from public.listing where app.is_ops(array['ops_manager','admin']::public.ops_role[]) and market = any(app.current_markets()) and moderation_status = 'flagged' order by created_at;
$$;
create or replace function app.ops_moderate_listing(p_listing uuid, p_action text, p_reason text, p_edits jsonb default null)
returns public.listing language plpgsql security definer set search_path = '' as $$
declare l public.listing;
begin
  perform app.ops_require(array['ops_manager','admin']::public.ops_role[]);
  if p_action = 'reject' then
    perform app.cancel_listing(p_listing, 'listed_in_error', p_reason);
    update public.listing set moderation_status = 'rejected' where listing_id = p_listing returning * into l;
  else
    update public.listing set moderation_status = case when p_edits is null then 'approved' else 'edited' end::public.moderation_status,
      title_snapshot = coalesce(p_edits->>'title', title_snapshot), description_snapshot = coalesce(p_edits->>'description', description_snapshot)
     where listing_id = p_listing returning * into l;
  end if;
  perform app.audit('ops_moderate_listing', 'listing', p_listing, null, jsonb_build_object('action', p_action, 'edits', p_edits), null, p_reason, l.market);
  return l;
end $$;

-- ─── Users ──────────────────────────────────────────────────────────────────
create or replace function app.ops_users(p_market public.market default null, p_phone text default null, p_limit integer default 50)
returns table (user_id uuid, first_name text, phone text, market public.market, city_id uuid, no_show_count_90d integer, restricted_until timestamptz, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.user_id, c.first_name, c.phone, c.market, c.city_id, c.no_show_count_90d, c.restricted_until, c.created_at from public.consumer_profile c
  where app.is_ops() and c.market = any(app.current_markets()) and (p_market is null or c.market = p_market) and (p_phone is null or c.phone like '%' || p_phone || '%')
  order by c.created_at desc limit least(p_limit, 200);
$$;
create or replace function app.ops_user_detail(p_user uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('profile', to_jsonb(c), 'orders', (select coalesce(jsonb_agg(to_jsonb(o) order by o.created_at desc), '[]') from public."order" o where o.consumer_id = c.user_id),
    'wallet', (select coalesce(sum(amount_minor),0) from public.wallet_transaction w where w.consumer_id = c.user_id),
    'disputes', (select coalesce(jsonb_agg(to_jsonb(d)), '[]') from public.dispute d where d.consumer_id = c.user_id))
  from public.consumer_profile c where c.user_id = p_user and app.is_ops() and c.market = any(app.current_markets());
$$;
/** Goodwill by default (§3.7). */
create or replace function app.ops_issue_credit(p_user uuid, p_amount_minor bigint, p_reason_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_market public.market; tx uuid;
begin
  perform app.ops_require(array['support_agent','ops_manager','admin']::public.ops_role[]);
  select market into v_market from public.consumer_profile where user_id = p_user;
  tx := app.post_goodwill(p_user, p_amount_minor, v_market, p_reason_code);
  perform app.audit('ops_issue_credit', 'consumer_profile', p_user, null, jsonb_build_object('amount_minor', p_amount_minor, 'tx', tx), p_reason_code, null, v_market);
  return tx;
end $$;
create or replace function app.ops_restrict_user(p_user uuid, p_reason_code text, p_until timestamptz)
returns public.consumer_profile language plpgsql security definer set search_path = '' as $$
declare c public.consumer_profile;
begin
  perform app.ops_require(array['support_agent','ops_manager','admin']::public.ops_role[]);
  update public.consumer_profile set restricted_until = p_until, restriction_reason_code = p_reason_code where user_id = p_user returning * into c;
  perform app.audit('ops_restrict_user', 'consumer_profile', p_user, null, jsonb_build_object('until', p_until), p_reason_code, null, c.market);
  return c;
end $$;

-- ─── Config & governance ────────────────────────────────────────────────────
create or replace function app.ops_market_config(p_market public.market) returns public.market_config language sql stable security definer set search_path = '' as $$
  select * from public.market_config where market = p_market and app.is_ops();
$$;
/** Four eyes. History retained; a change never restates a closed period. */
create or replace function app.ops_propose_config(p_market public.market, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_gate jsonb; old public.market_config; k text;
begin
  perform app.ops_require(array['admin','finance']::public.ops_role[]);
  v_gate := app.require_four_eyes('ops_propose_config', null, jsonb_build_object('m', p_market, 'p', p_patch));
  if not (v_gate->>'approved')::boolean then return v_gate; end if;
  select * into old from public.market_config where market = p_market;
  insert into public.market_config_history select * from public.market_config where market = p_market;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('default_commission_bp','vat_applies','vat_bp','vat_base','vat_effective_from','invoicing_mode','price_min_minor','price_max_minor','max_price_fraction',
      'reservation_cap_default','reservation_cap_new_user','reservation_cap_cash','hold_duration_minutes','cancel_cutoff_hours','late_redeem_grace_minutes',
      'undo_redeem_seconds','payout_cadence','payout_day','payout_min_minor','refund_cap_support_minor','adjustment_four_eyes_minor',
      'cash_variance_threshold_minor','cash_liability_escalate_minor','cash_liability_escalate_days','cash_enabled') then
      raise exception 'field % is not configurable here', k using errcode = 'BG102';
    end if;
    execute format('update public.market_config set %I = ($1->>%L)::%s where market = $2', k, k,
      (select format_type(a.atttypid, a.atttypmod) from pg_attribute a where a.attrelid = 'public.market_config'::regclass and a.attname = k)) using p_patch, p_market;
  end loop;
  update public.market_config set version = version + 1, approved_by_1 = (v_gate->>'first_actor')::uuid, approved_by_2 = auth.uid(), updated_at = now() where market = p_market;
  perform app.audit('ops_propose_config', 'market_config', null, to_jsonb(old), p_patch, null, null, p_market);
  return jsonb_build_object('approved', true, 'version', (select version from public.market_config where market = p_market));
end $$;
create or replace function app.ops_cities(p_market public.market) returns setof public.city language sql stable security definer set search_path = '' as $$
  select * from public.city where market = p_market and app.is_ops() order by name_en; $$;
create or replace function app.ops_upsert_city(p_payload jsonb) returns public.city language plpgsql security definer set search_path = '' as $$
declare c public.city;
begin
  perform app.ops_require(array['ops_manager','admin']::public.ops_role[]);
  insert into public.city (id, market, name_en, name_ar, governorate, stage, default_radius_m)
  values (coalesce((p_payload->>'id')::uuid, extensions.uuid_generate_v4()), (p_payload->>'market')::public.market, p_payload->>'name_en', p_payload->>'name_ar', p_payload->>'governorate',
    coalesce((p_payload->>'stage')::public.city_stage, 'waitlist'), coalesce((p_payload->>'default_radius_m')::int, 5000))
  on conflict (id) do update set name_en = excluded.name_en, name_ar = excluded.name_ar, governorate = excluded.governorate, stage = excluded.stage, default_radius_m = excluded.default_radius_m
  returning * into c;
  perform app.audit('ops_upsert_city', 'city', c.id, null, to_jsonb(c), null, null, c.market);
  return c;
end $$;
/** funded_by is NOT NULL with no default — an unattributed promotion is rejected by the schema itself. */
create or replace function app.ops_create_promotion(p_payload jsonb) returns public.promotion language plpgsql security definer set search_path = '' as $$
declare p public.promotion;
begin
  perform app.ops_require(array['ops_manager','admin']::public.ops_role[]);
  if p_payload->>'funded_by' is null then raise exception 'a promotion needs funded_by' using errcode = 'BG102'; end if;
  insert into public.promotion (code, market, discount_type, discount_value, funded_by, eligibility, cap_per_user, cap_total, budget_cap_minor, valid_from, valid_to, stackable, created_by)
  values (upper(p_payload->>'code'), (p_payload->>'market')::public.market, p_payload->>'discount_type', (p_payload->>'discount_value')::int, (p_payload->>'funded_by')::public.promotion_funder,
    coalesce(p_payload->'eligibility','{}'), (p_payload->>'cap_per_user')::int, (p_payload->>'cap_total')::int, (p_payload->>'budget_cap_minor')::bigint,
    (p_payload->>'valid_from')::timestamptz, (p_payload->>'valid_to')::timestamptz, coalesce((p_payload->>'stackable')::boolean, false), auth.uid()) returning * into p;
  perform app.audit('ops_create_promotion', 'promotion', p.id, null, to_jsonb(p), null, null, p.market);
  return p;
end $$;
create or replace function app.ops_feature_flags(p_market public.market) returns setof public.feature_flag language sql stable security definer set search_path = '' as $$
  select * from public.feature_flag where (market = p_market or market is null) and app.is_ops() order by key; $$;
/** Kill switches take effect within 30 s (clients poll), are logged and alert. */
create or replace function app.ops_set_flag(p_key text, p_market public.market, p_enabled boolean)
returns public.feature_flag language plpgsql security definer set search_path = '' as $$
declare f public.feature_flag;
begin
  perform app.ops_require(array['engineering','admin']::public.ops_role[]);
  update public.feature_flag set enabled = p_enabled, updated_by = auth.uid(), updated_at = now() where key = p_key and market is not distinct from p_market and city_id is null and cohort is null returning * into f;
  if not found then raise exception 'unknown flag' using errcode = 'BG102'; end if;
  perform app.audit('ops_set_flag', 'feature_flag', f.id, null, to_jsonb(f), null, case when f.is_kill_switch then 'KILL SWITCH' end, p_market);
  return f;
end $$;
create or replace function app.ops_audit(p_from timestamptz, p_to timestamptz, p_operation text default null, p_actor uuid default null, p_limit integer default 200)
returns setof public.audit_log language sql stable security definer set search_path = '' as $$
  select * from public.audit_log where app.is_ops(array['ops_manager','finance','compliance','admin']::public.ops_role[]) and at between p_from and p_to
    and (market is null or market = any(app.current_markets())) and (p_operation is null or operation = p_operation) and (p_actor is null or actor_user = p_actor)
  order by at desc limit least(p_limit, 1000);
$$;
/** Read-only, consent captured, hard time limit. */
create or replace function app.ops_start_impersonation(p_target uuid, p_reason text, p_consent text)
returns public.impersonation_session language plpgsql security definer set search_path = '' as $$
declare s public.impersonation_session;
begin
  perform app.ops_require(array['support_agent','ops_manager','admin']::public.ops_role[]);
  if coalesce(p_consent,'') = '' then raise exception 'consent must be captured' using errcode = 'BG102'; end if;
  insert into public.impersonation_session (ops_user, target_user, reason, consent_captured, hard_expires_at) values (auth.uid(), p_target, p_reason, p_consent, now() + interval '30 minutes') returning * into s;
  perform app.audit('ops_start_impersonation', 'app_user', p_target, null, to_jsonb(s), null, p_reason);
  return s;
end $$;
create or replace function app.ops_end_impersonation(p_session uuid) returns void language sql security definer set search_path = '' as $$
  update public.impersonation_session set ended_at = now() where id = p_session and ops_user = auth.uid(); $$;
/** Four eyes above 100 PII rows. */
create or replace function app.ops_request_bulk_export(p_query jsonb, p_justification text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_gate jsonb; v_rows bigint;
begin
  perform app.ops_require(array['ops_manager','finance','compliance','admin']::public.ops_role[]);
  select count(*) into v_rows from public.consumer_profile where market = any(app.current_markets()) and (p_query->>'market' is null or market = (p_query->>'market')::public.market);
  if v_rows > 100 then
    v_gate := app.require_four_eyes('ops_request_bulk_export', null, p_query);
    if not (v_gate->>'approved')::boolean then return v_gate; end if;
  end if;
  perform app.audit('ops_request_bulk_export', 'consumer_profile', null, null, jsonb_build_object('rows', v_rows, 'query', p_query), null, p_justification);
  return jsonb_build_object('approved', true, 'rows', v_rows, 'export_key', 'exports/' || extensions.uuid_generate_v4() || '.csv');
end $$;
create or replace function app.ops_revenue(p_market public.market, p_from date, p_to date) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('market', p_market, 'currency', max(currency),
    'gmv_minor', coalesce(sum(total_minor) filter (where status in ('redeemed','no_show')),0),
    'commission_recognised_minor', coalesce(sum(commission_minor) filter (where status = 'redeemed'),0),
    'no_show_retained_minor', coalesce(sum(total_minor) filter (where status = 'no_show' and method <> 'cash'),0),
    'take_rate', round(coalesce(sum(commission_minor) filter (where status = 'redeemed'),0)::numeric / nullif(sum(total_minor) filter (where status = 'redeemed'),0), 4))
  from public."order" where market = p_market and created_at::date between p_from and p_to and app.is_ops(array['finance','admin','ops_manager']::public.ops_role[]);
$$;
create or replace function app.ops_unit_economics(p_market public.market, p_city uuid, p_from date, p_to date) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('orders', count(*), 'revenue_per_order_minor', round(coalesce(avg(commission_minor) filter (where status='redeemed'),0)),
    'psp_cost_per_order_minor', round(coalesce((select avg(psp_fee_minor) from public.payment p join public."order" x on x.order_id = p.order_id where x.market = p_market and (p_city is null or x.listing_id in (select listing_id from public.listing where city_id = p_city))),0)))
  from public."order" o where o.market = p_market and o.created_at::date between p_from and p_to and (p_city is null or exists (select 1 from public.listing l where l.listing_id = o.listing_id and l.city_id = p_city))
    and app.is_ops(array['finance','admin']::public.ops_role[]);
$$;
/** Tax entries are ledger entries; Egypt raises BG150 until decision 1 lands. */
create or replace function app.ops_tax_report(p_market public.market, p_from date, p_to date) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_comm bigint;
begin
  perform app.ops_require(array['finance','admin']::public.ops_role[]);
  select coalesce(sum(case when entry_type='credit' then amount_minor else -amount_minor end),0) into v_comm from public.financial_entry where market = p_market and account = 'commission_revenue' and effective_at::date between p_from and p_to;
  return jsonb_build_object('market', p_market, 'commission_base_minor', v_comm, 'vat_minor', app.resolve_tax(p_market, v_comm, p_to::timestamptz),
    'vat_payable_ledger_minor', (select coalesce(sum(case when entry_type='credit' then amount_minor else -amount_minor end),0) from public.financial_entry where market = p_market and account = 'vat_payable'));
end $$;

grant execute on function app.ops_partners, app.ops_partner_detail, app.ops_approve_partner, app.ops_reject_partner, app.ops_suspend_partner, app.ops_reinstate_partner,
  app.ops_set_commission, app.ops_override_reliability, app.ops_verify_document, app.ops_partner_health, app.ops_onboarding_funnel,
  app.ops_live_dashboard, app.ops_supply_demand, app.ops_orders, app.ops_order_detail, app.ops_force_redeem, app.ops_force_cancel, app.ops_reissue_code,
  app.ops_reconcile_payment, app.ops_extend_window, app.ops_moderation_queue, app.ops_moderate_listing, app.ops_users, app.ops_user_detail,
  app.ops_issue_credit, app.ops_restrict_user, app.ops_market_config, app.ops_propose_config, app.ops_cities, app.ops_upsert_city, app.ops_create_promotion,
  app.ops_feature_flags, app.ops_set_flag, app.ops_audit, app.ops_start_impersonation, app.ops_end_impersonation, app.ops_request_bulk_export,
  app.ops_revenue, app.ops_unit_economics, app.ops_tax_report to authenticated;
