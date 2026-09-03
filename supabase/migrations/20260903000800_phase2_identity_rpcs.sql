-- ============================================================================
-- Phase 2 — auth, profile, market and city selection (docs/07-api.md §Consumer)
-- ============================================================================
set search_path = public, extensions;

/** Market-shaped phone validation, mirroring zPhone in packages/core. */
create or replace function app.valid_phone(p_market public.market, p_phone text)
returns boolean language sql immutable set search_path = '' as $$
  select case p_market
    when 'KW' then p_phone ~ '^\+965\d{8}$'
    when 'EG' then p_phone ~ '^\+20\d{10}$'
  end;
$$;

/**
 * Creates the consumer profile. RLS gives consumers no INSERT on
 * consumer_profile precisely so this function owns creation.
 * Only the first name is required (07-api.md).
 */
create or replace function app.complete_profile(
  p_first_name text, p_market public.market, p_city_id uuid default null,
  p_last_name text default null, p_email text default null,
  p_locale public.locale_code default null
) returns public.consumer_profile
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_phone text; v_cfg public.market_config; v_row public.consumer_profile;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = 'BG100'; end if;
  if coalesce(trim(p_first_name), '') = '' then
    raise exception 'first name is required' using errcode = 'BG102';
  end if;

  select * into v_cfg from public.market_config where market = p_market;
  if not found then raise exception 'unknown market %', p_market using errcode = 'BG102'; end if;

  -- The phone comes from the verified JWT, never from the caller: a client
  -- that could name its own number could claim another consumer's identity.
  select u.phone into v_phone from auth.users u where u.id = v_uid;
  if v_phone is not null and left(v_phone, 1) <> '+' then v_phone := '+' || v_phone; end if;
  if v_phone is null then
    raise exception 'phone sign-in is required before completing a profile' using errcode = 'BG100';
  end if;
  if not app.valid_phone(p_market, v_phone) then
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

  insert into public.consumer_profile (user_id, first_name, last_name, email, phone, market, city_id)
  values (v_uid, trim(p_first_name), p_last_name, p_email, v_phone, p_market, p_city_id)
  on conflict (user_id) do update
    set first_name = excluded.first_name, last_name = excluded.last_name,
        email = excluded.email, city_id = excluded.city_id
  returning * into v_row;
  return v_row;
end $$;

create or replace function app.set_locale(
  p_locale public.locale_code, p_numerals public.numeral_system
) returns public.app_user
language plpgsql security definer set search_path = '' as $$
declare v_row public.app_user;
begin
  update public.app_user set locale = p_locale, numerals = p_numerals, updated_at = now()
   where id = auth.uid() returning * into v_row;
  if not found then raise exception 'no profile' using errcode = 'BG100'; end if;
  return v_row;
end $$;

/**
 * Switching market is deliberately explicit: payment methods and the wallet
 * are per market, so the client must pass p_confirm having SHOWN that. A
 * wallet balance in KWD does not follow a consumer to Egypt.
 */
create or replace function app.set_market(
  p_market public.market, p_city_id uuid, p_confirm boolean default false
) returns public.consumer_profile
language plpgsql security definer set search_path = '' as $$
declare v_row public.consumer_profile; v_current public.market; v_wallet bigint;
begin
  select market into v_current from public.consumer_profile where user_id = auth.uid();
  if v_current is null then raise exception 'no profile' using errcode = 'BG100'; end if;

  if v_current <> p_market and not p_confirm then
    select coalesce(sum(amount_minor), 0) into v_wallet
      from public.wallet_transaction where consumer_id = auth.uid();
    raise exception 'switching market changes payment methods and leaves a wallet balance of % behind', v_wallet
      using errcode = 'BG103';
  end if;

  if not exists (select 1 from public.city c
                 where c.id = p_city_id and c.market = p_market and c.stage = 'live') then
    raise exception 'city is not open for reservations yet' using errcode = 'BG119';
  end if;

  update public.consumer_profile set market = p_market, city_id = p_city_id
   where user_id = auth.uid() returning * into v_row;
  update public.app_user set primary_market = p_market, updated_at = now() where id = auth.uid();
  return v_row;
end $$;

/** allergen_ack is mandatory when an allergy flag is selected (07-api.md). */
create or replace function app.set_dietary(
  p_flags text[], p_allergen_ack boolean default false
) returns public.consumer_profile
language plpgsql security definer set search_path = '' as $$
declare v_row public.consumer_profile; v_has_allergy boolean;
begin
  v_has_allergy := exists (
    select 1 from unnest(coalesce(p_flags, '{}')) f
    where f like 'allergy_%' or f in ('nuts','gluten','dairy','shellfish','egg','soy','sesame'));

  if v_has_allergy and not p_allergen_ack then
    -- The platform never guarantees contents. An allergy selection without
    -- acknowledgement would imply a promise it cannot keep (rule 10).
    raise exception 'allergen acknowledgement is required when an allergy is selected'
      using errcode = 'BG104';
  end if;

  update public.consumer_profile
     set dietary_flags = coalesce(p_flags, '{}'),
         allergen_ack_at = case when p_allergen_ack then now() else allergen_ack_at end
   where user_id = auth.uid() returning * into v_row;
  if not found then raise exception 'no profile' using errcode = 'BG100'; end if;
  return v_row;
end $$;

/** Cities a consumer may choose, with waitlist ones flagged rather than hidden. */
create or replace function app.cities_for(p_market public.market)
returns table (id uuid, name_en text, name_ar text, governorate text, stage public.city_stage)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name_en, c.name_ar, c.governorate, c.stage
  from public.city c where c.market = p_market
  order by (c.stage = 'live') desc, c.name_en;
$$;

grant execute on function app.complete_profile, app.set_locale, app.set_market,
  app.set_dietary, app.cities_for, app.valid_phone to authenticated;
grant execute on function app.cities_for, app.valid_phone to anon;
