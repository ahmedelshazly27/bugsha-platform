-- Phase 4 (completion) — geo browse, Arabic-normalised search, detail reads,
-- impact, wallet and promotions (docs/07-api.md §Consumer).
set search_path = public, extensions;
create extension if not exists pg_trgm with schema extensions;

/**
 * Arabic normalisation for search: strips diacritics, unifies the hamza forms
 * (أ إ آ -> ا), ى -> ي and ة -> ه, so أحمد / احمد / أَحمد all match. IMMUTABLE
 * so it can back a generated column and a trigram index — normalising at
 * query time cannot use an index (07-api.md).
 */
create or replace function app.normalise_ar(p text)
returns text language sql immutable set search_path = '' as $$
  select lower(translate(regexp_replace(coalesce(p,''), '[ً-ْٰـ]', '', 'g'), 'أإآىة', 'اايه'));
$$;

alter table listing add column if not exists search_normalised text
  generated always as (app.normalise_ar(title_snapshot || ' ' || coalesce(description_snapshot,''))) stored;
alter table store add column if not exists search_normalised text
  generated always as (app.normalise_ar(display_name)) stored;
create index if not exists listing_search_trgm on listing using gin (search_normalised extensions.gin_trgm_ops);
create index if not exists store_search_trgm on store using gin (search_normalised extensions.gin_trgm_ops);

create or replace function app.search_listings(p_query text, p_market public.market, p_city uuid default null)
returns setof public.v_browse_listing language sql stable security definer set search_path = '' as $$
  select v.* from public.v_browse_listing v
  join public.store s on s.store_id = v.store_id
  join public.listing l on l.listing_id = v.listing_id
  where v.market = p_market and (p_city is null or v.city_id = p_city)
    and (l.search_normalised like '%' || app.normalise_ar(p_query) || '%'
         or s.search_normalised like '%' || app.normalise_ar(p_query) || '%'
         or extensions.similarity(s.search_normalised, app.normalise_ar(p_query)) > 0.3)
  order by extensions.similarity(s.search_normalised, app.normalise_ar(p_query)) desc, v.window_end_utc
  limit 50;
$$;

/** Geo browse. Distance in metres from the dropped pin. */
create or replace function app.browse_nearby(p_lat double precision, p_lng double precision,
  p_radius_m integer default 5000, p_filters jsonb default '{}')
returns table (listing_id uuid, title text, category text, price_minor bigint, currency char(3),
  value_min_minor bigint, value_max_minor bigint, quantity_remaining integer,
  window_start_utc timestamptz, window_end_utc timestamptz, store_id uuid, store_name text,
  distance_m double precision, rating numeric, rating_count bigint, dietary_flags text[])
language sql stable security definer set search_path = '' as $$
  select v.listing_id, v.title_snapshot, v.category, v.price_minor, v.currency,
         v.value_min_minor, v.value_max_minor, v.quantity_remaining, v.window_start_utc, v.window_end_utc,
         v.store_id, v.display_name,
         extensions.st_distance(v.location, extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography),
         v.rating, v.rating_count, v.dietary_flags
  from public.v_browse_listing v
  where extensions.st_dwithin(v.location, extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography, p_radius_m)
    and (p_filters->>'category' is null or v.category = p_filters->>'category')
    and (p_filters->>'max_price_minor' is null or v.price_minor <= (p_filters->>'max_price_minor')::bigint)
    and (p_filters->'dietary' is null or v.dietary_flags @> array(select jsonb_array_elements_text(p_filters->'dietary')))
  order by case coalesce(p_filters->>'sort','distance')
    when 'price' then v.price_minor::double precision
    when 'soonest' then extract(epoch from v.window_end_utc)
    when 'discount' then -(v.value_min_minor - v.price_minor)::double precision
    when 'rating' then -v.rating::double precision
    else extensions.st_distance(v.location, extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography) end
  limit 100;
$$;

create or replace function app.store_profile(p_store uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'store_id', s.store_id, 'display_name', s.display_name, 'category_tags', s.category_tags,
    'address', s.address, 'pickup_point_en', s.pickup_point_en, 'pickup_point_ar', s.pickup_point_ar,
    'timezone', s.timezone, 'reliability_score', s.reliability_score,
    'rating', (select coalesce(avg(rating),0)::numeric(3,2) from public.review where store_id = s.store_id and published),
    'rating_count', (select count(*) from public.review where store_id = s.store_id and published),
    'hours', (select coalesce(jsonb_agg(jsonb_build_object('weekday', weekday, 'opens', opens, 'closes', closes, 'is_ramadan', is_ramadan) order by weekday, shift_index), '[]')
              from public.store_hours where store_id = s.store_id),
    'live_listings', (select coalesce(jsonb_agg(jsonb_build_object('listing_id', listing_id, 'title', title_snapshot,
        'price_minor', price_minor, 'quantity_remaining', quantity_remaining, 'window_start_utc', window_start_utc,
        'window_end_utc', window_end_utc) order by window_start_utc), '[]')
      from public.v_browse_listing where store_id = s.store_id),
    'recent_reviews', (select coalesce(jsonb_agg(jsonb_build_object('rating', rating, 'tags', tags, 'body', body, 'at', created_at) order by created_at desc), '[]')
      from (select * from public.review where store_id = s.store_id and published order by created_at desc limit 10) r))
  from public.store s where s.store_id = p_store and s.permanently_closed_at is null;
$$;

