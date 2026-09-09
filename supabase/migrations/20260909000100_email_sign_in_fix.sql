-- Restores the original complete_profile body (market defaults for locale and
-- numerals; the single live-city check that raises BG119) with only the identity
-- source changed: verified email from the JWT instead of phone.
set search_path = public, extensions;

create or replace function app.complete_profile(
  p_first_name text, p_market public.market, p_city_id uuid default null,
  p_last_name text default null, p_email text default null,
  p_locale public.locale_code default null, p_phone text default null
) returns public.consumer_profile
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_email text; v_cfg public.market_config; v_row public.consumer_profile;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = 'BG100'; end if;
  if coalesce(trim(p_first_name), '') = '' then
    raise exception 'first name is required' using errcode = 'BG102';
  end if;

  select * into v_cfg from public.market_config where market = p_market;
  if not found then raise exception 'unknown market %', p_market using errcode = 'BG102'; end if;

  -- The email comes from the verified JWT, never from the caller (p_email is
  -- ignored): a client that could name its own address could claim another
  -- consumer's identity.
  select lower(u.email) into v_email from auth.users u where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null then
    raise exception 'a verified email sign-in is required before completing a profile' using errcode = 'BG100';
  end if;
  -- The phone is an optional contact number, still market-shaped.
  if p_phone is not null and not app.valid_phone(p_market, p_phone) then
    raise exception 'phone does not belong to market %', p_market using errcode = 'BG102';
  end if;

  -- A city must be live; a waitlist city routes to S-C-005 in the client.
  if p_city_id is not null and not exists (
      select 1 from public.city c
      where c.id = p_city_id and c.market = p_market and c.stage = 'live') then
    raise exception 'city is not open for reservations yet' using errcode = 'BG119';
  end if;

  insert into public.app_user (id, primary_market, locale, numerals)
  values (v_uid, p_market, coalesce(p_locale, v_cfg.default_locale), v_cfg.numerals_default)
  on conflict (id) do update
    set primary_market = excluded.primary_market, locale = excluded.locale, updated_at = now();

  insert into public.consumer_profile (user_id, first_name, last_name, email, email_verified, phone, market, city_id)
  values (v_uid, trim(p_first_name), p_last_name, v_email, true, p_phone, p_market, p_city_id)
  on conflict (user_id) do update
    set first_name = excluded.first_name, last_name = excluded.last_name,
        email = excluded.email, email_verified = true,
        phone = coalesce(excluded.phone, public.consumer_profile.phone),
        market = excluded.market, city_id = excluded.city_id
  returning * into v_row;
  return v_row;
end $$;
