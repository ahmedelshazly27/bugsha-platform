-- ============================================================================
-- Phase 4 — browse, detail, and the 10-minute reservation hold
-- docs/07-api.md §Consumer, docs/02-data-model.md §6
-- ============================================================================
set search_path = public, extensions;

/**
 * Order codes exclude visually ambiguous glyphs: no 0/O, 1/I/L, 5/S, 8/B.
 * Staff read these aloud across a counter (02-data-model.md §6).
 */
create or replace function app.generate_order_code()
returns text language plpgsql volatile set search_path = '' as $$
declare safe constant text := '234679ACDEFGHJKMNPQRTUVWXYZ'; v_code text;
begin
  loop
    v_code := '';
    for i in 1..5 loop
      v_code := v_code || substr(safe, 1 + floor(random() * length(safe))::int, 1);
    end loop;
    v_code := substr(v_code, 1, 3) || '-' || substr(v_code, 4, 2);
    exit when not exists (select 1 from public."order" o where o.code = v_code);
  end loop;
  return v_code;
end $$;

/**
 * Return stock to a listing, bounded by quantity_total so the `quantity_sane`
 * check can never be violated by a drifted row. Returns TRUE when the bound
 * actually bit, so the caller records the drift instead of absorbing it.
 */
create or replace function app.restore_stock(p_listing uuid, p_quantity integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_qr integer; v_qt integer;
begin
  select quantity_remaining, quantity_total into v_qr, v_qt
    from public.listing where listing_id = p_listing for update;
  if not found then return false; end if;

  update public.listing
     set quantity_remaining = least(v_qt, v_qr + p_quantity),
         status = case when status = 'sold_out' and least(v_qt, v_qr + p_quantity) > 0
                       then 'active'::public.listing_status else status end,
         updated_at = now()
   where listing_id = p_listing;
  return (v_qr + p_quantity) > v_qt;
end $$;

/**
 * Hold a bag. Decrements stock atomically, stamps commission from the contract
 * in force, and sets hold_expires_at. NO PAYMENT is taken here — the consumer
 * has market_config.hold_duration_minutes to decide.
 */
create or replace function app.hold_listing(
  p_listing_id uuid, p_quantity integer, p_idempotency text
) returns public."order"
language plpgsql security definer set search_path = '' as $$
declare
  v_l public.listing; v_store public.store; v_cfg public.market_config;
  v_profile public.consumer_profile; v_contract public.partner_contract;
  v_order public."order"; v_replay jsonb; v_cap integer; v_held integer;
  v_subtotal bigint; v_commission bigint; v_updated integer;
begin
  v_replay := app.idempotent_replay(p_idempotency, 'hold_listing',
    jsonb_build_object('l', p_listing_id, 'q', p_quantity));
  if v_replay is not null and not coalesce((v_replay->>'pending')::boolean, false) then
    select * into v_order from public."order" where order_id = (v_replay->>'order_id')::uuid;
    return v_order;
  end if;

  select * into v_profile from public.consumer_profile where user_id = auth.uid();
  if not found then raise exception 'complete your profile first' using errcode = 'BG100'; end if;
  if v_profile.restricted_until is not null and v_profile.restricted_until > now() then
    raise exception 'reservations are paused on this account until %', v_profile.restricted_until
      using errcode = 'BG112';
  end if;

  select * into v_l from public.listing where listing_id = p_listing_id;
  if not found then raise exception 'unknown listing' using errcode = 'BG110'; end if;
  select * into v_store from public.store where store_id = v_l.store_id;
  select * into v_cfg from public.market_config where market = v_l.market;

  if v_l.market <> v_profile.market then
    raise exception 'that bag is in another market' using errcode = 'BG110';
  end if;
  if v_l.status <> 'active' then
    raise exception 'someone got the last one' using errcode = 'BG110';
  end if;
  if now() >= v_l.reservation_cutoff_utc then
    raise exception 'reservations for this window have closed' using errcode = 'BG112';
  end if;
  if v_store.paused_until is not null and v_store.paused_until > now() then
    raise exception 'this branch is paused' using errcode = 'BG118';
  end if;

  -- Caps: a new user gets the lower one (00-product.md rule 6).
  v_cap := case
    when not exists (select 1 from public."order" o
                     where o.consumer_id = auth.uid() and o.status = 'redeemed')
      then v_cfg.reservation_cap_new_user
    else v_cfg.reservation_cap_default end;

  select coalesce(sum(o.quantity), 0) into v_held from public."order" o
  where o.consumer_id = auth.uid() and o.listing_id = p_listing_id
    and o.status in ('held', 'reserved');

  if v_held + p_quantity > v_cap then
    raise exception '% is the most per person here', v_cap using errcode = 'BG113';
  end if;

  -- Atomic decrement. Two devices racing for the last bag: exactly one UPDATE
  -- matches, the other gets BG110 (§payments P12).
  update public.listing
     set quantity_remaining = quantity_remaining - p_quantity,
         status = case when quantity_remaining - p_quantity = 0
                       then 'sold_out'::public.listing_status else status end,
         updated_at = now()
   where listing_id = p_listing_id and status = 'active'
     and quantity_remaining >= p_quantity;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'someone got the last one' using errcode = 'BG110';
  end if;

  v_contract := app.resolve_commission(v_l.partner_id, now());
  if v_contract.id is null then
    raise exception 'no contract in force for this partner' using errcode = 'BG102';
  end if;

  v_subtotal := v_l.price_minor * p_quantity;
  -- STAMPED here, from the contract in force at this instant. Never recomputed.
  v_commission := app.commission_of(v_subtotal, v_contract.commission_bp);

  insert into public."order" (
    code, consumer_id, listing_id, store_id, partner_id, market, quantity,
    unit_price_minor, subtotal_minor, total_minor, currency,
    commission_bp, commission_minor, contract_version_id,
    title_snapshot, description_snapshot, window_start_utc, window_end_utc,
    method, payment_status, status, hold_expires_at)
  values (
    app.generate_order_code(), auth.uid(), v_l.listing_id, v_l.store_id, v_l.partner_id,
    v_l.market, p_quantity, v_l.price_minor, v_subtotal, v_subtotal, v_l.currency,
    v_contract.commission_bp, v_commission, v_contract.id,
    v_l.title_snapshot, v_l.description_snapshot, v_l.window_start_utc, v_l.window_end_utc,
    'card', 'none', 'held', now() + make_interval(mins => v_cfg.hold_duration_minutes))
  returning * into v_order;

  perform app.idempotent_record(p_idempotency, jsonb_build_object('order_id', v_order.order_id));
  return v_order;
end $$;

create or replace function app.release_hold(p_order_id uuid)
returns public."order"
language plpgsql security definer set search_path = '' as $$
declare v_order public."order";
begin
  select * into v_order from public."order"
   where order_id = p_order_id and consumer_id = auth.uid() and status = 'held';
  if not found then raise exception 'no held order' using errcode = 'BG102'; end if;

  perform app.restore_stock(v_order.listing_id, v_order.quantity);
  update public."order" set status = 'cancelled_consumer', cancelled_at = now(),
         cancelled_reason_code = 'consumer_request', updated_at = now()
   where order_id = p_order_id returning * into v_order;
  return v_order;
end $$;

/**
 * The job from 08-jobs.md. Idempotent and safe to re-run. One bad row must
 * NEVER abort the run — found by the phase-4 suite, where a single drifted
 * listing raised 23514 and stopped every other hold from being released.
 */
create or replace function app.release_expired_holds()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer := 0; v_anomalies integer := 0; v_errors integer := 0; r record;
begin
  for r in
    select o.order_id, o.listing_id, o.quantity from public."order" o
    where o.status = 'held' and o.hold_expires_at is not null and o.hold_expires_at < now()
      -- Fawry holds expire on the PROVIDER's reference, not our ten minutes
      -- (§payments P8). Excluded deliberately.
      and o.method <> 'fawry'
    for update skip locked
  loop
    begin
      if app.restore_stock(r.listing_id, r.quantity) then
        v_anomalies := v_anomalies + 1;
      end if;
      update public."order"
         set status = 'cancelled_consumer', cancelled_at = now(),
             cancelled_reason_code = 'consumer_request', updated_at = now()
       where order_id = r.order_id;
      v_count := v_count + 1;
    exception when others then
      v_errors := v_errors + 1;   -- record and carry on; never stop the queue
    end;
  end loop;

  insert into public.job_run (job_name, finished_at, status, rows_affected, error)
  values ('release_expired_holds', now(),
          case when v_errors > 0 then 'partial' else 'ok' end, v_count,
          nullif(concat_ws('; ',
            nullif('rows that failed: ' || v_errors, 'rows that failed: 0'),
            nullif('stock restores bounded by quantity_total: ' || v_anomalies,
                   'stock restores bounded by quantity_total: 0')), ''));
  return v_count;
end $$;

create or replace function app.listing_detail(p_listing_id uuid)
returns table (
  listing_id uuid, title text, description text, category text,
  price_minor bigint, currency char(3), value_min_minor bigint, value_max_minor bigint,
  quantity_remaining integer, window_start_utc timestamptz, window_end_utc timestamptz,
  store_id uuid, store_name text, pickup_point_en text, pickup_point_ar text,
  timezone text, rating numeric, rating_count bigint, dietary_flags text[]
) language sql stable security definer set search_path = '' as $$
  select l.listing_id, l.title_snapshot, l.description_snapshot, l.category,
         l.price_minor, l.currency, l.value_min_minor, l.value_max_minor,
         l.quantity_remaining, l.window_start_utc, l.window_end_utc,
         s.store_id, s.display_name, s.pickup_point_en, s.pickup_point_ar, s.timezone,
         coalesce(avg(r.rating), 0)::numeric(3,2), count(r.id), l.dietary_flags
  from public.listing l
  join public.store s on s.store_id = l.store_id
  left join public.review r on r.store_id = s.store_id and r.published
  where l.listing_id = p_listing_id
  group by l.listing_id, l.title_snapshot, l.description_snapshot, l.category,
           l.price_minor, l.currency, l.value_min_minor, l.value_max_minor,
           l.quantity_remaining, l.window_start_utc, l.window_end_utc,
           s.store_id, s.display_name, s.pickup_point_en, s.pickup_point_ar, s.timezone,
           l.dietary_flags;
$$;

grant execute on function app.hold_listing, app.release_hold, app.listing_detail to authenticated;
grant execute on function app.listing_detail to anon;
