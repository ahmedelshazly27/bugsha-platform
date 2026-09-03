-- Phase 13 — disputes, food-safety register, quality hold (02-data-model.md §9, 07-api.md §Disputes).
set search_path = public, extensions;

/**
 * illness_detail present, or an illness/contamination category, is CRITICAL:
 * straight to Compliance, SLA in hours, the partner is INFORMED and never asked
 * to triage, and a quality hold is considered automatically.
 */
create or replace function app.open_dispute(p_order uuid, p_category text, p_statement text, p_photos text[] default '{}', p_illness_detail jsonb default null)
returns public.dispute language plpgsql security definer set search_path = '' as $$
declare o public."order"; d public.dispute; v_sev public.dispute_severity; v_owner uuid; v_sla timestamptz; v_ref text;
begin
  select * into o from public."order" where order_id = p_order and consumer_id = auth.uid();
  if not found then raise exception 'not your order' using errcode = 'BG100'; end if;
  v_sev := case when p_illness_detail is not null or p_category in ('suspected_foodborne_illness','contamination') then 'critical'
                when p_category in ('safety_concern','never_received') then 'high' else 'standard' end;
  v_sla := case v_sev when 'critical' then now() + interval '4 hours' when 'high' then now() + interval '8 hours' else now() + interval '3 days' end;
  select user_id into v_owner from public.ops_user where disabled_at is null and o.market = any(market_scope)
    and role = case v_sev when 'critical' then 'compliance'::public.ops_role else 'support_agent'::public.ops_role end
    order by random() limit 1;
  v_ref := 'BG-DSP-' || lpad((select count(*) + 1 from public.dispute)::text, 4, '0');
  insert into public.dispute (case_ref, order_id, consumer_id, market, category, severity, consumer_statement, photos, illness_detail, owner_ops_user, sla_due_at,
    partner_deadline)
  values (v_ref, p_order, auth.uid(), o.market, p_category, v_sev, p_statement, coalesce(p_photos,'{}'), p_illness_detail, v_owner, v_sla,
    case when v_sev = 'critical' then null else now() + interval '2 days' end)   -- critical: the partner is not asked to triage
  returning * into d;
  if v_sev = 'critical' then
    insert into public.quality_flag (order_id, store_id, partner_id, source, category, body, severity, escalated_at)
    values (p_order, o.store_id, o.partner_id, 'consumer', p_category, 'Consumer report routed to Compliance. Automatic quality-hold review.', 'critical', now());
  end if;
  return d;
end $$;

create or replace function app.ops_disputes(p_market public.market default null, p_severity public.dispute_severity default null, p_open_only boolean default true)
returns setof public.dispute language sql stable security definer set search_path = '' as $$
  select * from public.dispute where app.is_ops() and market = any(app.current_markets())
    and (p_market is null or market = p_market) and (p_severity is null or severity = p_severity) and (not p_open_only or resolved_at is null)
  order by case severity when 'critical' then 1 when 'high' then 2 else 3 end, sla_due_at;
$$;

create or replace function app.ops_assign_dispute(p_dispute uuid, p_ops_user uuid)
returns public.dispute language plpgsql security definer set search_path = '' as $$
declare d public.dispute;
begin
  if not app.is_ops(array['ops_manager','compliance','admin']::public.ops_role[]) then raise exception 'not authorised' using errcode = 'BG100'; end if;
  update public.dispute set owner_ops_user = p_ops_user where id = p_dispute returning * into d;
  perform app.audit('ops_assign_dispute', 'dispute', p_dispute, null, jsonb_build_object('owner', p_ops_user), null, null, d.market);
  return d;
end $$;

