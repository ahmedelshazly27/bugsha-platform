-- ============================================================================
-- Phase 3 — templates, listings and the 15-second publish path
-- docs/07-api.md §Partner, docs/02-data-model.md §5
-- ============================================================================
set search_path = public, extensions;

/**
 * Local intent -> UTC instants, in the STORE's timezone. Mirrors resolveWindow
 * in packages/core/src/time.ts, including the overnight roll and the refusal to
 * silently move a window across a DST gap (§13-7).
 */
create or replace function app.resolve_local_window(
  p_timezone text, p_local_date date, p_start time, p_end time,
  out start_utc timestamptz, out end_utc timestamptz
) language plpgsql immutable set search_path = '' as $$
declare v_end_date date := p_local_date;
begin
  start_utc := (p_local_date + p_start) at time zone p_timezone;
  if p_end <= p_start then v_end_date := p_local_date + 1; end if;
  end_utc := (v_end_date + p_end) at time zone p_timezone;

  -- `at time zone` silently shifts a local time that DST skipped. Compare the
  -- round trip and refuse rather than publish a window nobody authored.
  if (start_utc at time zone p_timezone)::time <> p_start then
    raise exception 'local time % does not exist on % in %', p_start, p_local_date, p_timezone
      using errcode = 'BG160';
  end if;
  if (end_utc at time zone p_timezone)::time <> p_end then
    raise exception 'local time % does not exist on % in %', p_end, v_end_date, p_timezone
      using errcode = 'BG160';
  end if;
  if end_utc <= start_utc then
    raise exception 'window must be positive' using errcode = 'BG161';
  end if;
  -- A genuine overnight window is real; 22:00->21:00 is a typo that would
  -- otherwise become a 23-hour window. Mirrors MAX_WINDOW_HOURS in core (D12).
  if end_utc - start_utc > interval '12 hours' then
    raise exception 'a window longer than 12 hours is not a pickup window' using errcode = 'BG161';
  end if;
end $$;

create or replace function app.upsert_bag_template(
  p_store_id uuid, p_title_en text, p_title_ar text,
  p_category text, p_value_min_minor bigint, p_value_max_minor bigint, p_price_minor bigint,
  p_default_quantity integer, p_window_start time, p_window_end time,
  p_description_en text default null, p_description_ar text default null,
  p_dietary_flags text[] default '{}', p_template_id uuid default null
) returns public.bag_template
language plpgsql security definer set search_path = '' as $$
declare v_store public.store; v_cfg public.market_config; v_row public.bag_template;
begin
  select * into v_store from public.store where store_id = p_store_id;
  if not found then raise exception 'unknown store' using errcode = 'BG102'; end if;
  if not app.can_store(p_store_id, array['owner','manager']::public.partner_role[]) then
    raise exception 'not authorised to manage templates here' using errcode = 'BG100';
  end if;
  select * into v_cfg from public.market_config where market = v_store.market;

  if p_category = 'alcohol' then
    raise exception 'alcohol is never listed' using errcode = 'BG105';
  end if;
  if p_value_max_minor < p_value_min_minor then
    raise exception 'value range is inverted' using errcode = 'BG106';
  end if;
  if p_price_minor < v_cfg.price_min_minor or p_price_minor > v_cfg.price_max_minor then
    raise exception 'price must be between % and %', v_cfg.price_min_minor, v_cfg.price_max_minor
      using errcode = 'BG107';
  end if;
  -- Integer comparison: a float ratio lets a price one minor unit over slip by.
  if p_price_minor * 100 > p_value_min_minor * (v_cfg.max_price_fraction * 100)::bigint then
    raise exception 'price may not exceed % percent of the stated minimum value',
      (v_cfg.max_price_fraction * 100)::int using errcode = 'BG108';
  end if;
  if coalesce(p_description_en, '') = '' and coalesce(p_description_ar, '') = '' then
    raise exception 'a description is required in at least one language' using errcode = 'BG109';
  end if;

  insert into public.bag_template (
    id, partner_id, store_id, title_en, title_ar, description_en, description_ar,
    category, value_min_minor, value_max_minor, price_minor, default_quantity,
    default_window_start, default_window_end, dietary_flags)
  values (coalesce(p_template_id, extensions.uuid_generate_v4()), v_store.partner_id, p_store_id,
    p_title_en, p_title_ar, p_description_en, p_description_ar, p_category,
    p_value_min_minor, p_value_max_minor, p_price_minor, p_default_quantity,
    p_window_start, p_window_end, coalesce(p_dietary_flags, '{}'))
  on conflict (id) do update set
    title_en = excluded.title_en, title_ar = excluded.title_ar,
    description_en = excluded.description_en, description_ar = excluded.description_ar,
    category = excluded.category, value_min_minor = excluded.value_min_minor,
    value_max_minor = excluded.value_max_minor, price_minor = excluded.price_minor,
    default_quantity = excluded.default_quantity,
    default_window_start = excluded.default_window_start,
    default_window_end = excluded.default_window_end,
    dietary_flags = excluded.dietary_flags
  returning * into v_row;
  return v_row;
