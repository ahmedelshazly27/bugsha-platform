-- Business decisions taken 2026-09-09 (docs/DECISIONS.md D24–D36, 13-config.md §2).
set search_path = public, extensions;

alter table market_config
  add column if not exists deletion_clock_days integer,
  add column if not exists financial_retention_years integer,
  add column if not exists payout_channel text not null default 'manual' check (payout_channel in ('manual','bank_file','api'));
alter table market_config_history
  add column if not exists deletion_clock_days integer,
  add column if not exists financial_retention_years integer,
  add column if not exists payout_channel text;

-- Keep the prior rows in history before restating.
insert into market_config_history select * from market_config;

-- Decision 1: Egypt VAT 14% on the platform's commission; platform e-invoices the partner (ETA).
update market_config set
  vat_applies = true, vat_bp = 1400, vat_base = 'commission', vat_effective_from = current_date,
  invoicing_mode = 'platform_invoices_partner',
  deletion_clock_days = 30, financial_retention_years = 5,
  version = version + 1, updated_at = now()
where market = 'EG';

-- Decision 2: Kuwait has no VAT before 2028; stays off. Cash on pickup enabled (founder, 2026-09-09).
update market_config set
  cash_enabled = true,
  payment_methods = case when 'cash' = any(payment_methods) then payment_methods else payment_methods || '{cash}'::payment_method[] end,
  reservation_cap_cash = 1,
  cash_variance_threshold_minor = 500, cash_liability_escalate_minor = 100000, cash_liability_escalate_days = 30,
  deletion_clock_days = 30, financial_retention_years = 10,
  version = version + 1, updated_at = now()
where market = 'KW';

-- Decision 7: cash commission is invoiced in both markets, never netted.
alter table partner_contract alter column cash_settlement_mode set default 'invoice';
update partner_contract set cash_settlement_mode = 'invoice' where cash_settlement_mode = 'net';

-- Decision 11: the deletion clock is now configured; request_deletion schedules instead of raising.
create or replace function app.request_deletion()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_days integer; v_when timestamptz;
begin
  if exists (select 1 from public."order" where consumer_id = auth.uid() and status in ('held','reserved')) then
    raise exception 'collect or cancel your open orders first' using errcode = 'BG110';
  end if;
  select mc.deletion_clock_days into v_days
  from public.consumer_profile c join public.market_config mc on mc.market = c.market where c.user_id = auth.uid();
  if v_days is null then raise exception 'deletion clock is not configured for this market' using errcode = 'BG150'; end if;
  v_when := now() + make_interval(days => v_days);
  update public.consumer_profile set deletion_requested_at = now() where user_id = auth.uid();
  perform app.audit('request_deletion', 'consumer_profile', auth.uid(), null, jsonb_build_object('scheduled_for', v_when));
  -- Financial records are retained for financial_retention_years; only identity fields are erased on the clock.
  return jsonb_build_object('scheduled_for', v_when, 'days', v_days);
end $$;
