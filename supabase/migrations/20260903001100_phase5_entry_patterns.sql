-- ============================================================================
-- Phase 5 — the entry patterns from docs/05-money.md §3.
-- Each is called INSIDE the transaction that performs the state change, so the
-- ledger and the state can never disagree. All build on app.post_entries; the
-- deferred balance trigger proves each transaction balances at COMMIT.
-- ============================================================================
set search_path = public, extensions;

/** §3.1 Digital order, captured. Commission is the STAMPED value, not derived. */
create or replace function app.post_order_capture(p_order_id uuid, p_payment_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare o public."order"; tx uuid := extensions.uuid_generate_v4();
begin
  select * into o from public."order" where order_id = p_order_id;
  if not found then raise exception 'unknown order' using errcode = 'BG102'; end if;
  perform app.post_entries(tx, jsonb_build_array(
    jsonb_build_object('entry_type','debit','account','cash_in_transit',
      'amount_minor', o.total_minor,'currency',o.currency,'market',o.market,
      'partner_id',o.partner_id,'store_id',o.store_id,'order_id',o.order_id,
      'payment_id',p_payment_id,'reference_type','order','reference_id',o.order_id,
      'effective_at',now(),'contract_version_id',o.contract_version_id),
    jsonb_build_object('entry_type','credit','account','partner_payable',
      'amount_minor', o.total_minor - o.commission_minor,'currency',o.currency,'market',o.market,
      'partner_id',o.partner_id,'store_id',o.store_id,'order_id',o.order_id,
      'payment_id',p_payment_id,'reference_type','order','reference_id',o.order_id,
      'effective_at',now(),'contract_version_id',o.contract_version_id),
    jsonb_build_object('entry_type','credit','account','commission_revenue',
      'amount_minor', o.commission_minor,'currency',o.currency,'market',o.market,
      'partner_id',o.partner_id,'store_id',o.store_id,'order_id',o.order_id,
      'payment_id',p_payment_id,'reference_type','order','reference_id',o.order_id,
      'effective_at',now(),'contract_version_id',o.contract_version_id)));
  return tx;
end $$;

/** §3.1 Settlement: platform_bank + psp_fees = cash_in_transit. */
create or replace function app.post_settlement(p_payment_id uuid, p_settled_at timestamptz default now())
returns uuid language plpgsql security definer set search_path = '' as $$
declare p public.payment; o public."order"; tx uuid := extensions.uuid_generate_v4(); v_fee bigint;
begin
  select * into p from public.payment where payment_id = p_payment_id;
  if not found then raise exception 'unknown payment' using errcode = 'BG102'; end if;
  select * into o from public."order" where order_id = p.order_id;
  v_fee := coalesce(p.psp_fee_minor, 0);
  perform app.post_entries(tx, jsonb_build_array(
    jsonb_build_object('entry_type','debit','account','platform_bank',
      'amount_minor', p.amount_minor - v_fee,'currency',p.currency,'market',o.market,
      'partner_id',o.partner_id,'order_id',o.order_id,'payment_id',p.payment_id,
      'reference_type','settlement','reference_id',p.payment_id,'effective_at',p_settled_at),
    jsonb_build_object('entry_type','debit','account','psp_fees',
      'amount_minor', v_fee,'currency',p.currency,'market',o.market,
      'partner_id',o.partner_id,'order_id',o.order_id,'payment_id',p.payment_id,
      'reference_type','settlement','reference_id',p.payment_id,'effective_at',p_settled_at),
    jsonb_build_object('entry_type','credit','account','cash_in_transit',
      'amount_minor', p.amount_minor,'currency',p.currency,'market',o.market,
      'partner_id',o.partner_id,'order_id',o.order_id,'payment_id',p.payment_id,
      'reference_type','settlement','reference_id',p.payment_id,'effective_at',p_settled_at)));
  return tx;
end $$;

/**
 * §3.3 Cash order, redeemed. The platform never touches the money, so only
 * commission is recognised — as a RECEIVABLE. Computed on what was actually
 * COLLECTED, not on the order total (§payments P10).
 */
create or replace function app.post_cash_commission(p_order_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare o public."order"; c public.cash_collection; tx uuid := extensions.uuid_generate_v4(); v_comm bigint;
begin
  select * into o from public."order" where order_id = p_order_id;
  select * into c from public.cash_collection where order_id = p_order_id;
  if not found then raise exception 'no cash collection recorded' using errcode = 'BG102'; end if;
  v_comm := app.commission_of(c.collected_minor, o.commission_bp);
  perform app.post_entries(tx, jsonb_build_array(
    jsonb_build_object('entry_type','debit','account','partner_receivable',
      'amount_minor', v_comm,'currency',o.currency,'market',o.market,
      'partner_id',o.partner_id,'store_id',o.store_id,'order_id',o.order_id,
      'reference_type','order','reference_id',o.order_id,'effective_at',now(),
      'contract_version_id',o.contract_version_id),
    jsonb_build_object('entry_type','credit','account','commission_revenue',
      'amount_minor', v_comm,'currency',o.currency,'market',o.market,
      'partner_id',o.partner_id,'store_id',o.store_id,'order_id',o.order_id,
      'reference_type','order','reference_id',o.order_id,'effective_at',now(),
      'contract_version_id',o.contract_version_id)));
  return tx;
end $$;

/**
 * §3.5 Refund to source. The PSP fee is NOT returned: it stays in psp_fees
 * unless partner_contract.psp_fee_bearer says otherwise (decision 5).
 */
create or replace function app.post_refund(p_refund_id uuid, p_disburse boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.refund; o public."order"; tx uuid := extensions.uuid_generate_v4(); tx2 uuid;
begin
  select * into r from public.refund where refund_id = p_refund_id;
  if not found then raise exception 'unknown refund' using errcode = 'BG102'; end if;
  select * into o from public."order" where order_id = r.order_id;

  perform app.post_entries(tx, jsonb_build_array(
    jsonb_build_object('entry_type','debit','account','partner_payable',
      'amount_minor', r.amount_minor - o.commission_minor,'currency',o.currency,'market',o.market,
      'partner_id',o.partner_id,'order_id',o.order_id,'payment_id',r.payment_id,
      'reference_type','refund','reference_id',r.refund_id,'effective_at',now(),
      'contract_version_id',o.contract_version_id,'reason_code',r.reason_code),
    jsonb_build_object('entry_type','debit','account','commission_revenue',
      'amount_minor', o.commission_minor,'currency',o.currency,'market',o.market,
      'partner_id',o.partner_id,'order_id',o.order_id,'payment_id',r.payment_id,
      'reference_type','refund','reference_id',r.refund_id,'effective_at',now(),
      'contract_version_id',o.contract_version_id,'reason_code',r.reason_code),
    jsonb_build_object('entry_type','credit','account','refunds_payable',
      'amount_minor', r.amount_minor,'currency',o.currency,'market',o.market,
      'partner_id',o.partner_id,'order_id',o.order_id,'payment_id',r.payment_id,
      'reference_type','refund','reference_id',r.refund_id,'effective_at',now())));

  if p_disburse then
    tx2 := extensions.uuid_generate_v4();
    perform app.post_entries(tx2, jsonb_build_array(
      jsonb_build_object('entry_type','debit','account','refunds_payable',
        'amount_minor', r.amount_minor,'currency',o.currency,'market',o.market,
        'partner_id',o.partner_id,'order_id',o.order_id,
        'reference_type','refund','reference_id',r.refund_id,'effective_at',now()),
      jsonb_build_object('entry_type','credit','account','platform_bank',
        'amount_minor', r.amount_minor,'currency',o.currency,'market',o.market,
        'partner_id',o.partner_id,'order_id',o.order_id,
        'reference_type','refund','reference_id',r.refund_id,'effective_at',now())));
  end if;
  return tx;
end $$;

/** §3.6 Refund as wallet credit. Later spend reduces the liability, no new capture. */
create or replace function app.post_refund_to_wallet(p_refund_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.refund; o public."order"; tx uuid := extensions.uuid_generate_v4();
begin
  select * into r from public.refund where refund_id = p_refund_id;
  select * into o from public."order" where order_id = r.order_id;
  perform app.post_entries(tx, jsonb_build_array(
    jsonb_build_object('entry_type','debit','account','partner_payable',
      'amount_minor', r.amount_minor - o.commission_minor,'currency',o.currency,'market',o.market,
      'partner_id',o.partner_id,'order_id',o.order_id,
      'reference_type','refund','reference_id',r.refund_id,'effective_at',now(),
      'contract_version_id',o.contract_version_id),
    jsonb_build_object('entry_type','debit','account','commission_revenue',
      'amount_minor', o.commission_minor,'currency',o.currency,'market',o.market,
      'partner_id',o.partner_id,'order_id',o.order_id,
      'reference_type','refund','reference_id',r.refund_id,'effective_at',now(),
      'contract_version_id',o.contract_version_id),
    jsonb_build_object('entry_type','credit','account','consumer_wallet_liability',
      'amount_minor', r.amount_minor,'currency',o.currency,'market',o.market,
      'partner_id',o.partner_id,'order_id',o.order_id,
      'reference_type','refund','reference_id',r.refund_id,'effective_at',now())));
  insert into public.wallet_transaction (consumer_id, amount_minor, currency, market, source,
                                         reference_type, reference_id)
  values (o.consumer_id, r.amount_minor, o.currency, o.market, 'refund', 'refund', r.refund_id);
  return tx;
end $$;

/**
 * §3.7 Goodwill, platform-funded. The partner is UNAFFECTED. This must be the
 * default whenever the service failure was the platform's.
 */
create or replace function app.post_goodwill(
  p_consumer uuid, p_amount_minor bigint, p_market public.market,
  p_reason_code text, p_order_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare tx uuid := extensions.uuid_generate_v4(); v_currency char(3);
begin
  if coalesce(p_reason_code, '') = '' then
    raise exception 'a goodwill credit needs a reason code' using errcode = 'BG132';
  end if;
  select currency into v_currency from public.market_config where market = p_market;
  perform app.post_entries(tx, jsonb_build_array(
    jsonb_build_object('entry_type','debit','account','goodwill_expense',
      'amount_minor', p_amount_minor,'currency',v_currency,'market',p_market,
      'order_id',p_order_id,'reference_type','adjustment','reference_id',
      coalesce(p_order_id, tx),'effective_at',now(),'reason_code',p_reason_code),
    jsonb_build_object('entry_type','credit','account','consumer_wallet_liability',
      'amount_minor', p_amount_minor,'currency',v_currency,'market',p_market,
      'order_id',p_order_id,'reference_type','adjustment','reference_id',
      coalesce(p_order_id, tx),'effective_at',now(),'reason_code',p_reason_code)));
  insert into public.wallet_transaction (consumer_id, amount_minor, currency, market, source,
                                         reference_type, reference_id)
  values (p_consumer, p_amount_minor, v_currency, p_market, 'goodwill', 'adjustment',
          coalesce(p_order_id, tx));
  return tx;
end $$;

/** §3.1 Payout: DR partner_payable / CR platform_bank. Never a debit to a partner. */
create or replace function app.post_payout(p_payout_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare p public.payout; tx uuid := extensions.uuid_generate_v4(); v_market public.market;
begin
  select * into p from public.payout where payout_id = p_payout_id;
  if not found then raise exception 'unknown payout' using errcode = 'BG102'; end if;
  if p.net_minor <= 0 then
    raise exception 'a payout of % is carried forward, never debited', p.net_minor
      using errcode = 'BG133';
  end if;
  select market into v_market from public.partner where partner_id = p.partner_id;
  perform app.post_entries(tx, jsonb_build_array(
    jsonb_build_object('entry_type','debit','account','partner_payable',
      'amount_minor', p.net_minor,'currency',p.currency,'market',v_market,
      'partner_id',p.partner_id,'payout_id',p.payout_id,
      'reference_type','payout','reference_id',p.payout_id,'effective_at',now()),
    jsonb_build_object('entry_type','credit','account','platform_bank',
      'amount_minor', p.net_minor,'currency',p.currency,'market',v_market,
      'partner_id',p.partner_id,'payout_id',p.payout_id,
      'reference_type','payout','reference_id',p.payout_id,'effective_at',now())));
  return tx;
end $$;

grant execute on function app.post_order_capture, app.post_settlement, app.post_cash_commission,
  app.post_refund, app.post_refund_to_wallet, app.post_goodwill, app.post_payout to authenticated;
