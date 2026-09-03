-- An unknown payout id reached post_entries with NULL amounts and surfaced as a
-- raw 23502. Refuse it with a code the client can resolve.
set search_path = public, extensions;
create or replace function app.ops_confirm_payout(p_payout uuid, p_provider_ref text, p_success boolean, p_failure_reason text default null)
returns public.payout language plpgsql security definer set search_path = '' as $$
declare p public.payout; tx uuid; v_market public.market;
begin
  if not app.is_ops(array['finance','admin']::public.ops_role[]) then raise exception 'finance only' using errcode = 'BG100'; end if;
  select * into p from public.payout where payout_id = p_payout for update;
  if not found then raise exception 'unknown payout' using errcode = 'BG102'; end if;
  if p.status <> 'executing' then raise exception 'payout is %, not executing', p.status using errcode = 'BG110'; end if;
  select market into v_market from public.partner where partner_id = p.partner_id;
  if p_success then
    update public.payout set status = 'paid', paid_at = now(), provider_ref = p_provider_ref where payout_id = p_payout returning * into p;
  else
    tx := extensions.uuid_generate_v4();
    perform app.post_entries(tx, jsonb_build_array(
      jsonb_build_object('entry_type','debit','account','platform_bank','amount_minor',p.net_minor,'currency',p.currency,'market',v_market,
        'partner_id',p.partner_id,'payout_id',p.payout_id,'reference_type','payout','reference_id',p.payout_id,'effective_at',now(),'reason_code','manual_correction'),
      jsonb_build_object('entry_type','credit','account','partner_payable','amount_minor',p.net_minor,'currency',p.currency,'market',v_market,
        'partner_id',p.partner_id,'payout_id',p.payout_id,'reference_type','payout','reference_id',p.payout_id,'effective_at',now(),'reason_code','manual_correction')));
    delete from public.payout_allocation where payout_id = p_payout;
    update public.payout set status = 'pending', failure_reason = p_failure_reason, provider_ref = p_provider_ref where payout_id = p_payout returning * into p;
  end if;
  perform app.audit('ops_confirm_payout', 'payout', p_payout, null, to_jsonb(p), null, p_failure_reason, v_market);
  return p;
end $$;
