-- Phase 8 — redemption: online, offline queue, idempotency, undo, late, cash,
-- no-show (docs/07-api.md §Partner, 14-mobile.md §3, 12-test-plan.md §13).
set search_path = public, extensions;

/**
 * Idempotent. An already-redeemed order returns SUCCESS with the original
 * record and who took it — never an error a staff member could read as
 * "try again" (§13-5). client_ts is present only when queued offline; both
 * client and server timestamps go to the compliance ledger.
 */
create or replace function app.redeem_order(
  p_order uuid, p_mechanism public.redeem_mechanism, p_idempotency text,
  p_client_ts timestamptz default null, p_staff_user uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public."order"; r public.redemption; v_cfg public.market_config; v_staff uuid; v_replay jsonb;
        v_offline boolean := p_client_ts is not null; v_honoured boolean := false; v_tx uuid;
begin
  v_replay := app.idempotent_replay(p_idempotency, 'redeem_order', jsonb_build_object('o', p_order));
  if v_replay is not null and not coalesce((v_replay->>'pending')::boolean, false) then return v_replay; end if;

  select * into o from public."order" where order_id = p_order for update;
  if not found then raise exception 'unknown order' using errcode = 'BG110'; end if;
  if not app.can_store(o.store_id, array['owner','manager','staff']::public.partner_role[]) then
    raise exception 'not authorised at this store' using errcode = 'BG100';
  end if;
  select * into v_cfg from public.market_config where market = o.market;
  v_staff := coalesce(p_staff_user, auth.uid());

  -- Already redeemed: success with the original. Not an error.
  select * into r from public.redemption where order_id = p_order and undone_at is null;
  if found then
    v_replay := jsonb_build_object('order', to_jsonb(o), 'redemption', to_jsonb(r), 'already_redeemed', true,
      'redeemed_by', (select jsonb_build_object('user_id', pu.user_id, 'full_name', pu.full_name, 'at', r.server_ts)
                        from public.partner_user pu where pu.user_id = r.staff_user_id),
      'undo_expires_at', r.server_ts + make_interval(secs => v_cfg.undo_redeem_seconds));
    perform app.idempotent_record(p_idempotency, v_replay);
    return v_replay;
  end if;

  -- §13-6: redeemed offline, cancelled online meanwhile. The bag was handed
  -- over in good faith, so the order is HONOURED. Staff are never blamed.
  if o.status in ('cancelled_consumer','cancelled_partner','refunded') and v_offline and p_client_ts < coalesce(o.cancelled_at, now()) then
    v_honoured := true;
    v_tx := extensions.uuid_generate_v4();
    -- The refund already left. Park it in suspense for ops to resolve; the
    -- partner is made whole for the bag they handed over.
    perform app.post_entries(v_tx, jsonb_build_array(
      jsonb_build_object('entry_type','debit','account','unreconciled_suspense','amount_minor', o.total_minor,
        'currency', o.currency, 'market', o.market, 'partner_id', o.partner_id, 'order_id', o.order_id,
        'reference_type','order','reference_id', o.order_id, 'effective_at', now(), 'reason_code','manual_correction'),
      jsonb_build_object('entry_type','credit','account','partner_payable','amount_minor', o.total_minor - o.commission_minor,
        'currency', o.currency, 'market', o.market, 'partner_id', o.partner_id, 'order_id', o.order_id,
        'reference_type','order','reference_id', o.order_id, 'effective_at', now(), 'contract_version_id', o.contract_version_id),
      jsonb_build_object('entry_type','credit','account','commission_revenue','amount_minor', o.commission_minor,
        'currency', o.currency, 'market', o.market, 'partner_id', o.partner_id, 'order_id', o.order_id,
        'reference_type','order','reference_id', o.order_id, 'effective_at', now(), 'contract_version_id', o.contract_version_id)));
    insert into public.reconciliation_exception (kind, exception_type, market, expected_minor, actual_minor, currency, status, resolution)
    values ('cash', 'offline_redeem_after_cancel', o.market, o.total_minor, 0, o.currency, 'open',
            'Redeemed offline at ' || p_client_ts || ', cancelled online at ' || o.cancelled_at || '. Order honoured; refund parked in suspense.');
  elsif o.status <> 'reserved' then
    raise exception 'this order is % and cannot be redeemed', o.status using errcode = 'BG110';
  elsif not v_offline and now() < o.window_start_utc then
    raise exception 'the pickup window has not opened' using errcode = 'BG111';
  elsif not v_offline and now() >= o.window_end_utc then
    raise exception 'the pickup window has closed — use late redemption within the grace' using errcode = 'BG112';
  end if;

  insert into public.redemption (order_id, store_id, mechanism, staff_user_id, client_ts, server_ts, offline_queued, idempotency_key)
  values (p_order, o.store_id, p_mechanism, v_staff, p_client_ts, now(), v_offline, p_idempotency)
  returning * into r;

  update public."order" set status = 'redeemed', updated_at = now() where order_id = p_order returning * into o;

  -- Cash: commission accrues as a receivable once the collection is recorded.
  -- Digital: commission is recognised at redemption (05-money.md §7).
  insert into public.compliance_entry (store_id, partner_id, event_type, listing_id, order_id, quantity,
    declared_value_minor, currency, window_start_utc, window_end_utc, redeemed_client_ts, redeemed_server_ts, staff_user_id, detail)
  values (o.store_id, o.partner_id, 'redeemed', o.listing_id, o.order_id, o.quantity, o.total_minor, o.currency,
    o.window_start_utc, o.window_end_utc, p_client_ts, now(), v_staff,
    case when v_honoured then jsonb_build_object('honoured_after_cancel', true) else null end);

  v_replay := jsonb_build_object('order', to_jsonb(o), 'redemption', to_jsonb(r), 'already_redeemed', false,
    'honoured_after_cancel', v_honoured,
    'cash_due_minor', case when o.method = 'cash' then o.total_minor else null end,
    'undo_expires_at', r.server_ts + make_interval(secs => v_cfg.undo_redeem_seconds));
  perform app.idempotent_record(p_idempotency, v_replay);
  return v_replay;
end $$;

/** Within the grace after close. Records the grace flag, reverses the consumer's no-show, audits (§13-3). */
create or replace function app.redeem_order_late(p_order uuid, p_mechanism public.redeem_mechanism, p_idempotency text, p_staff_user uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public."order"; v_cfg public.market_config; r public.redemption; v_res jsonb;
begin
  select * into o from public."order" where order_id = p_order for update;
  if not found then raise exception 'unknown order' using errcode = 'BG110'; end if;
  if not app.can_store(o.store_id, array['owner','manager','staff']::public.partner_role[]) then
    raise exception 'not authorised' using errcode = 'BG100';
  end if;
  select * into v_cfg from public.market_config where market = o.market;
  if now() < o.window_end_utc then raise exception 'the window is still open — use redeem_order' using errcode = 'BG111'; end if;
  if now() >= o.window_end_utc + make_interval(mins => v_cfg.late_redeem_grace_minutes) then
    raise exception 'past the % minute grace', v_cfg.late_redeem_grace_minutes using errcode = 'BG112';
  end if;
  if o.status = 'no_show' then
    -- Already marked: reverse it. The consumer did turn up.
    update public."order" set status = 'reserved' where order_id = p_order;
    delete from public.no_show_disposition where order_id = p_order;
    update public.consumer_profile set no_show_count_90d = greatest(0, no_show_count_90d - 1) where user_id = o.consumer_id;
  end if;
  update public."order" set window_end_utc = now() + interval '1 minute' where order_id = p_order;   -- let redeem_order pass the window check
  v_res := app.redeem_order(p_order, p_mechanism, p_idempotency, null, p_staff_user);
  update public."order" set window_end_utc = o.window_end_utc where order_id = p_order;
  update public.redemption set late_grace = true where order_id = p_order and undone_at is null;
  perform app.audit('redeem_order_late', 'order', p_order, null, jsonb_build_object('grace_minutes', v_cfg.late_redeem_grace_minutes), null, null, o.market);
  return v_res || jsonb_build_object('late_grace', true);
end $$;

/** Same staff member, within undo_redeem_seconds. After that: ops, logged as an exception. */
create or replace function app.undo_redemption(p_order uuid)
returns public."order" language plpgsql security definer set search_path = '' as $$
declare r public.redemption; o public."order"; v_cfg public.market_config;
begin
  select * into r from public.redemption where order_id = p_order and undone_at is null for update;
  if not found then raise exception 'nothing to undo' using errcode = 'BG110'; end if;
  select * into o from public."order" where order_id = p_order;
  select * into v_cfg from public.market_config where market = o.market;
  if r.staff_user_id <> auth.uid() then raise exception 'only the same staff member may undo' using errcode = 'BG100'; end if;
  if now() > r.server_ts + make_interval(secs => v_cfg.undo_redeem_seconds) then
    raise exception 'the % second undo window has passed — ask ops to reverse it', v_cfg.undo_redeem_seconds using errcode = 'BG112';
  end if;
  update public.redemption set undone_at = now(), undone_by = auth.uid() where id = r.id;
  update public."order" set status = 'reserved', updated_at = now() where order_id = p_order returning * into o;
  return o;
end $$;

/** Egypt cash. Commission accrues on what was actually COLLECTED (§13-10, P10). */
create or replace function app.collect_cash(p_order uuid, p_collected_minor bigint, p_idempotency text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public."order"; v_replay jsonb; v_tx uuid;
begin
  v_replay := app.idempotent_replay(p_idempotency, 'collect_cash', jsonb_build_object('o', p_order, 'c', p_collected_minor));
  if v_replay is not null and not coalesce((v_replay->>'pending')::boolean, false) then return v_replay; end if;
  select * into o from public."order" where order_id = p_order for update;
  if not found or o.method <> 'cash' then raise exception 'not a cash order' using errcode = 'BG110'; end if;
  if not app.can_store(o.store_id, array['owner','manager','staff']::public.partner_role[]) then
    raise exception 'not authorised' using errcode = 'BG100';
  end if;
  if o.status <> 'redeemed' then raise exception 'redeem first, then record cash' using errcode = 'BG110'; end if;
  if p_collected_minor < 0 or p_collected_minor > o.total_minor then raise exception 'collected amount out of range' using errcode = 'BG102'; end if;
  insert into public.cash_collection (order_id, expected_minor, collected_minor, short_minor, staff_user_id)
  values (p_order, o.total_minor, p_collected_minor, o.total_minor - p_collected_minor, auth.uid())
  on conflict (order_id) do nothing;
  v_tx := app.post_cash_commission(p_order);
  v_replay := jsonb_build_object('order_id', p_order, 'collected_minor', p_collected_minor,
    'short_minor', o.total_minor - p_collected_minor, 'transaction_id', v_tx);
  perform app.idempotent_record(p_idempotency, v_replay);
  return v_replay;
end $$;

/** After close only. Zero ledger entries — the partner retains (05-money.md §3.2/§3.4). */
create or replace function app.mark_no_show(p_order uuid, p_disposition public.disposition)
returns public."order" language plpgsql security definer set search_path = '' as $$
declare o public."order";
begin
  select * into o from public."order" where order_id = p_order for update;
  if not found then raise exception 'unknown order' using errcode = 'BG110'; end if;
  if not app.can_store(o.store_id, array['owner','manager']::public.partner_role[]) then
    raise exception 'not authorised' using errcode = 'BG100';
  end if;
  if o.status <> 'reserved' then raise exception 'this order is %', o.status using errcode = 'BG110'; end if;
  if now() < o.window_end_utc then raise exception 'the window has not closed' using errcode = 'BG111'; end if;
  update public."order" set status = 'no_show', updated_at = now() where order_id = p_order returning * into o;
  insert into public.no_show_disposition (order_id, disposition, recorded_by) values (p_order, p_disposition, auth.uid())
  on conflict (order_id) do update set disposition = excluded.disposition;
  update public.consumer_profile set no_show_count_90d = no_show_count_90d + 1 where user_id = o.consumer_id;
  insert into public.compliance_entry (store_id, partner_id, event_type, listing_id, order_id, quantity,
    declared_value_minor, currency, window_start_utc, window_end_utc, disposition)
  values (o.store_id, o.partner_id, 'no_show', o.listing_id, o.order_id, o.quantity, o.total_minor, o.currency,
    o.window_start_utc, o.window_end_utc, p_disposition);
  return o;
end $$;

/** Ops reversal after the undo window. Reason-coded, audited as an exception (§13-2). */
create or replace function app.ops_reverse_redemption(p_order uuid, p_reason_code text, p_justification text)
returns public."order" language plpgsql security definer set search_path = '' as $$
declare r public.redemption; o public."order";
begin
  if not app.is_ops(array['ops_manager','support_agent','admin']::public.ops_role[]) then
    raise exception 'ops only' using errcode = 'BG100';
  end if;
  select * into r from public.redemption where order_id = p_order and undone_at is null for update;
  if not found then raise exception 'nothing to reverse' using errcode = 'BG110'; end if;
  update public.redemption set undone_at = now(), undone_by = auth.uid() where id = r.id;
  update public."order" set status = 'reserved', updated_at = now() where order_id = p_order returning * into o;
  perform app.audit('ops_reverse_redemption', 'order', p_order, to_jsonb(r), null, p_reason_code, p_justification, o.market);
  return o;
end $$;

grant execute on function app.redeem_order, app.redeem_order_late, app.undo_redemption, app.collect_cash,
  app.mark_no_show, app.ops_reverse_redemption to authenticated;