end $$;

/**
 * THE 15-second path. One call: template + quantity + window -> a live listing.
 * Snapshots the template text so a later edit never rewrites what a consumer
 * already bought against (02-data-model.md §5).
 */
create or replace function app.publish_listing(
  p_template_id uuid, p_quantity integer, p_local_date date,
  p_local_start time, p_local_end time, p_idempotency text
) returns public.listing
language plpgsql security definer set search_path = '' as $$
declare v_t public.bag_template; v_store public.store; v_row public.listing;
        v_replay jsonb; v_w record;
begin
  v_replay := app.idempotent_replay(p_idempotency, 'publish_listing',
    jsonb_build_object('t', p_template_id, 'q', p_quantity, 'd', p_local_date,
                       's', p_local_start, 'e', p_local_end));
  if v_replay is not null and not coalesce((v_replay->>'pending')::boolean, false) then
    select * into v_row from public.listing where listing_id = (v_replay->>'listing_id')::uuid;
    return v_row;
  end if;

  select * into v_t from public.bag_template where id = p_template_id and archived_at is null;
  if not found then raise exception 'unknown template' using errcode = 'BG102'; end if;
  select * into v_store from public.store where store_id = v_t.store_id;

  if not app.can_store(v_store.store_id, array['owner','manager','staff']::public.partner_role[]) then
    raise exception 'not authorised to publish here' using errcode = 'BG100';
  end if;

  -- A lapsed food licence blocks NEW listings. Existing orders are untouched,
  -- and the message says so (§13-8).
  if v_store.publishing_blocked_at is not null then
    raise exception 'new listings are paused for this branch: %',
      coalesce(v_store.publishing_blocked_reason, 'document expired') using errcode = 'BG117';
  end if;
  if v_store.paused_until is not null and v_store.paused_until > now() then
    raise exception 'this branch is paused until %', v_store.paused_until using errcode = 'BG118';
  end if;
  if p_quantity < 1 then raise exception 'quantity must be positive' using errcode = 'BG106'; end if;

  select * into v_w from app.resolve_local_window(v_store.timezone, p_local_date, p_local_start, p_local_end);

  insert into public.listing (
    store_id, partner_id, market, city_id, template_id,
    title_snapshot, description_snapshot, allergen_snapshot, category,
    price_minor, currency, value_min_minor, value_max_minor,
    quantity_total, quantity_remaining, local_date, local_start, local_end,
    window_start_utc, window_end_utc, reservation_cutoff_utc,
    status, dietary_flags, created_by)
  values (
    v_store.store_id, v_store.partner_id, v_store.market, v_store.city_id, v_t.id,
    v_t.title_en, v_t.description_en, v_t.allergen_notes_en, v_t.category,
    v_t.price_minor, (select currency from public.market_config where market = v_store.market),
    v_t.value_min_minor, v_t.value_max_minor, p_quantity, p_quantity,
    p_local_date, p_local_start, p_local_end,
    v_w.start_utc, v_w.end_utc, v_w.end_utc,
    'active', v_t.dietary_flags, auth.uid())
  returning * into v_row;

  insert into public.compliance_entry (store_id, partner_id, event_type, listing_id,
    category, quantity, declared_value_minor, currency, listed_at,
    window_start_utc, window_end_utc)
  values (v_store.store_id, v_store.partner_id, 'listing_published', v_row.listing_id,
    v_row.category, p_quantity, v_row.value_min_minor, v_row.currency, now(),
    v_row.window_start_utc, v_row.window_end_utc);

  perform app.idempotent_record(p_idempotency, jsonb_build_object('listing_id', v_row.listing_id));
  return v_row;