/** financial_outcome: {kind: 'none'|'goodwill'|'refund', amount_minor, reason_code}. Goodwill is platform-funded (§3.7). */
create or replace function app.ops_resolve_dispute(p_dispute uuid, p_resolution text, p_outcome jsonb)
returns public.dispute language plpgsql security definer set search_path = '' as $$
declare d public.dispute; o public."order"; v_refund uuid; v_payment uuid;
begin
  if not app.is_ops(array['support_agent','ops_manager','compliance','admin']::public.ops_role[]) then raise exception 'not authorised' using errcode = 'BG100'; end if;
  select * into d from public.dispute where id = p_dispute for update;
  if d.severity = 'critical' and not app.is_ops(array['compliance','admin']::public.ops_role[]) then
    raise exception 'critical disputes are resolved by Compliance' using errcode = 'BG100';
  end if;
  select * into o from public."order" where order_id = d.order_id;
  if p_outcome->>'kind' = 'goodwill' then
    perform app.post_goodwill(d.consumer_id, (p_outcome->>'amount_minor')::bigint, d.market, coalesce(p_outcome->>'reason_code','goodwill'), d.order_id);
  elsif p_outcome->>'kind' = 'refund' then
    select payment_id into v_payment from public.payment where order_id = d.order_id limit 1;
    insert into public.refund (order_id, payment_id, amount_minor, destination, reason_code, cost_bearer, status, requested_by, approved_by)
    values (d.order_id, v_payment, (p_outcome->>'amount_minor')::bigint, coalesce(p_outcome->>'destination','source'), coalesce(p_outcome->>'reason_code','quality_issue'),
            coalesce(p_outcome->>'cost_bearer','platform')::public.fee_bearer, 'approved', d.consumer_id, auth.uid()) returning refund_id into v_refund;
    if coalesce(p_outcome->>'destination','source') = 'wallet' then perform app.post_refund_to_wallet(v_refund); else perform app.post_refund(v_refund, true); end if;
  end if;
  update public.dispute set resolution = p_resolution, financial_outcome = p_outcome, resolved_at = now() where id = p_dispute returning * into d;
  perform app.audit('ops_resolve_dispute', 'dispute', p_dispute, null, p_outcome, p_outcome->>'reason_code', p_resolution, d.market);
  return d;
end $$;

create or replace function app.ops_incidents(p_market public.market default null)
returns setof public.incident language sql stable security definer set search_path = '' as $$
  select * from public.incident where app.is_ops(array['compliance','ops_manager','admin']::public.ops_role[]) and market = any(app.current_markets())
    and (p_market is null or market = p_market) order by opened_at desc;
$$;

create or replace function app.ops_open_incident(p_payload jsonb)
returns public.incident language plpgsql security definer set search_path = '' as $$
declare i public.incident; v_ref text;
begin
  if not app.is_ops(array['compliance','ops_manager','admin']::public.ops_role[]) then raise exception 'not authorised' using errcode = 'BG100'; end if;
  v_ref := 'BG-INC-' || lpad((select count(*) + 1 from public.incident)::text, 4, '0');
  insert into public.incident (ref, market, partner_id, store_id, categories, order_refs, consumer_reports, platform_action)
  values (v_ref, (p_payload->>'market')::public.market, (p_payload->>'partner_id')::uuid, (p_payload->>'store_id')::uuid,
    array(select jsonb_array_elements_text(p_payload->'categories')), coalesce(array(select jsonb_array_elements_text(p_payload->'order_refs')), '{}'),
    p_payload->'consumer_reports', p_payload->'platform_action') returning * into i;
  perform app.audit('ops_open_incident', 'incident', i.id, null, to_jsonb(i), null, null, i.market);
  return i;
end $$;

/** Immutable thereafter — the trigger refuses any later edit (BG004). */
create or replace function app.ops_close_incident(p_incident uuid, p_resolution text)
returns public.incident language plpgsql security definer set search_path = '' as $$
declare i public.incident;
begin
  if not app.is_ops(array['compliance','admin']::public.ops_role[]) then raise exception 'Compliance signs off incidents' using errcode = 'BG100'; end if;
  update public.incident set resolution = p_resolution, closed_at = now(), signed_off_by = auth.uid() where id = p_incident returning * into i;
  perform app.audit('ops_close_incident', 'incident', p_incident, null, to_jsonb(i), null, p_resolution, i.market);
  return i;
end $$;

/** A correction is a NEW row that references the original. */
create or replace function app.ops_amend_incident(p_incident uuid, p_amendment jsonb)
returns public.incident language plpgsql security definer set search_path = '' as $$
declare o public.incident; i public.incident;
begin
  if not app.is_ops(array['compliance','admin']::public.ops_role[]) then raise exception 'not authorised' using errcode = 'BG100'; end if;
  select * into o from public.incident where id = p_incident;
  if o.closed_at is null then raise exception 'amend applies to closed incidents; edit an open one directly' using errcode = 'BG110'; end if;
  insert into public.incident (ref, market, partner_id, store_id, categories, order_refs, consumer_reports, partner_response, platform_action, resolution, amends_incident_id)
  values (o.ref || '-A', o.market, o.partner_id, o.store_id, o.categories, o.order_refs, o.consumer_reports,
    coalesce(p_amendment->>'partner_response', o.partner_response), coalesce(p_amendment->'platform_action', o.platform_action),
    coalesce(p_amendment->>'resolution', o.resolution), o.id) returning * into i;
  perform app.audit('ops_amend_incident', 'incident', i.id, to_jsonb(o), to_jsonb(i), null, null, i.market);
  return i;
