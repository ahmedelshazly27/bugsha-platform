-- ============================================================================
-- Phase 5 (cont.) — promotions, chargebacks, adjustments, the order lifecycle,
-- four-eyes and period close.
-- ============================================================================
set search_path = public, extensions;

/**
 * §3.8 Promotion capture. WHO FUNDS THE DISCOUNT CHANGES THE COMMISSION BASE:
 *   platform -> consumer pays less, partner is paid in full, commission on GROSS
 *   partner  -> partner absorbs it, commission on the DISCOUNTED amount
 * promotion.funded_by is NOT NULL with no default precisely so this branch can
 * never be taken by accident.
 */
create or replace function app.post_promo_capture(
  p_order_id uuid, p_gross_minor bigint, p_discount_minor bigint,
  p_funded_by public.promotion_funder, p_payment_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare o public."order"; tx uuid := extensions.uuid_generate_v4();
        v_discounted bigint; v_commission bigint; v_base bigint;
begin
  select * into o from public."order" where order_id = p_order_id;
  if not found then raise exception 'unknown order' using errcode = 'BG102'; end if;
  v_discounted := p_gross_minor - p_discount_minor;
  v_base := case when p_funded_by = 'platform' then p_gross_minor else v_discounted end;
  v_commission := app.commission_of(v_base, o.commission_bp);

  if p_funded_by = 'platform' then
    perform app.post_entries(tx, jsonb_build_array(
      jsonb_build_object('entry_type','debit','account','cash_in_transit',
        'amount_minor', v_discounted,'currency',o.currency,'market',o.market,
        'partner_id',o.partner_id,'order_id',o.order_id,'payment_id',p_payment_id,
        'reference_type','promotion','reference_id',o.order_id,'effective_at',now(),
        'contract_version_id',o.contract_version_id),
      jsonb_build_object('entry_type','debit','account','promotion_expense_platform',
        'amount_minor', p_discount_minor,'currency',o.currency,'market',o.market,
        'partner_id',o.partner_id,'order_id',o.order_id,
        'reference_type','promotion','reference_id',o.order_id,'effective_at',now()),
      jsonb_build_object('entry_type','credit','account','partner_payable',
        'amount_minor', p_gross_minor - v_commission,'currency',o.currency,'market',o.market,
        'partner_id',o.partner_id,'order_id',o.order_id,
        'reference_type','promotion','reference_id',o.order_id,'effective_at',now(),
        'contract_version_id',o.contract_version_id),
      jsonb_build_object('entry_type','credit','account','commission_revenue',
        'amount_minor', v_commission,'currency',o.currency,'market',o.market,
        'partner_id',o.partner_id,'order_id',o.order_id,
        'reference_type','promotion','reference_id',o.order_id,'effective_at',now(),
        'contract_version_id',o.contract_version_id)));
  else
    perform app.post_entries(tx, jsonb_build_array(
      jsonb_build_object('entry_type','debit','account','cash_in_transit',
        'amount_minor', v_discounted,'currency',o.currency,'market',o.market,
        'partner_id',o.partner_id,'order_id',o.order_id,'payment_id',p_payment_id,
        'reference_type','promotion','reference_id',o.order_id,'effective_at',now(),
        'contract_version_id',o.contract_version_id),
      jsonb_build_object('entry_type','credit','account','partner_payable',
        'amount_minor', v_discounted - v_commission,'currency',o.currency,'market',o.market,
        'partner_id',o.partner_id,'order_id',o.order_id,
        'reference_type','promotion','reference_id',o.order_id,'effective_at',now(),
        'contract_version_id',o.contract_version_id),
      jsonb_build_object('entry_type','credit','account','commission_revenue',
        'amount_minor', v_commission,'currency',o.currency,'market',o.market,
        'partner_id',o.partner_id,'order_id',o.order_id,
        'reference_type','promotion','reference_id',o.order_id,'effective_at',now(),
        'contract_version_id',o.contract_version_id)));
  end if;
  return tx;
end $$;

/**
 * §3.9 Chargeback. Whether the partner bears the risk is a CONTRACT TERM
 * (partner_contract.chargeback_bearer) — read it, never assume (decision 6).
 */
create or replace function app.post_chargeback(p_order_id uuid, p_fee_minor bigint default 0)
returns uuid language plpgsql security definer set search_path = '' as $$
declare o public."order"; c public.partner_contract; tx uuid := extensions.uuid_generate_v4();
        v_recoverable bigint; v_loss bigint; v_legs jsonb;
begin
  select * into o from public."order" where order_id = p_order_id;
  if not found then raise exception 'unknown order' using errcode = 'BG102'; end if;
  select * into c from public.partner_contract where id = o.contract_version_id;

  if c.chargeback_bearer = 'partner' then
    v_recoverable := o.total_minor - o.commission_minor;
    v_loss := p_fee_minor;
  else
    v_recoverable := 0;
    v_loss := (o.total_minor - o.commission_minor) + p_fee_minor;
  end if;

  v_legs := jsonb_build_array(
    jsonb_build_object('entry_type','debit','account','commission_revenue',
      'amount_minor', o.commission_minor,'currency',o.currency,'market',o.market,
      'partner_id',o.partner_id,'order_id',o.order_id,
      'reference_type','chargeback','reference_id',o.order_id,'effective_at',now(),
      'contract_version_id',o.contract_version_id),
    jsonb_build_object('entry_type','credit','account','platform_bank',
      'amount_minor', o.total_minor + p_fee_minor,'currency',o.currency,'market',o.market,
      'partner_id',o.partner_id,'order_id',o.order_id,
      'reference_type','chargeback','reference_id',o.order_id,'effective_at',now()));

  if v_recoverable > 0 then
    v_legs := v_legs || jsonb_build_object('entry_type','debit','account','partner_payable',
      'amount_minor', v_recoverable,'currency',o.currency,'market',o.market,
      'partner_id',o.partner_id,'order_id',o.order_id,
      'reference_type','chargeback','reference_id',o.order_id,'effective_at',now(),
      'contract_version_id',o.contract_version_id);
  end if;
  if v_loss > 0 then
    v_legs := v_legs || jsonb_build_object('entry_type','debit','account','chargeback_losses',
      'amount_minor', v_loss,'currency',o.currency,'market',o.market,
      'partner_id',o.partner_id,'order_id',o.order_id,
      'reference_type','chargeback','reference_id',o.order_id,'effective_at',now());
  end if;

  perform app.post_entries(tx, v_legs);
  return tx;
end $$;

-- ─── DECISION D15: four eyes cannot both RAISE and REMEMBER ────────────────
-- 07-api.md §four-eyes says the first call "inserts a pending_approval row and
-- raises BG130". In Postgres those contradict: RAISE aborts the transaction,
-- rolling back the very INSERT meant to record the first approval, so every
-- call is forever "the first one" and no four-eyes operation can EVER
-- complete. Proven by ledger test L17.
--
-- The gate now RETURNS its verdict so the pending row commits. Callers surface
-- {status:'pending_approval'}, which maps to the 428 the API doc already
-- specifies for BG130. Two DISTINCT actors are still required, both recorded.
drop function if exists app.require_four_eyes(text, uuid, jsonb);
create function app.require_four_eyes(p_operation text, p_target uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hash text; v_row public.pending_approval; v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'a four-eyes operation requires an authenticated actor' using errcode = 'BG100';
  end if;
  v_hash := encode(extensions.digest(coalesce(p_payload, '{}'::jsonb)::text, 'sha256'), 'hex');

  select * into v_row from public.pending_approval
  where operation = p_operation and target_id is not distinct from p_target
    and payload_hash = v_hash and consumed_at is null and first_actor <> v_actor
  limit 1;

  if found then
    update public.pending_approval
       set second_actor = v_actor, second_at = now(), consumed_at = now()
     where id = v_row.id;
    return jsonb_build_object('approved', true, 'approval_id', v_row.id,
                              'first_actor', v_row.first_actor, 'second_actor', v_actor);
  end if;

  insert into public.pending_approval (operation, target_id, payload_hash, first_actor)
  values (p_operation, p_target, v_hash, v_actor)
  on conflict (operation, target_id, payload_hash, first_actor) do nothing;

  -- Deliberately NOT an exception: the row above must survive this call.
  return jsonb_build_object('approved', false, 'status', 'pending_approval',
                            'operation', p_operation, 'first_actor', v_actor, 'errcode', 'BG130');
end $$;

/** §3.10 Manual adjustment. No adjustment without a reason — the column is NOT NULL. */
drop function if exists app.post_adjustment(public.market, jsonb, text, text, timestamptz);
create function app.post_adjustment(
  p_market public.market, p_entries jsonb, p_reason_code text,
  p_justification text, p_effective_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare tx uuid := extensions.uuid_generate_v4(); v_cfg public.market_config;
        v_debits bigint; v_credits bigint; v_max bigint; v_legs jsonb := '[]'::jsonb;
        e jsonb; v_gate jsonb;
begin
  if coalesce(p_reason_code, '') = '' then
    raise exception 'an adjustment requires a reason code' using errcode = 'BG132';
  end if;
  if not exists (select 1 from public.reason_code where code = p_reason_code) then
    raise exception 'unknown reason code %', p_reason_code using errcode = 'BG132';
  end if;
  if length(coalesce(p_justification, '')) < 10 then
    raise exception 'an adjustment requires a written justification' using errcode = 'BG132';
  end if;
  if jsonb_array_length(p_entries) < 2 then
    raise exception 'an adjustment needs at least two legs' using errcode = 'BG002';
  end if;

  select * into v_cfg from public.market_config where market = p_market;
  select coalesce(sum((x->>'amount_minor')::bigint) filter (where x->>'entry_type' = 'debit'), 0),
         coalesce(sum((x->>'amount_minor')::bigint) filter (where x->>'entry_type' = 'credit'), 0),
         coalesce(max((x->>'amount_minor')::bigint), 0)
    into v_debits, v_credits, v_max
  from jsonb_array_elements(p_entries) x;

  -- Balance is checked BEFORE the gate: a proposal that could never post
  -- should not consume an approver's attention.
  if v_debits <> v_credits then
    raise exception 'adjustment does not balance: % debits against % credits', v_debits, v_credits
      using errcode = 'BG002';
  end if;

  if v_max >= v_cfg.adjustment_four_eyes_minor then
    v_gate := app.require_four_eyes('ops_post_adjustment', null,
      jsonb_build_object('m', p_market, 'e', p_entries, 'r', p_reason_code));
    if not (v_gate->>'approved')::boolean then
      return v_gate;              -- committed as pending; client renders 428
    end if;
  end if;

  for e in select * from jsonb_array_elements(p_entries) loop
    v_legs := v_legs || (e || jsonb_build_object(
      'currency', v_cfg.currency, 'market', p_market,
      'reference_type','adjustment','reference_id', tx,
      'effective_at', p_effective_at, 'reason_code', p_reason_code,
      'created_by', coalesce(auth.uid()::text, 'system')));
  end loop;

  perform app.post_entries(tx, v_legs);
  perform app.audit('post_adjustment', 'financial_entry', tx, null, p_entries,
                    p_reason_code, p_justification, p_market);
  return jsonb_build_object('approved', true, 'status', 'posted', 'transaction_id', tx,
                            'approval', v_gate);
end $$;

/**
 * Held -> reserved, with the capture posted in the SAME transaction.
 * Idempotent on the provider reference: a webhook arriving after the client
 * return, or a replay, produces no second transaction (§payments P2, P3, P4).
 */
create or replace function app.confirm_order(
  p_order_id uuid, p_provider text, p_provider_ref text,
  p_method public.payment_method, p_psp_fee_minor bigint, p_idempotency text
) returns public."order"
language plpgsql security definer set search_path = '' as $$
declare o public."order"; v_payment public.payment; v_replay jsonb;
begin
  v_replay := app.idempotent_replay(p_idempotency, 'confirm_order',
    jsonb_build_object('o', p_order_id, 'ref', p_provider_ref));
  if v_replay is not null and not coalesce((v_replay->>'pending')::boolean, false) then
    select * into o from public."order" where order_id = p_order_id;
    return o;
  end if;

  select * into o from public."order" where order_id = p_order_id for update;
  if not found then raise exception 'unknown order' using errcode = 'BG102'; end if;

  if o.status = 'reserved' then     -- already confirmed: never a second capture
    perform app.idempotent_record(p_idempotency, jsonb_build_object('order_id', o.order_id));
    return o;
  end if;
  if o.status <> 'held' then
    raise exception 'this order is % and cannot be confirmed', o.status using errcode = 'BG110';
  end if;

  -- The provider reference is the idempotency anchor for reconciliation.
  select * into v_payment from public.payment
   where provider = p_provider and provider_ref = p_provider_ref;
  if found then
    perform app.idempotent_record(p_idempotency, jsonb_build_object('order_id', o.order_id));
    return o;
  end if;

  insert into public.payment (order_id, provider, provider_ref, method, amount_minor,
                              currency, status, psp_fee_minor, authorised_at, captured_at)
  values (o.order_id, p_provider, p_provider_ref, p_method, o.total_minor,
          o.currency, 'captured', p_psp_fee_minor, now(), now())
  returning * into v_payment;

  update public."order"
     set status = 'reserved', payment_status = 'captured', method = p_method,
         hold_expires_at = null, updated_at = now()
   where order_id = p_order_id returning * into o;

  perform app.post_order_capture(o.order_id, v_payment.payment_id);

  insert into public.compliance_entry (store_id, partner_id, event_type, listing_id, order_id,
    category, quantity, declared_value_minor, currency, window_start_utc, window_end_utc)
  values (o.store_id, o.partner_id, 'order_reserved', o.listing_id, o.order_id,
    null, o.quantity, o.total_minor, o.currency, o.window_start_utc, o.window_end_utc);

  perform app.idempotent_record(p_idempotency, jsonb_build_object('order_id', o.order_id));
  return o;
end $$;

/** Egypt only. No payment row, no ledger entries — the money moves at pickup. */
create or replace function app.reserve_cash_order(p_order_id uuid, p_idempotency text)
returns public."order"
language plpgsql security definer set search_path = '' as $$
declare o public."order"; v_cfg public.market_config; v_replay jsonb; v_open integer;
begin
  v_replay := app.idempotent_replay(p_idempotency, 'reserve_cash_order',
    jsonb_build_object('o', p_order_id));
  if v_replay is not null and not coalesce((v_replay->>'pending')::boolean, false) then
    select * into o from public."order" where order_id = p_order_id;
    return o;
  end if;

  select * into o from public."order" where order_id = p_order_id for update;
  if not found then raise exception 'unknown order' using errcode = 'BG102'; end if;
  select * into v_cfg from public.market_config where market = o.market;

  if not v_cfg.cash_enabled then
    raise exception 'cash on pickup is not offered in %', o.market using errcode = 'BG110';
  end if;

  select coalesce(sum(x.quantity), 0) into v_open from public."order" x
   where x.consumer_id = o.consumer_id and x.method = 'cash'
     and x.status in ('held','reserved') and x.order_id <> o.order_id;
  if v_open + o.quantity > v_cfg.reservation_cap_cash then
    raise exception '% is the most cash orders at once', v_cfg.reservation_cap_cash
      using errcode = 'BG113';
  end if;

  update public."order"
     set status = 'reserved', method = 'cash', payment_status = 'none',
         hold_expires_at = null, updated_at = now()
   where order_id = p_order_id returning * into o;
  perform app.idempotent_record(p_idempotency, jsonb_build_object('order_id', o.order_id));
  return o;
end $$;

/**
 * Consumer cancellation, permitted until market_config.cancel_cutoff_hours
 * before the window opens. After that there is no self-service path (rule 3).
 */
create or replace function app.cancel_order(
  p_order_id uuid, p_reason_code text, p_destination text default 'source'
) returns public."order"
language plpgsql security definer set search_path = '' as $$
declare o public."order"; v_cfg public.market_config; v_refund uuid; v_payment uuid;
begin
  select * into o from public."order" where order_id = p_order_id for update;
  if not found then raise exception 'unknown order' using errcode = 'BG102'; end if;
  if o.consumer_id <> auth.uid() and not app.is_ops() then
    raise exception 'not your order' using errcode = 'BG100';
  end if;
  select * into v_cfg from public.market_config where market = o.market;

  if o.status not in ('held', 'reserved') then
    raise exception 'this order is % and cannot be cancelled', o.status using errcode = 'BG110';
  end if;
  if o.status = 'reserved'
     and now() > o.window_start_utc - make_interval(hours => v_cfg.cancel_cutoff_hours) then
    raise exception 'cancellation closed % hours before pickup', v_cfg.cancel_cutoff_hours
      using errcode = 'BG116';
  end if;

  perform app.restore_stock(o.listing_id, o.quantity);

  -- A cash order moved no money, so there is nothing to refund.
  if o.payment_status = 'captured' then
    select payment_id into v_payment from public.payment where order_id = o.order_id limit 1;
    insert into public.refund (order_id, payment_id, amount_minor, destination, reason_code,
                               cost_bearer, status, requested_by)
    values (o.order_id, v_payment, o.total_minor, p_destination, p_reason_code,
            'platform', 'approved', auth.uid())
    returning refund_id into v_refund;
    if p_destination = 'wallet' then
      perform app.post_refund_to_wallet(v_refund);
    else
      perform app.post_refund(v_refund, true);
    end if;
  end if;

  update public."order"
     set status = 'cancelled_consumer', cancelled_at = now(),
         cancelled_reason_code = p_reason_code,
         payment_status = case when o.payment_status = 'captured'
                               then 'refunded'::public.payment_status else o.payment_status end,
         updated_at = now()
   where order_id = p_order_id returning * into o;
  return o;
end $$;

/**
 * Period close is an EXPLICIT OPERATION, not a date passing. It returns the
 * failing checklist rather than closing with warnings — closing a period that
 * cannot later be audited is worse than closing late (05-money.md §6.4).
 */
create or replace function app.close_period(p_period_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.accounting_period; v_checks jsonb;
        v_suspense bigint; v_open_exceptions integer; v_imbalance integer; v_ok boolean;
begin
  select * into p from public.accounting_period where id = p_period_id;
  if not found then raise exception 'unknown period' using errcode = 'BG102'; end if;
  if p.locked_at is not null then
    return jsonb_build_object('closed', true, 'note', 'already locked', 'checks', '[]'::jsonb);
  end if;

  select coalesce(sum(case when entry_type='debit' then amount_minor else -amount_minor end), 0)
    into v_suspense from public.financial_entry
   where market = p.market and account = 'unreconciled_suspense'
     and effective_at::date between p.period_start and p.period_end;

  select count(*) into v_open_exceptions from public.reconciliation_exception
   where market = p.market and status = 'open';

  select count(*) into v_imbalance from (
    select transaction_id from public.financial_entry where market = p.market
     group by transaction_id, currency
    having sum(case when entry_type='debit' then amount_minor else -amount_minor end) <> 0) t;

  v_checks := jsonb_build_array(
    jsonb_build_object('check','unreconciled_suspense_zero','pass', v_suspense = 0, 'value', v_suspense),
    jsonb_build_object('check','reconciliations_clean','pass', v_open_exceptions = 0, 'value', v_open_exceptions),
    jsonb_build_object('check','ledger_balanced','pass', v_imbalance = 0, 'value', v_imbalance));

  select bool_and((c->>'pass')::boolean) into v_ok from jsonb_array_elements(v_checks) c;
  if not v_ok then
    return jsonb_build_object('closed', false, 'checks', v_checks);   -- button stays DISABLED
  end if;

  update public.accounting_period set locked_at = now(), locked_by = auth.uid()
   where id = p_period_id;
  perform app.audit('close_period', 'accounting_period', p_period_id, null, v_checks,
                    null, 'period close', p.market);
  return jsonb_build_object('closed', true, 'checks', v_checks);
end $$;

grant execute on function app.post_promo_capture, app.post_chargeback, app.post_adjustment,
  app.require_four_eyes, app.confirm_order, app.reserve_cash_order, app.cancel_order,
  app.close_period to authenticated;