/** Order + payment + redemption + refund timeline, for S-C-040..047. */
create or replace function app.order_detail(p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'order', to_jsonb(o) - 'consumer_id',
    'store', jsonb_build_object('store_id', s.store_id, 'display_name', s.display_name,
      'pickup_point_en', s.pickup_point_en, 'pickup_point_ar', s.pickup_point_ar, 'contact_phone', s.contact_phone,
      'timezone', s.timezone, 'address', s.address),
    'payment', (select to_jsonb(p) - 'raw' from public.payment p where p.order_id = o.order_id order by created_at desc limit 1),
    'redemption', (select to_jsonb(r) from public.redemption r where r.order_id = o.order_id and r.undone_at is null),
    'refunds', (select coalesce(jsonb_agg(to_jsonb(rf) order by rf.created_at), '[]') from public.refund rf where rf.order_id = o.order_id),
    'cancellation_cutoff_at', o.window_start_utc - make_interval(hours => mc.cancel_cutoff_hours),
    'refund_timing_key', o.market || '.' || case when o.method = 'wallet_credit' then 'wallet' else o.method::text end)
  from public."order" o
  join public.store s on s.store_id = o.store_id
  join public.market_config mc on mc.market = o.market
  where o.order_id = p_order and (o.consumer_id = auth.uid() or app.is_ops()
    or app.can_store(o.store_id, array['owner','manager','staff']::public.partner_role[]));
$$;

/** Money saved is the primary metric; sustainability is an after-effect (00-product.md). */
create or replace function app.my_impact()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'currency', (select mc.currency from public.market_config mc join public.consumer_profile c on c.market = mc.market where c.user_id = auth.uid()),
    'saved_minor', coalesce(sum(l.value_min_minor * o.quantity - o.total_minor) filter (where o.status = 'redeemed'), 0),
    'spent_minor', coalesce(sum(o.total_minor) filter (where o.status = 'redeemed'), 0),
    'bags', count(*) filter (where o.status = 'redeemed'),
    'stores', count(distinct o.store_id) filter (where o.status = 'redeemed'),
    'since', min(o.created_at) filter (where o.status = 'redeemed'),
    'estimated_kg', round(count(*) filter (where o.status = 'redeemed') * 0.9, 1))
  from public."order" o join public.listing l on l.listing_id = o.listing_id
  where o.consumer_id = auth.uid();
$$;

create or replace function app.wallet_balance()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'balance_minor', coalesce(sum(amount_minor), 0), 'currency', max(currency), 'market', max(market::text),
    'expiring_soon_minor', coalesce(sum(amount_minor) filter (where expires_on is not null and expires_on <= current_date + 30), 0))
  from public.wallet_transaction where consumer_id = auth.uid();
$$;

/** Resolves eligibility, caps and budget; stamps discount_funded_by from the promotion. */
create or replace function app.apply_promotion(p_order uuid, p_code text)
returns public."order" language plpgsql security definer set search_path = '' as $$
declare o public."order"; pr public.promotion; v_discount bigint; v_used integer; v_first boolean;
begin
  select * into o from public."order" where order_id = p_order and consumer_id = auth.uid() for update;
  if not found then raise exception 'unknown order' using errcode = 'BG102'; end if;
  if o.status <> 'held' then raise exception 'promotions apply before payment' using errcode = 'BG110'; end if;
  if o.promotion_id is not null then raise exception 'a promotion is already applied' using errcode = 'BG110'; end if;

  select * into pr from public.promotion where code = upper(p_code) and market = o.market
    and now() between valid_from and valid_to for update;
  if not found then raise exception 'that code is not valid here' using errcode = 'BG121'; end if;

  select count(*) into v_used from public."order" where consumer_id = auth.uid() and promotion_id = pr.id and status <> 'cancelled_consumer';
  if pr.cap_per_user is not null and v_used >= pr.cap_per_user then
    raise exception 'you have used this code % times already', pr.cap_per_user using errcode = 'BG121';
  end if;
  if pr.cap_total is not null and (select count(*) from public."order" where promotion_id = pr.id) >= pr.cap_total then
    raise exception 'this code has been fully used' using errcode = 'BG121';
  end if;
  v_first := not exists (select 1 from public."order" where consumer_id = auth.uid() and status in ('reserved','redeemed','no_show'));
  if coalesce((pr.eligibility->>'firstOrderOnly')::boolean, false) and not v_first then
    raise exception 'this code is for a first order' using errcode = 'BG121';
  end if;
  if pr.eligibility ? 'partnerIds' and not (pr.eligibility->'partnerIds') ? o.partner_id::text then
    raise exception 'this code does not apply to this store' using errcode = 'BG121';
  end if;

  v_discount := case pr.discount_type when 'fixed' then least(pr.discount_value, o.subtotal_minor)
                                       else app.round_half_up(o.subtotal_minor, pr.discount_value::numeric / 100) end;
  if pr.budget_spent_minor + v_discount > pr.budget_cap_minor then
    raise exception 'this code has reached its budget' using errcode = 'BG121';
  end if;

  update public.promotion set budget_spent_minor = budget_spent_minor + v_discount where id = pr.id;
  update public."order"
     set promotion_id = pr.id, discount_minor = v_discount, discount_funded_by = pr.funded_by,
         total_minor = subtotal_minor - v_discount,
         -- Commission base depends on WHO funds the discount (05-money.md §3.8).
         commission_minor = case when pr.funded_by = 'platform' then commission_minor
                                 else app.commission_of(subtotal_minor - v_discount, commission_bp) end,
         updated_at = now()
   where order_id = p_order returning * into o;
  return o;
end $$;

grant execute on function app.search_listings, app.browse_nearby, app.store_profile, app.normalise_ar to authenticated, anon;
grant execute on function app.order_detail, app.my_impact, app.wallet_balance, app.apply_promotion to authenticated;
