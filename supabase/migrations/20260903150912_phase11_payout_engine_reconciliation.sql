-- Phase 11 — payout engine, reconciliation, period close (docs/05-money.md §5-6).
set search_path = public, extensions;

/** §3.3 settlement by netting: DR partner_payable / CR partner_receivable. */
create or replace function app.post_cash_netting(p_partner uuid, p_payout uuid, p_amount_minor bigint, p_currency char(3), p_market public.market)
returns uuid language plpgsql security definer set search_path = '' as $$
declare tx uuid := extensions.uuid_generate_v4();
begin
  perform app.post_entries(tx, jsonb_build_array(
    jsonb_build_object('entry_type','debit','account','partner_payable','amount_minor',p_amount_minor,'currency',p_currency,'market',p_market,
      'partner_id',p_partner,'payout_id',p_payout,'reference_type','payout','reference_id',p_payout,'effective_at',now()),
    jsonb_build_object('entry_type','credit','account','partner_receivable','amount_minor',p_amount_minor,'currency',p_currency,'market',p_market,
      'partner_id',p_partner,'payout_id',p_payout,'reference_type','payout','reference_id',p_payout,'effective_at',now())));
  return tx;
end $$;

/**
 * FREEZE -> AGGREGATE -> NET -> THRESHOLD -> VALIDATE -> statements.
 * Entries are immutable, so allocation to a payout lives in payout_allocation.
 * A negative net is NEVER debited: it carries forward on the row (§5).
 */