end $$;

/**
 * Quantity may rise freely, but never below what is already sold — and the
 * error NAMES the sold count rather than silently clamping (§13-4).
 * Price freezes after the first sale. Staff may change quantity only.
 */
create or replace function app.update_listing(
  p_listing_id uuid, p_quantity integer default null,
  p_price_minor bigint default null, p_local_end time default null
) returns public.listing
language plpgsql security definer set search_path = '' as $$
declare v_l public.listing; v_store public.store; v_sold integer; v_row public.listing;
        v_end_utc timestamptz; v_w record;
begin
  select * into v_l from public.listing where listing_id = p_listing_id;
  if not found then raise exception 'unknown listing' using errcode = 'BG102'; end if;
  select * into v_store from public.store where store_id = v_l.store_id;

  if not app.can_store(v_l.store_id, array['owner','manager','staff']::public.partner_role[]) then
    raise exception 'not authorised' using errcode = 'BG100';
  end if;
  if (p_price_minor is not null or p_local_end is not null)
     and not app.can_store(v_l.store_id, array['owner','manager']::public.partner_role[]) then
    raise exception 'staff may change quantity only' using errcode = 'BG100';
  end if;

  v_sold := v_l.quantity_total - v_l.quantity_remaining;
  v_end_utc := v_l.window_end_utc;

  if p_quantity is not null and p_quantity < v_sold then
    raise exception 'you cannot go below % — that many are already paid for', v_sold
      using errcode = 'BG114';
  end if;
  if p_price_minor is not null and v_sold > 0 then
    raise exception 'price is frozen after the first sale' using errcode = 'BG115';
  end if;

  if p_local_end is not null then
    select * into v_w from app.resolve_local_window(v_store.timezone, v_l.local_date, v_l.local_start, p_local_end);
    if v_w.end_utc < v_l.window_end_utc and v_sold > 0 then
      raise exception 'a window cannot be shortened once orders exist' using errcode = 'BG161';
    end if;
    v_end_utc := v_w.end_utc;
  end if;

  update public.listing set
    quantity_total = coalesce(p_quantity, quantity_total),
    quantity_remaining = case when p_quantity is null then quantity_remaining
                              else p_quantity - v_sold end,
    price_minor = coalesce(p_price_minor, price_minor),
    local_end = coalesce(p_local_end, local_end),
    window_end_utc = v_end_utc, reservation_cutoff_utc = v_end_utc,
    status = case when coalesce(p_quantity, quantity_total) - v_sold = 0
                  then 'sold_out'::public.listing_status else status end,
    updated_at = now()
  where listing_id = p_listing_id returning * into v_row;
  return v_row;
end $$;

create or replace function app.archive_template(p_template_id uuid)
returns public.bag_template
language plpgsql security definer set search_path = '' as $$
declare v_row public.bag_template;
begin
  update public.bag_template set archived_at = now()
   where id = p_template_id
     and app.can_partner(partner_id, array['owner','manager']::public.partner_role[])
  returning * into v_row;
  if not found then raise exception 'not authorised or unknown template' using errcode = 'BG100'; end if;
  return v_row;   -- archived, NEVER deleted: historical listings reference it
end $$;

grant execute on function app.upsert_bag_template, app.publish_listing, app.update_listing,
  app.archive_template, app.resolve_local_window to authenticated;
