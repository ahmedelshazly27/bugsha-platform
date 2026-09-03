-- Phase 3 (completion) — partner onboarding, store setup, schedules, cancellation,
-- staff, and the partner read surface (docs/07-api.md §Partner, 02-data-model.md §3-5).
set search_path = public, extensions;

-- ─── Onboarding ─────────────────────────────────────────────────────────────
create or replace function app.transition_partner(
  p_partner uuid, p_to public.onboarding_status, p_reason_code text default null, p_reason_text text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_from public.onboarding_status;
begin
  select onboarding_status into v_from from public.partner where partner_id = p_partner for update;
  update public.partner set onboarding_status = p_to, updated_at = now(),
         activated_at = case when p_to = 'active' then coalesce(activated_at, now()) else activated_at end
   where partner_id = p_partner;
  insert into public.partner_status_history (partner_id, from_status, to_status, actor, reason_code, reason_text)
  values (p_partner, v_from, p_to, auth.uid(), p_reason_code, p_reason_text);
end $$;

/** Public. A lead applies; the applicant becomes the owner. */
create or replace function app.submit_application(
  p_market public.market, p_legal_name text, p_trading_name text, p_categories text[],
  p_contact_name text, p_contact_phone text, p_contact_email text,
  p_city_id uuid, p_branch_count integer default 1,
  p_referral_source text default null, p_est_daily_surplus_minor bigint default null
) returns public.partner language plpgsql security definer set search_path = '' as $$
declare v_row public.partner; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'sign in to apply' using errcode = 'BG100'; end if;
  if not app.valid_phone(p_market, p_contact_phone) then
    raise exception 'contact phone does not belong to market %', p_market using errcode = 'BG102';
  end if;
  if 'alcohol' = any(coalesce(p_categories, '{}')) then
    raise exception 'alcohol is never listed' using errcode = 'BG105';
  end if;
  insert into public.partner (market, legal_name, trading_name, categories, onboarding_status,
    branch_count, contact_name, contact_role, contact_phone, contact_email, city_id,
    referral_source, est_daily_surplus_minor)
  values (p_market, p_legal_name, p_trading_name, coalesce(p_categories,'{}'), 'applied',
    p_branch_count, p_contact_name, 'owner', p_contact_phone, p_contact_email, p_city_id,
    p_referral_source, p_est_daily_surplus_minor)
  returning * into v_row;

  insert into public.partner_user (user_id, full_name, phone)
  values (v_uid, p_contact_name, p_contact_phone) on conflict (user_id) do nothing;
  insert into public.staff_assignment (user_id, partner_id, store_id, role, partner_wide, claimed_at)
  values (v_uid, v_row.partner_id, null, 'owner', true, now());
  insert into public.partner_status_history (partner_id, from_status, to_status, actor)
  values (v_row.partner_id, 'lead', 'applied', v_uid);
  return v_row;
end $$;

create or replace function app.upload_document(
  p_partner uuid, p_doc_type text, p_storage_path text,
  p_store_id uuid default null, p_expires_on date default null, p_extracted jsonb default null
) returns public.partner_document language plpgsql security definer set search_path = '' as $$
declare v_row public.partner_document; v_market public.market;
begin
  if not app.can_partner(p_partner, array['owner']::public.partner_role[]) then
    raise exception 'only an owner uploads documents' using errcode = 'BG100';
  end if;
  select market into v_market from public.partner where partner_id = p_partner;
  if not exists (select 1 from public.market_document_requirement where market = v_market and doc_type = p_doc_type) then
    raise exception 'document type % is not required in %', p_doc_type, v_market using errcode = 'BG102';
  end if;
  insert into public.partner_document (partner_id, store_id, market, doc_type, storage_path, extracted, expires_on, status)
  values (p_partner, p_store_id, v_market, p_doc_type, p_storage_path, p_extracted, p_expires_on, 'pending')
  returning * into v_row;
  if (select onboarding_status from public.partner where partner_id = p_partner) in ('applied','documents_pending') then
    perform app.transition_partner(p_partner, 'under_review');
  end if;
  return v_row;
end $$;

/** Records timestamp, IP, device and document hash. Contracts are immutable thereafter. */
create or replace function app.accept_contract(p_contract uuid, p_ip inet, p_ua text, p_document_hash text)
returns public.partner_contract language plpgsql security definer set search_path = '' as $$
declare v_row public.partner_contract;
begin
  select * into v_row from public.partner_contract where id = p_contract;
  if not found then raise exception 'unknown contract' using errcode = 'BG102'; end if;
  if not app.can_partner(v_row.partner_id, array['owner']::public.partner_role[]) then
    raise exception 'only an owner accepts a contract' using errcode = 'BG100';
  end if;
  if v_row.accepted_at is not null then return v_row; end if;
  update public.partner_contract
     set accepted_at = now(), accepted_by = auth.uid(), accepted_ip = p_ip, accepted_ua = p_ua,
         document_hash = p_document_hash
   where id = p_contract returning * into v_row;
  perform app.transition_partner(v_row.partner_id, 'contract_signed');
  perform app.audit('accept_contract', 'partner_contract', p_contract, null, to_jsonb(v_row));
  return v_row;
end $$;

-- ─── Store ──────────────────────────────────────────────────────────────────
/** The dragged pin is authoritative; the pickup point is required in both languages. */
create or replace function app.upsert_store(
  p_partner uuid, p_display_name text, p_city_id uuid, p_address jsonb,
  p_lat double precision, p_lng double precision,
  p_pickup_point_en text, p_pickup_point_ar text, p_contact_phone text,
  p_category_tags text[] default '{}', p_store_id uuid default null,
  p_geocoded_lat double precision default null, p_geocoded_lng double precision default null
) returns public.store language plpgsql security definer set search_path = '' as $$
declare v_row public.store; v_p public.partner; v_tz text; v_required text[];
begin
  select * into v_p from public.partner where partner_id = p_partner;
  if not found then raise exception 'unknown partner' using errcode = 'BG102'; end if;
  if p_store_id is null then
    if not app.can_partner(p_partner, array['owner']::public.partner_role[]) then
      raise exception 'only an owner adds a branch' using errcode = 'BG100';
    end if;
  elsif not app.can_store(p_store_id, array['owner','manager']::public.partner_role[]) then
    raise exception 'not authorised' using errcode = 'BG100';
  end if;
  if coalesce(p_pickup_point_en,'') = '' or coalesce(p_pickup_point_ar,'') = '' then
    raise exception 'pickup point is required in both languages' using errcode = 'BG102';
  end if;
  -- Address shape is market-specific (02-data-model.md §4).
  v_required := case v_p.market when 'KW' then array['governorate','area','block','street','building']
                                else array['governorate','district','street','building'] end;
  if not (p_address ?& v_required) then
    raise exception 'address for % needs %', v_p.market, array_to_string(v_required, ', ') using errcode = 'BG102';
  end if;
  if not exists (select 1 from public.city where id = p_city_id and market = v_p.market) then
    raise exception 'city is not in market %', v_p.market using errcode = 'BG102';
  end if;
  v_tz := (select timezone from public.market_config where market = v_p.market);

  insert into public.store (store_id, partner_id, market, city_id, display_name, category_tags, address,
    location, geocoded_location, pickup_point_en, pickup_point_ar, contact_phone, timezone)
  values (coalesce(p_store_id, extensions.uuid_generate_v4()), p_partner, v_p.market, p_city_id,
    p_display_name, coalesce(p_category_tags,'{}'), p_address,
    extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
    case when p_geocoded_lat is null then null
         else extensions.st_setsrid(extensions.st_makepoint(p_geocoded_lng, p_geocoded_lat), 4326)::extensions.geography end,
    p_pickup_point_en, p_pickup_point_ar, p_contact_phone, v_tz)
  on conflict (store_id) do update set
    display_name = excluded.display_name, city_id = excluded.city_id, category_tags = excluded.category_tags,
    address = excluded.address, location = excluded.location, geocoded_location = excluded.geocoded_location,
    pickup_point_en = excluded.pickup_point_en, pickup_point_ar = excluded.pickup_point_ar,
    contact_phone = excluded.contact_phone, updated_at = now()
  returning * into v_row;

  if v_p.onboarding_status = 'contract_signed' then perform app.transition_partner(p_partner, 'store_setup'); end if;
  return v_row;
end $$;

/** Replaces a store's hours for one schedule (regular or Ramadan). Split shifts supported. */
create or replace function app.set_hours(p_store uuid, p_rows jsonb, p_is_ramadan boolean default false)
returns setof public.store_hours language plpgsql security definer set search_path = '' as $$
begin
  if not app.can_store(p_store, array['owner','manager']::public.partner_role[]) then
    raise exception 'not authorised' using errcode = 'BG100';
  end if;
  delete from public.store_hours where store_id = p_store and is_ramadan = p_is_ramadan;
  insert into public.store_hours (store_id, weekday, opens, closes, shift_index, is_ramadan)
  select p_store, (r->>'weekday')::smallint, (r->>'opens')::time, (r->>'closes')::time,
         coalesce((r->>'shift_index')::smallint, 0), p_is_ramadan
  from jsonb_array_elements(p_rows) r;
  return query select * from public.store_hours where store_id = p_store and is_ramadan = p_is_ramadan
               order by weekday, shift_index;
end $$;

/** Blocks new listings and reservations. DOES NOT cancel existing orders — and says so. */
create or replace function app.pause_store(p_store uuid, p_reason_code text, p_until timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_open integer;
begin
  if not app.can_store(p_store, array['owner','manager']::public.partner_role[]) then
    raise exception 'not authorised' using errcode = 'BG100';
  end if;
  update public.store set paused_until = p_until, pause_reason_code = p_reason_code, updated_at = now()
   where store_id = p_store;
  select count(*) into v_open from public."order" where store_id = p_store and status in ('held','reserved');
  perform app.audit('pause_store', 'store', p_store, null, jsonb_build_object('until', p_until), p_reason_code);
  return jsonb_build_object('paused_until', p_until, 'existing_orders_unaffected', v_open,
    'message_key', 'store.paused_existing_orders_honoured');
end $$;

/** Reservation pause while the partner device is offline (14-mobile.md §3). Resumes on reconnect. */
create or replace function app.pause_store_reservations(p_store uuid, p_reason text)
returns void language sql security definer set search_path = '' as $$
  update public.store set paused_until = now() + interval '1 hour', pause_reason_code = 'store_paused'
   where store_id = p_store and app.can_store(p_store, array['owner','manager','staff']::public.partner_role[]);
$$;
create or replace function app.resume_store_reservations(p_store uuid)
returns void language sql security definer set search_path = '' as $$
  update public.store set paused_until = null, pause_reason_code = null
   where store_id = p_store and pause_reason_code = 'store_paused'
     and app.can_store(p_store, array['owner','manager','staff']::public.partner_role[]);
$$;

-- ─── Schedules ──────────────────────────────────────────────────────────────
create or replace function app.upsert_schedule(
  p_store uuid, p_template uuid, p_weekdays smallint[], p_local_start time, p_local_end time,
  p_quantity integer, p_publish_lead_minutes integer default 150,
  p_ramadan_affected boolean default false, p_schedule_id uuid default null
) returns public.listing_schedule language plpgsql security definer set search_path = '' as $$
declare v_row public.listing_schedule;
begin
  if not app.can_store(p_store, array['owner','manager']::public.partner_role[]) then
    raise exception 'not authorised' using errcode = 'BG100';
  end if;
  if not exists (select 1 from public.bag_template where id = p_template and store_id = p_store and archived_at is null) then
    raise exception 'template does not belong to this store' using errcode = 'BG102';
  end if;
  insert into public.listing_schedule (id, store_id, template_id, weekdays, local_start, local_end, quantity,
    publish_lead_minutes, ramadan_affected)
  values (coalesce(p_schedule_id, extensions.uuid_generate_v4()), p_store, p_template, p_weekdays,
    p_local_start, p_local_end, p_quantity, p_publish_lead_minutes, p_ramadan_affected)
  on conflict (id) do update set weekdays = excluded.weekdays, local_start = excluded.local_start,
    local_end = excluded.local_end, quantity = excluded.quantity,
    publish_lead_minutes = excluded.publish_lead_minutes, ramadan_affected = excluded.ramadan_affected,
    paused_at = null
  returning * into v_row;
  return v_row;
end $$;

/** A pause stops future materialisation; already-materialised listings survive. */
create or replace function app.pause_schedule(p_schedule uuid)
returns public.listing_schedule language plpgsql security definer set search_path = '' as $$
declare v_row public.listing_schedule;
begin
  update public.listing_schedule set paused_at = now(), active = false
   where id = p_schedule and app.can_store(store_id, array['owner','manager']::public.partner_role[])
  returning * into v_row;
  if not found then raise exception 'not authorised or unknown schedule' using errcode = 'BG100'; end if;
  return v_row;
end $$;

-- ─── Cancellation ───────────────────────────────────────────────────────────
/**
 * Refunds every affected order, notifies consumers, counts against reliability.
 * quality_concern additionally raises a quality_flag: the low-friction path
 * that exists so a partner unsure about food pulls it rather than sells it.
 */
create or replace function app.cancel_listing(p_listing uuid, p_reason_code text, p_reason_text text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.listing; o record; v_refund uuid; v_payment uuid; v_affected integer := 0; v_refunded bigint := 0;
begin
  select * into l from public.listing where listing_id = p_listing for update;
  if not found then raise exception 'unknown listing' using errcode = 'BG102'; end if;
  if not app.can_store(l.store_id, array['owner','manager']::public.partner_role[]) then
    raise exception 'not authorised' using errcode = 'BG100';
  end if;
  if p_reason_code = 'other' and coalesce(p_reason_text,'') = '' then
    raise exception 'a reason is required when the code is other' using errcode = 'BG102';
  end if;
  if l.status = 'cancelled' then
    return jsonb_build_object('already_cancelled', true, 'affected_orders', 0);
  end if;

  for o in select * from public."order" where listing_id = p_listing and status in ('held','reserved') for update loop
    v_affected := v_affected + 1;
    if o.payment_status = 'captured' then
      select payment_id into v_payment from public.payment where order_id = o.order_id limit 1;
      insert into public.refund (order_id, payment_id, amount_minor, destination, reason_code, cost_bearer, status, requested_by)
      values (o.order_id, v_payment, o.total_minor, 'source', 'partner_cancelled', 'partner', 'approved', auth.uid())
      returning refund_id into v_refund;
      perform app.post_refund(v_refund, true);
      v_refunded := v_refunded + o.total_minor;
    end if;
    update public."order" set status = 'cancelled_partner', cancelled_at = now(), cancelled_reason_code = p_reason_code,
           payment_status = case when o.payment_status = 'captured' then 'refunded'::public.payment_status else o.payment_status end,
           updated_at = now()
     where order_id = o.order_id;
  end loop;

  update public.listing set status = 'cancelled', cancelled_reason_code = p_reason_code,
         cancelled_reason_text = p_reason_text, cancelled_at = now(), updated_at = now()
   where listing_id = p_listing;

  if p_reason_code = 'quality_concern' then
    insert into public.quality_flag (store_id, partner_id, source, category, body, severity)
    values (l.store_id, l.partner_id, 'partner', 'listing_cancelled_quality', p_reason_text, 'high');
  end if;

  -- Counts against reliability, once per cancellation (rule 4).
  update public.partner set reliability_score = greatest(0, reliability_score - 2) where partner_id = l.partner_id;
  update public.store set reliability_score = greatest(0, reliability_score - 2) where store_id = l.store_id;

  insert into public.compliance_entry (store_id, partner_id, event_type, listing_id, category, quantity, reason_code, detail)
  values (l.store_id, l.partner_id, 'listing_cancelled', p_listing, l.category, l.quantity_total, p_reason_code,
          jsonb_build_object('affected_orders', v_affected, 'refunded_minor', v_refunded));

  return jsonb_build_object('affected_orders', v_affected, 'refunded_minor', v_refunded,
    'quality_flag_raised', p_reason_code = 'quality_concern');
end $$;

/** Owner only. Skips publishing-blocked stores and says why. */
create or replace function app.publish_listing_bulk(
  p_template uuid, p_store_ids uuid[], p_quantity integer,
  p_local_date date, p_local_start time, p_local_end time, p_idempotency text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_t public.bag_template; s public.store; v_ok jsonb := '[]'; v_skipped jsonb := '[]';
        v_tpl uuid; v_l public.listing;
begin
  select * into v_t from public.bag_template where id = p_template;
  if not found then raise exception 'unknown template' using errcode = 'BG102'; end if;
  if not app.can_partner(v_t.partner_id, array['owner']::public.partner_role[]) then
    raise exception 'only an owner publishes in bulk' using errcode = 'BG100';
  end if;
  for s in select * from public.store where store_id = any(p_store_ids) and partner_id = v_t.partner_id loop
    if s.publishing_blocked_at is not null then
      v_skipped := v_skipped || jsonb_build_object('store_id', s.store_id, 'reason', 'BG117',
        'detail', coalesce(s.publishing_blocked_reason, 'document expired'));
      continue;
    end if;
    -- A shared template is cloned per store so each listing snapshots its own store.
    select id into v_tpl from public.bag_template where partner_id = v_t.partner_id and store_id = s.store_id
      and title_en = v_t.title_en and archived_at is null limit 1;
    if v_tpl is null then
      insert into public.bag_template (partner_id, store_id, title_en, title_ar, description_en, description_ar, category,
        value_min_minor, value_max_minor, price_minor, default_quantity, default_window_start, default_window_end, dietary_flags)
      select v_t.partner_id, s.store_id, v_t.title_en, v_t.title_ar, v_t.description_en, v_t.description_ar, v_t.category,
        v_t.value_min_minor, v_t.value_max_minor, v_t.price_minor, v_t.default_quantity, v_t.default_window_start,
        v_t.default_window_end, v_t.dietary_flags returning id into v_tpl;
    end if;
    v_l := app.publish_listing(v_tpl, p_quantity, p_local_date, p_local_start, p_local_end,
             p_idempotency || ':' || s.store_id::text);
    v_ok := v_ok || jsonb_build_object('store_id', s.store_id, 'listing_id', v_l.listing_id);
  end loop;
  return jsonb_build_object('published', v_ok, 'skipped', v_skipped);
end $$;

-- ─── Staff ──────────────────────────────────────────────────────────────────
/** Immediate. Queued offline redemptions remain valid and attributed (§13-15). */
create or replace function app.revoke_staff(p_assignment uuid)
returns public.staff_assignment language plpgsql security definer set search_path = '' as $$
declare a public.staff_assignment; v_caller public.partner_role;
begin
  select * into a from public.staff_assignment where id = p_assignment;
  if not found then raise exception 'unknown assignment' using errcode = 'BG102'; end if;
  select role into v_caller from public.staff_assignment where user_id = auth.uid() and partner_id = a.partner_id
    and revoked_at is null and (partner_wide or store_id = a.store_id)
  order by case role when 'owner' then 1 when 'manager' then 2 else 3 end limit 1;
  if v_caller is null or v_caller not in ('owner','manager') then
    raise exception 'not authorised' using errcode = 'BG100';
  end if;
  if v_caller = 'manager' and a.role <> 'staff' then
    raise exception 'a manager may only revoke staff' using errcode = 'BG100';
  end if;
  update public.staff_assignment set revoked_at = now() where id = p_assignment returning * into a;
  perform app.audit('revoke_staff', 'staff_assignment', p_assignment, null, to_jsonb(a));
  return a;
end $$;

/** Who is on the till, for attribution without re-auth. */
create or replace function app.set_active_shift(p_store uuid, p_staff_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.can_store(p_store, array['owner','manager','staff']::public.partner_role[]) then
    raise exception 'not authorised' using errcode = 'BG100';
  end if;
  if not exists (select 1 from public.staff_assignment where user_id = p_staff_user and revoked_at is null
                   and (store_id = p_store or (partner_wide and partner_id = (select partner_id from public.store where store_id = p_store)))) then
    raise exception 'that person is not assigned here' using errcode = 'BG102';
  end if;
  insert into public.audit_log (actor_user, actor_role, operation, target_type, target_id, after)
  values (auth.uid(), 'partner', 'set_active_shift', 'store', p_store, jsonb_build_object('staff_user', p_staff_user));
end $$;

-- ─── Partner reads ──────────────────────────────────────────────────────────
create or replace function app.today(p_store uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb; s public.store;
begin
  if not app.can_store(p_store, array['owner','manager','staff','accountant']::public.partner_role[]) then
    raise exception 'not authorised' using errcode = 'BG100';
  end if;
  select * into s from public.store where store_id = p_store;
  select jsonb_build_object(
    'store', jsonb_build_object('store_id', s.store_id, 'display_name', s.display_name,
      'publishing_blocked', s.publishing_blocked_at is not null, 'paused_until', s.paused_until),
    'next_window', (select jsonb_build_object('listing_id', listing_id, 'window_start_utc', window_start_utc,
        'window_end_utc', window_end_utc, 'quantity_remaining', quantity_remaining, 'quantity_total', quantity_total)
      from public.listing where store_id = p_store and status in ('active','sold_out') and window_end_utc > now()
      order by window_start_utc limit 1),
    'listings_today', (select coalesce(jsonb_agg(jsonb_build_object('listing_id', listing_id, 'title', title_snapshot,
        'status', status, 'quantity_remaining', quantity_remaining, 'quantity_total', quantity_total,
        'window_start_utc', window_start_utc, 'window_end_utc', window_end_utc) order by window_start_utc), '[]')
      from public.listing where store_id = p_store and local_date = (now() at time zone s.timezone)::date),
    'gross_today_minor', (select coalesce(sum(total_minor),0) from public."order"
      where store_id = p_store and status in ('reserved','redeemed') and (created_at at time zone s.timezone)::date = (now() at time zone s.timezone)::date),
    'orders_outstanding', (select count(*) from public."order" where store_id = p_store and status = 'reserved' and window_end_utc > now() - interval '30 minutes'),
    'alerts', (select coalesce(jsonb_agg(jsonb_build_object('kind', 'document_expiring', 'doc_type', doc_type, 'expires_on', expires_on)), '[]')
      from public.partner_document where (store_id = p_store or (store_id is null and partner_id = s.partner_id))
        and status = 'approved' and expires_on <= current_date + 30)
  ) into v;
  return v;
end $$;

/** Current + next window's orders. Also the Realtime subscription target. */
create or replace function app.orders_board(p_store uuid)
returns table (order_id uuid, code text, customer_first_name text, quantity integer, method public.payment_method,
  amount_due_minor bigint, currency char(3), status public.order_status, window_start_utc timestamptz,
  window_end_utc timestamptz, redeemed_at timestamptz, redeemed_by text)
language sql stable security definer set search_path = '' as $$
  select o.order_id, o.code, c.first_name, o.quantity, o.method,
         case when o.method = 'cash' then o.total_minor else 0 end, o.currency, o.status,
         o.window_start_utc, o.window_end_utc, r.server_ts, pu.full_name
  from public."order" o
  join public.consumer_profile c on c.user_id = o.consumer_id
  left join public.redemption r on r.order_id = o.order_id and r.undone_at is null
  left join public.partner_user pu on pu.user_id = r.staff_user_id
  where o.store_id = p_store
    and app.can_store(p_store, array['owner','manager','staff']::public.partner_role[])
    and o.status in ('reserved','redeemed','no_show')
    and o.window_end_utc > now() - interval '2 hours'
    and o.window_start_utc < now() + interval '26 hours'
  order by o.window_start_utc, o.code;
$$;

/** Fuzzy lookup on a partial code or a first name; staff read codes aloud. */
create or replace function app.lookup_order(p_store uuid, p_fragment text)
returns table (order_id uuid, code text, customer_first_name text, quantity integer, method public.payment_method,
  status public.order_status, window_end_utc timestamptz)
language sql stable security definer set search_path = '' as $$
  select o.order_id, o.code, c.first_name, o.quantity, o.method, o.status, o.window_end_utc
  from public."order" o join public.consumer_profile c on c.user_id = o.consumer_id
  where o.store_id = p_store
    and app.can_store(p_store, array['owner','manager','staff']::public.partner_role[])
    and o.status in ('reserved','redeemed')
    and o.window_end_utc > now() - interval '2 hours'
    and (replace(upper(o.code), '-', '') like '%' || replace(upper(p_fragment), '-', '') || '%'
         or c.first_name ilike p_fragment || '%')
  order by o.window_start_utc limit 20;
$$;

create or replace function app.listings(p_store uuid, p_status public.listing_status default null,
  p_from date default null, p_to date default null)
returns setof public.listing language sql stable security definer set search_path = '' as $$
  select * from public.listing
  where store_id = p_store and app.can_store(p_store, array['owner','manager','staff','accountant']::public.partner_role[])
    and (p_status is null or status = p_status)
    and (p_from is null or local_date >= p_from) and (p_to is null or local_date <= p_to)
  order by local_date desc, window_start_utc desc;
$$;

create or replace function app.templates(p_partner uuid)
returns setof public.bag_template language sql stable security definer set search_path = '' as $$
  select * from public.bag_template
  where partner_id = p_partner and archived_at is null
    and app.can_partner(p_partner, array['owner','manager','staff']::public.partner_role[])
  order by title_en;
$$;

create or replace function app.schedules(p_store uuid)
returns setof public.listing_schedule language sql stable security definer set search_path = '' as $$
  select * from public.listing_schedule
  where store_id = p_store and app.can_store(p_store, array['owner','manager']::public.partner_role[])
  order by local_start;
$$;

grant execute on function app.submit_application, app.upload_document, app.accept_contract, app.upsert_store,
  app.set_hours, app.pause_store, app.pause_store_reservations, app.resume_store_reservations,
  app.upsert_schedule, app.pause_schedule, app.cancel_listing, app.publish_listing_bulk,
  app.revoke_staff, app.set_active_shift, app.today, app.orders_board, app.lookup_order,
  app.listings, app.templates, app.schedules to authenticated;
