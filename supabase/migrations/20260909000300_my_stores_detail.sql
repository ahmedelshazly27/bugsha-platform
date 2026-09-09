-- The partner app needs to know which stores the signed-in person can act on,
-- with names, to pick one after sign-in (S-P-001).
set search_path = public, extensions;

create or replace function app.my_stores_detail()
returns table (store_id uuid, partner_id uuid, role public.partner_role, display_name text, trading_name text, market public.market, timezone text)
language sql stable security definer set search_path = '' as $$
  select m.store_id, m.partner_id, m.role, s.display_name, p.trading_name, s.market, s.timezone
  from app.my_stores() m
  join public.store s on s.store_id = m.store_id
  join public.partner p on p.partner_id = m.partner_id
  where s.permanently_closed_at is null
  order by p.trading_name, s.display_name;
$$;
grant execute on function app.my_stores(public.partner_role[]) to authenticated;
grant execute on function app.my_stores_detail() to authenticated;