end $$;

create or replace function app.ops_place_quality_hold(p_store uuid, p_reason text, p_duration text, p_cancel_existing boolean, p_incident uuid default null)
returns public.quality_hold language plpgsql security definer set search_path = '' as $$
declare h public.quality_hold; l record; o record; v_refund uuid; v_payment uuid;
begin
  if not app.is_ops(array['compliance','ops_manager','admin']::public.ops_role[]) then raise exception 'not authorised' using errcode = 'BG100'; end if;
  insert into public.quality_hold (store_id, incident_id, reason_text, expected_duration, cancel_existing, placed_by)
  values (p_store, p_incident, p_reason, p_duration, p_cancel_existing, auth.uid()) returning * into h;
  update public.store set paused_until = now() + interval '7 days', pause_reason_code = 'safety_incident' where store_id = p_store;
  if p_cancel_existing then
    for l in select * from public.listing where store_id = p_store and status in ('active','sold_out') for update loop
      for o in select * from public."order" where listing_id = l.listing_id and status in ('held','reserved') for update loop
        if o.payment_status = 'captured' then
          select payment_id into v_payment from public.payment where order_id = o.order_id limit 1;
          insert into public.refund (order_id, payment_id, amount_minor, destination, reason_code, cost_bearer, status, approved_by)
          values (o.order_id, v_payment, o.total_minor, 'source', 'quality_issue', 'platform', 'approved', auth.uid()) returning refund_id into v_refund;
          perform app.post_refund(v_refund, true);
        end if;
        update public."order" set status = 'cancelled_partner', cancelled_at = now(), cancelled_reason_code = 'quality_concern',
          payment_status = case when o.payment_status = 'captured' then 'refunded'::public.payment_status else o.payment_status end where order_id = o.order_id;
      end loop;
      update public.listing set status = 'cancelled', cancelled_reason_code = 'quality_concern', cancelled_at = now() where listing_id = l.listing_id;
    end loop;
  end if;
  perform app.audit('ops_place_quality_hold', 'store', p_store, null, to_jsonb(h), 'safety_incident', p_reason);
  return h;
end $$;

create or replace function app.ops_release_quality_hold(p_hold uuid)
returns public.quality_hold language plpgsql security definer set search_path = '' as $$
declare h public.quality_hold;
begin
  if not app.is_ops(array['compliance','admin']::public.ops_role[]) then raise exception 'not authorised' using errcode = 'BG100'; end if;
  update public.quality_hold set released_at = now(), released_by = auth.uid() where id = p_hold returning * into h;
  update public.store set paused_until = null, pause_reason_code = null where store_id = h.store_id and pause_reason_code = 'safety_incident';
  perform app.audit('ops_release_quality_hold', 'quality_hold', p_hold, null, to_jsonb(h));
  return h;
end $$;

/** Partner acknowledges a flag with a finding and an action, within the deadline. */
create or replace function app.acknowledge_flag(p_flag uuid, p_finding text, p_action_text text)
returns public.quality_flag language plpgsql security definer set search_path = '' as $$
declare f public.quality_flag;
begin
  select * into f from public.quality_flag where id = p_flag;
  if not found or not app.can_store(f.store_id, array['owner','manager']::public.partner_role[]) then raise exception 'not authorised' using errcode = 'BG100'; end if;
  update public.quality_flag set acknowledged_at = now(), acknowledged_by = auth.uid(), acknowledgement_text = p_finding || E'\n' || p_action_text
   where id = p_flag returning * into f;
  return f;
end $$;

grant execute on function app.open_dispute, app.ops_disputes, app.ops_assign_dispute, app.ops_resolve_dispute, app.ops_incidents,
  app.ops_open_incident, app.ops_close_incident, app.ops_amend_incident, app.ops_place_quality_hold, app.ops_release_quality_hold,
  app.acknowledge_flag to authenticated;
