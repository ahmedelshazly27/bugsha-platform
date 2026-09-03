-- Phase 5 (completion) — the plpgsql twin of core/market.ts resolveTax.
-- Decision 1 is undecided for Egypt: vat_bp and vat_base are NULL. This must
-- RAISE BG150, never return zero — an accidental zero-rate is a tax liability
-- nobody discovers until an audit (13-config.md §2).
set search_path = public, extensions;

create or replace function app.resolve_tax(p_market public.market, p_base_minor bigint, p_at timestamptz default now())
returns bigint language plpgsql stable set search_path = '' as $$
declare c public.market_config;
begin
  select * into c from public.market_config where market = p_market;
  if not found then raise exception 'unknown market %', p_market using errcode = 'BG102'; end if;
  if not c.vat_applies then return 0; end if;
  if c.vat_bp is null or c.vat_base is null or (c.vat_effective_from is not null and p_at::date < c.vat_effective_from) then
    raise exception 'tax configuration for % is undecided (decision 1) — refusing to assume zero', p_market
      using errcode = 'BG150';
  end if;
  return app.commission_of(p_base_minor, c.vat_bp);
end $$;

grant execute on function app.resolve_tax to authenticated;