create or replace function app.ops_create_payout_run(p_market public.market, p_period_start date, p_period_end date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_run uuid; v_cfg public.market_config; r record; v_payout uuid; v_net bigint; v_carry_in bigint; v_receivable bigint;
        v_status public.payout_status; v_hold text; v_count integer := 0; v_prior_gross bigint;
begin
  if not app.is_ops(array['finance','admin']::public.ops_role[]) then raise exception 'finance only' using errcode = 'BG100'; end if;
  select * into v_cfg from public.market_config where market = p_market;
  insert into public.payout_run (market, period_start, period_end, status, frozen_at) values (p_market, p_period_start, p_period_end, 'review', now()) returning id into v_run;

  for r in
    select e.partner_id, e.currency,
      sum(case when e.entry_type='credit' then e.amount_minor else -e.amount_minor end) as payable,
      array_agg(e.id) as entry_ids
    from public.financial_entry e
    where e.market = p_market and e.account = 'partner_payable' and e.partner_id is not null
      and e.effective_at::date between p_period_start and p_period_end
      and not exists (select 1 from public.payout_allocation a where a.entry_id = e.id)
    group by e.partner_id, e.currency
  loop
    -- Prior carry-forward, if any.
    select coalesce(sum(carry_out_minor),0) into v_carry_in from public.payout p where p.partner_id = r.partner_id and p.status = 'carried'
      and not exists (select 1 from public.payout p2 where p2.partner_id = r.partner_id and p2.created_at > p.created_at and p2.status in ('paid','executing','approved'));
    -- Cash commission receivable nets here when the contract says so.
    select coalesce(sum(case when e.entry_type='debit' then e.amount_minor else -e.amount_minor end),0) into v_receivable
      from public.financial_entry e where e.partner_id = r.partner_id and e.account = 'partner_receivable';
    if (select cash_settlement_mode from app.resolve_commission(r.partner_id, now())) <> 'net' then v_receivable := 0; end if;
    v_receivable := greatest(0, v_receivable);

    v_net := r.payable + v_carry_in - v_receivable;
    select coalesce(sum(gross_minor),0) into v_prior_gross from public.payout p join public.payout_run pr on pr.id = p.run_id
      where p.partner_id = r.partner_id and pr.period_end < p_period_start and pr.period_end >= p_period_start - 14;

    if v_net < 0 then v_status := 'carried'; v_hold := 'negative_balance';
    elsif v_net < v_cfg.payout_min_minor then v_status := 'carried'; v_hold := 'below_threshold';
    elsif exists (select 1 from public.partner p where p.partner_id = r.partner_id and p.suspended_until > now()) then v_status := 'held'; v_hold := 'partner_suspended';
    elsif exists (select 1 from public.dispute d join public."order" o on o.order_id = d.order_id where o.partner_id = r.partner_id and d.severity = 'critical' and d.resolved_at is null) then v_status := 'held'; v_hold := 'open_critical_dispute';
    elsif not exists (select 1 from public.payout p where p.partner_id = r.partner_id and p.status = 'paid') then v_status := 'held'; v_hold := 'first_payout';
    elsif v_prior_gross > 0 and r.payable > v_prior_gross * 2 then v_status := 'held'; v_hold := 'large_variance';
    else v_status := 'ready'; v_hold := null; end if;

    insert into public.payout (run_id, partner_id, currency, gross_minor, netted_minor, carry_in_minor, net_minor, carry_out_minor, status, hold_reason)
    values (v_run, r.partner_id, r.currency, r.payable, v_receivable, v_carry_in,
            case when v_status = 'carried' then 0 else v_net end,
            case when v_status = 'carried' then v_net else 0 end, v_status, v_hold)
    returning payout_id into v_payout;
    insert into public.payout_allocation (payout_id, entry_id) select v_payout, unnest(r.entry_ids);
    insert into public.statement (payout_id, partner_id, period_start, period_end, totals)
    values (v_payout, r.partner_id, p_period_start, p_period_end, jsonb_build_object('gross_minor', r.payable, 'netted_minor', v_receivable,
      'carry_in_minor', v_carry_in, 'net_minor', v_net, 'currency', r.currency, 'status', v_status, 'hold_reason', v_hold));
    v_count := v_count + 1;
  end loop;
  perform app.audit('ops_create_payout_run', 'payout_run', v_run, null, jsonb_build_object('payouts', v_count), null, null, p_market);
  return jsonb_build_object('run_id', v_run, 'payouts', v_count);
end $$;

/** Four eyes AND re-auth regardless of session age (§5.8). */
create or replace function app.ops_approve_payout_run(p_run uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_gate jsonb; pr public.payout_run;
begin
  if not app.is_ops(array['finance','admin']::public.ops_role[]) then raise exception 'finance only' using errcode = 'BG100'; end if;
  perform app.require_recent_auth('5 minutes');
  select * into pr from public.payout_run where id = p_run for update;
  if pr.status not in ('review','ready') then raise exception 'run is %', pr.status using errcode = 'BG110'; end if;
  v_gate := app.require_four_eyes('ops_approve_payout_run', p_run, jsonb_build_object('run', p_run));
  if not (v_gate->>'approved')::boolean then
    update public.payout_run set approved_by_1 = auth.uid(), approved_by_1_at = now() where id = p_run;
    return v_gate;
  end if;
  update public.payout_run set status = 'approved', approved_by_2 = auth.uid(), approved_by_2_at = now() where id = p_run;
  update public.payout set status = 'approved' where run_id = p_run and status = 'ready';
  perform app.audit('ops_approve_payout_run', 'payout_run', p_run, null, v_gate);
  return jsonb_build_object('approved', true, 'run_id', p_run);
end $$;

/** Posts the payout entries and returns the bank file rows for execute-payout-run. */
create or replace function app.ops_execute_payout_run(p_run uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p record; v_rows jsonb := '[]'; pr public.payout_run;
begin
  if not app.is_ops(array['finance','admin']::public.ops_role[]) then raise exception 'finance only' using errcode = 'BG100'; end if;
  select * into pr from public.payout_run where id = p_run for update;
  if pr.status <> 'approved' then raise exception 'run must be approved by two people first' using errcode = 'BG130'; end if;
  for p in select * from public.payout where run_id = p_run and status = 'approved' loop
    if p.netted_minor > 0 then perform app.post_cash_netting(p.partner_id, p.payout_id, p.netted_minor, p.currency, pr.market); end if;
    perform app.post_payout(p.payout_id);
    update public.payout set status = 'executing' where payout_id = p.payout_id;
    v_rows := v_rows || jsonb_build_object('payout_id', p.payout_id, 'partner_id', p.partner_id, 'amount_minor', p.net_minor, 'currency', p.currency);
  end loop;
  update public.payout_run set status = 'executing', executed_at = now(), executed_by = auth.uid() where id = p_run;
  perform app.audit('ops_execute_payout_run', 'payout_run', p_run, null, jsonb_build_object('rows', jsonb_array_length(v_rows)));
  return jsonb_build_object('run_id', p_run, 'bank_file', v_rows);
end $$;

/** Bank confirmation. A failure reverts to pending and UNALLOCATES the entries so they roll into the next run (§5). */
create or replace function app.ops_confirm_payout(p_payout uuid, p_provider_ref text, p_success boolean, p_failure_reason text default null)
returns public.payout language plpgsql security definer set search_path = '' as $$
declare p public.payout; tx uuid;
begin
  if not app.is_ops(array['finance','admin']::public.ops_role[]) then raise exception 'finance only' using errcode = 'BG100'; end if;
  select * into p from public.payout where payout_id = p_payout for update;
  if p_success then
    update public.payout set status = 'paid', paid_at = now(), provider_ref = p_provider_ref where payout_id = p_payout returning * into p;
  else
    -- Reverse the payout entries so the payable is owed again, then free the allocation.
    tx := extensions.uuid_generate_v4();
    perform app.post_entries(tx, jsonb_build_array(
      jsonb_build_object('entry_type','debit','account','platform_bank','amount_minor',p.net_minor,'currency',p.currency,'market',(select market from public.partner where partner_id = p.partner_id),
        'partner_id',p.partner_id,'payout_id',p.payout_id,'reference_type','payout','reference_id',p.payout_id,'effective_at',now(),'reason_code','manual_correction'),
      jsonb_build_object('entry_type','credit','account','partner_payable','amount_minor',p.net_minor,'currency',p.currency,'market',(select market from public.partner where partner_id = p.partner_id),
        'partner_id',p.partner_id,'payout_id',p.payout_id,'reference_type','payout','reference_id',p.payout_id,'effective_at',now(),'reason_code','manual_correction')));
    delete from public.payout_allocation where payout_id = p_payout;
    update public.payout set status = 'pending', failure_reason = p_failure_reason, provider_ref = p_provider_ref where payout_id = p_payout returning * into p;
  end if;
  perform app.audit('ops_confirm_payout', 'payout', p_payout, null, to_jsonb(p));
  return p;
end $$;

create or replace function app.ops_payout_runs(p_market public.market)
returns setof public.payout_run language sql stable security definer set search_path = '' as $$
  select * from public.payout_run where market = p_market and app.is_ops(array['finance','admin']::public.ops_role[]) order by period_end desc;
$$;
create or replace function app.ops_payout_run_detail(p_run uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('run', to_jsonb(r), 'payouts', (select coalesce(jsonb_agg(to_jsonb(p) order by p.status, p.net_minor desc), '[]') from public.payout p where p.run_id = r.id),
    'exceptions', (select coalesce(jsonb_agg(jsonb_build_object('payout_id', payout_id, 'partner_id', partner_id, 'reason', hold_reason)), '[]') from public.payout where run_id = r.id and hold_reason is not null))
  from public.payout_run r where r.id = p_run and app.is_ops(array['finance','admin']::public.ops_role[]);
$$;

create or replace function app.ops_reconciliation(p_kind text, p_market public.market, p_from date, p_to date)
returns setof public.reconciliation_exception language sql stable security definer set search_path = '' as $$
  select * from public.reconciliation_exception where kind = p_kind and market = p_market and created_at::date between p_from and p_to
    and app.is_ops(array['finance','admin']::public.ops_role[]) order by status, created_at;
$$;

/** Nothing clears silently: every resolution is reason-coded and audited. */
create or replace function app.ops_resolve_exception(p_id uuid, p_resolution text, p_reason_code text)
returns public.reconciliation_exception language plpgsql security definer set search_path = '' as $$
declare e public.reconciliation_exception;
begin
  if not app.is_ops(array['finance','admin']::public.ops_role[]) then raise exception 'finance only' using errcode = 'BG100'; end if;
  if not exists (select 1 from public.reason_code where code = p_reason_code) then raise exception 'unknown reason code' using errcode = 'BG132'; end if;
  update public.reconciliation_exception set status = 'resolved', resolution = p_resolution, resolved_by = auth.uid(), resolved_at = now()
   where id = p_id returning * into e;
  perform app.audit('ops_resolve_exception', 'reconciliation_exception', p_id, null, to_jsonb(e), p_reason_code, p_resolution, e.market);
  return e;
end $$;

create or replace function app.ops_close_period(p_period uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_ops(array['finance','admin']::public.ops_role[]) then raise exception 'finance only' using errcode = 'BG100'; end if;
  return app.close_period(p_period);
end $$;

create or replace function app.ops_ledger(p_market public.market, p_from date, p_to date, p_account public.ledger_account default null, p_partner uuid default null)
returns setof public.financial_entry language sql stable security definer set search_path = '' as $$
  select * from public.financial_entry where market = p_market and effective_at::date between p_from and p_to
    and (p_account is null or account = p_account) and (p_partner is null or partner_id = p_partner)
    and app.is_ops(array['finance','admin']::public.ops_role[]) order by effective_at desc limit 500;
$$;
create or replace function app.ops_ledger_transaction(p_tx uuid)
returns setof public.financial_entry language sql stable security definer set search_path = '' as $$
  select * from public.financial_entry where transaction_id = p_tx and app.is_ops(array['finance','admin','compliance']::public.ops_role[]) order by entry_type;
$$;
create or replace function app.ops_balance_check(p_market public.market)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('market', p_market, 'balances', coalesce(jsonb_agg(jsonb_build_object('account', account, 'currency', currency, 'balance_minor', balance_minor)), '[]'),
    'suspense_minor', coalesce(sum(balance_minor) filter (where account = 'unreconciled_suspense'), 0))
  from public.v_ledger_balance where market = p_market and app.is_ops(array['finance','admin']::public.ops_role[]);
$$;

grant execute on function app.post_cash_netting, app.ops_create_payout_run, app.ops_approve_payout_run, app.ops_execute_payout_run,
  app.ops_confirm_payout, app.ops_payout_runs, app.ops_payout_run_detail, app.ops_reconciliation, app.ops_resolve_exception,
  app.ops_close_period, app.ops_ledger, app.ops_ledger_transaction, app.ops_balance_check to authenticated;
