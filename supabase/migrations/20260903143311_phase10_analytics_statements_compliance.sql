-- Phase 10 — partner analytics, reliability, statements, compliance ledger,
-- reviews, refunds, cash reconciliation (docs/07-api.md §Partner/§Consumer).
set search_path = public, extensions;

-- Payout allocation link table: entries are immutable, so assignment lives beside them.
create table if not exists payout_allocation (
  payout_id uuid not null references payout(payout_id), entry_id uuid not null references financial_entry(id),
  primary key (entry_id)
);
alter table payout_allocation enable row level security; alter table payout_allocation force row level security;
drop policy if exists payout_alloc_read on payout_allocation;
create policy payout_alloc_read on payout_allocation for select using (app.is_ops(array['finance','admin']::public.ops_role[])
  or exists (select 1 from payout p where p.payout_id = payout_allocation.payout_id and app.can_partner(p.partner_id, array['owner','accountant']::public.partner_role[])));

create or replace function app.analytics_summary(p_partner uuid, p_from date, p_to date, p_store uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'currency', (select mc.currency from public.partner p join public.market_config mc on mc.market = p.market where p.partner_id = p_partner),
    'gross_minor', coalesce(sum(o.total_minor) filter (where o.status in ('reserved','redeemed','no_show')), 0),
    'commission_minor', coalesce(sum(o.commission_minor) filter (where o.status = 'redeemed'), 0),
    'no_show_retained_minor', coalesce(sum(o.total_minor) filter (where o.status = 'no_show' and o.method <> 'cash'), 0),
    'orders', count(*) filter (where o.status in ('reserved','redeemed','no_show')),
    'redeemed', count(*) filter (where o.status = 'redeemed'),
    'no_shows', count(*) filter (where o.status = 'no_show'),
    'cancelled_by_partner', count(*) filter (where o.status = 'cancelled_partner'),
    'listings', (select count(*) from public.listing l where l.partner_id = p_partner and (p_store is null or l.store_id = p_store) and l.local_date between p_from and p_to),
    'sell_through', (select round(coalesce(sum(quantity_total - quantity_remaining)::numeric / nullif(sum(quantity_total),0), 0), 3)
                     from public.listing l where l.partner_id = p_partner and (p_store is null or l.store_id = p_store) and l.local_date between p_from and p_to and l.status <> 'cancelled'),
    'avg_rating', (select round(coalesce(avg(r.rating),0),2) from public.review r join public.store s on s.store_id = r.store_id
                   where s.partner_id = p_partner and (p_store is null or r.store_id = p_store) and r.published and r.created_at::date between p_from and p_to),
    'by_store', (select coalesce(jsonb_agg(jsonb_build_object('store_id', s.store_id, 'display_name', s.display_name,
        'gross_minor', coalesce((select sum(total_minor) from public."order" x where x.store_id = s.store_id and x.status in ('reserved','redeemed','no_show') and x.created_at::date between p_from and p_to),0))), '[]')
      from public.store s where s.partner_id = p_partner and (p_store is null or s.store_id = p_store)))
  from public."order" o
  where o.partner_id = p_partner and (p_store is null or o.store_id = p_store) and o.created_at::date between p_from and p_to
    and app.can_partner(p_partner, array['owner','manager','accountant']::public.partner_role[]);
$$;

/** Each insight cites its evidence: numbers, not adjectives. */
create or replace function app.analytics_insights(p_partner uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb := '[]'; r record;
begin
  if not app.can_partner(p_partner, array['owner','manager','accountant']::public.partner_role[]) then
    raise exception 'not authorised' using errcode = 'BG100';
  end if;
  for r in select s.store_id, round(coalesce(sum(l.quantity_total - l.quantity_remaining)::numeric / nullif(sum(l.quantity_total),0),0),2) st, count(*) n
    from public.store s join public.listing l on l.store_id = s.store_id
    where s.partner_id = p_partner and l.local_date >= current_date - 28 and l.status <> 'cancelled' group by 1 loop
    if r.n >= 5 and r.st >= 0.95 then
      v := v || jsonb_build_object('kind','sold_out_often','store_id', r.store_id, 'message_key','insight.raise_quantity', 'evidence', jsonb_build_object('sell_through_28d', r.st, 'listings', r.n));
    elsif r.n >= 5 and r.st < 0.4 then
      v := v || jsonb_build_object('kind','low_sell_through','store_id', r.store_id, 'message_key','insight.lower_quantity_or_price', 'evidence', jsonb_build_object('sell_through_28d', r.st, 'listings', r.n));
    end if;
  end loop;
  for r in select o.store_id, count(*) filter (where status='no_show') ns, count(*) n from public."order" o
    where o.partner_id = p_partner and o.created_at >= now() - interval '28 days' and o.status in ('redeemed','no_show') group by 1 loop
    if r.n >= 10 and r.ns::numeric / r.n > 0.15 then
      v := v || jsonb_build_object('kind','high_no_show','store_id', r.store_id, 'message_key','insight.no_show_rate', 'evidence', jsonb_build_object('no_shows', r.ns, 'orders', r.n));
    end if;
  end loop;
  return v;
end $$;

/** Reliability with its component breakdown, surfaced honestly (rule 12). */
create or replace function app.reliability(p_partner uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'score', p.reliability_score, 'override', p.reliability_override, 'override_reason', p.reliability_override_reason,
    'components', jsonb_build_object(
      'partner_cancellations_90d', (select count(*) from public.listing where partner_id = p_partner and status='cancelled' and cancelled_at >= now() - interval '90 days'),
      'quality_flags_90d', (select count(*) from public.quality_flag where partner_id = p_partner and created_at >= now() - interval '90 days'),
      'late_redemptions_90d', (select count(*) from public.redemption r join public."order" o on o.order_id = r.order_id where o.partner_id = p_partner and r.late_grace and r.server_ts >= now() - interval '90 days'),
      'stores', (select jsonb_agg(jsonb_build_object('store_id', store_id, 'score', reliability_score)) from public.store where partner_id = p_partner)))
  from public.partner p where p.partner_id = p_partner
    and (app.can_partner(p_partner, array['owner','manager','accountant']::public.partner_role[]) or app.is_ops());
$$;

/** The regulator-facing register (ComplianceExportRow in 10-types.md). */
create or replace function app.compliance_ledger(p_store uuid, p_from date, p_to date)
returns table (order_code text, event_type text, category text, quantity integer, declared_value_minor bigint, currency char(3),
  listed_at timestamptz, window_start timestamptz, window_end timestamptz, redeemed_client_ts timestamptz,
  redeemed_server_ts timestamptz, offline_queued boolean, staff_name text, disposition public.disposition, recorded_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select o.code, c.event_type, c.category, c.quantity, c.declared_value_minor, c.currency, c.listed_at,
         c.window_start_utc, c.window_end_utc, c.redeemed_client_ts, c.redeemed_server_ts,
         c.redeemed_client_ts is not null, pu.full_name, c.disposition, c.recorded_at
  from public.compliance_entry c
  left join public."order" o on o.order_id = c.order_id
  left join public.partner_user pu on pu.user_id = c.staff_user_id
  where c.store_id = p_store and c.recorded_at::date between p_from and p_to
    and (app.can_store(p_store, array['owner','manager','accountant']::public.partner_role[])
         or app.is_ops(array['compliance','ops_manager','finance','admin']::public.ops_role[]))
  order by c.recorded_at;
$$;

create or replace function app.end_of_day(p_store uuid, p_date date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'date', p_date, 'orders', count(o.order_id), 'redeemed', count(*) filter (where o.status='redeemed'), 'no_shows', count(*) filter (where o.status='no_show'),
    'gross_minor', coalesce(sum(o.total_minor) filter (where o.status in ('redeemed','no_show')),0),
    'cash_expected_minor', coalesce(sum(o.total_minor) filter (where o.method='cash' and o.status='redeemed'),0),
    'cash_collected_minor', coalesce((select sum(cc.collected_minor) from public.cash_collection cc join public."order" x on x.order_id = cc.order_id
       where x.store_id = p_store and (x.window_start_utc at time zone s.timezone)::date = p_date),0),
    'cash_commission_owed_minor', coalesce((select sum(e.amount_minor) from public.financial_entry e join public."order" x on x.order_id = e.order_id
       where x.store_id = p_store and e.account='partner_receivable' and e.entry_type='debit' and (x.window_start_utc at time zone s.timezone)::date = p_date),0),
    'dispositions', (select coalesce(jsonb_object_agg(d.disposition, d.n), '{}') from (select nd.disposition, count(*) n from public.no_show_disposition nd join public."order" x on x.order_id = nd.order_id
       where x.store_id = p_store and (x.window_start_utc at time zone s.timezone)::date = p_date group by 1) d))
  from public.store s left join public."order" o on o.store_id = s.store_id and (o.window_start_utc at time zone s.timezone)::date = p_date
  where s.store_id = p_store and app.can_store(p_store, array['owner','manager','staff','accountant']::public.partner_role[])
  group by s.timezone;
$$;

/** Variance is a fraud and training signal, not a footnote. Note mandatory above threshold. */
create or replace function app.submit_cash_reconciliation(p_store uuid, p_date date, p_reported_minor bigint, p_note text default null)
returns public.cash_reconciliation language plpgsql security definer set search_path = '' as $$
declare v_expected bigint; v_threshold bigint; v_row public.cash_reconciliation; v_market public.market;
begin
  if not app.can_store(p_store, array['owner','manager']::public.partner_role[]) then raise exception 'not authorised' using errcode = 'BG100'; end if;
  select market into v_market from public.store where store_id = p_store;
  select coalesce(sum(cc.collected_minor),0) into v_expected from public.cash_collection cc join public."order" o on o.order_id = cc.order_id
   join public.store s on s.store_id = o.store_id where o.store_id = p_store and (o.window_start_utc at time zone s.timezone)::date = p_date;
  select cash_variance_threshold_minor into v_threshold from public.market_config where market = v_market;
  if v_threshold is not null and abs(p_reported_minor - v_expected) > v_threshold and coalesce(p_note,'') = '' then
    raise exception 'a note is required for a variance above %', v_threshold using errcode = 'BG102';
  end if;
  insert into public.cash_reconciliation (store_id, business_date, expected_minor, reported_minor, variance_minor, note, submitted_by)
  values (p_store, p_date, v_expected, p_reported_minor, p_reported_minor - v_expected, p_note, auth.uid())
  on conflict (store_id, business_date) do update set reported_minor = excluded.reported_minor, variance_minor = excluded.variance_minor,
    note = excluded.note, submitted_by = excluded.submitted_by, submitted_at = now()
  returning * into v_row;
  if v_threshold is not null and abs(v_row.variance_minor) > v_threshold then
    insert into public.reconciliation_exception (kind, exception_type, store_id, market, expected_minor, actual_minor, status)
    values ('cash', 'store_variance', p_store, v_market, v_expected, p_reported_minor, 'open');
  end if;
  return v_row;
end $$;

/** Egypt: cash collected, commission owed, and how it settles — shown at all times (05-money.md §3.3). */
create or replace function app.cash_liability(p_partner uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'receivable_minor', coalesce(sum(case when e.entry_type='debit' then e.amount_minor else -e.amount_minor end),0),
    'oldest_entry_at', min(e.effective_at) filter (where e.entry_type='debit'),
    'settlement_mode', (select cash_settlement_mode from app.resolve_commission(p_partner, now())),
    'currency', max(e.currency),
    'escalates_at_minor', (select mc.cash_liability_escalate_minor from public.partner p join public.market_config mc on mc.market = p.market where p.partner_id = p_partner))
  from public.financial_entry e
  where e.partner_id = p_partner and e.account = 'partner_receivable'
    and (app.can_partner(p_partner, array['owner','accountant']::public.partner_role[]) or app.is_ops());
$$;

create or replace function app.payouts(p_partner uuid)
returns setof public.payout language sql stable security definer set search_path = '' as $$
  select p.* from public.payout p where p.partner_id = p_partner
    and (app.can_partner(p_partner, array['owner','accountant']::public.partner_role[]) or app.is_ops(array['finance','admin']::public.ops_role[]))
  order by p.created_at desc;
$$;

/** Every line expands to its orders: a partner reaches any number in <= 2 taps. */
create or replace function app.payout_detail(p_payout uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'payout', to_jsonb(p),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('account', account, 'amount_minor', amt, 'orders', orders)), '[]') from (
        select e.account, sum(case when e.entry_type='credit' then e.amount_minor else -e.amount_minor end) amt,
               coalesce(jsonb_agg(distinct o.code) filter (where o.code is not null), '[]') orders
        from public.payout_allocation pa join public.financial_entry e on e.id = pa.entry_id
        left join public."order" o on o.order_id = e.order_id
        where pa.payout_id = p.payout_id group by e.account) x),
    'statement', (select to_jsonb(s) from public.statement s where s.payout_id = p.payout_id))
  from public.payout p where p.payout_id = p_payout
    and (app.can_partner(p.partner_id, array['owner','accountant']::public.partner_role[]) or app.is_ops(array['finance','admin']::public.ops_role[]));
$$;

/** Only users who redeemed may rate (rule 9). One review per order. */
create or replace function app.submit_review(p_order uuid, p_rating smallint, p_tags text[] default '{}', p_body text default null, p_photo text default null)
returns public.review language plpgsql security definer set search_path = '' as $$
declare o public."order"; v public.review;
begin
  select * into o from public."order" where order_id = p_order and consumer_id = auth.uid();
  if not found then raise exception 'not your order' using errcode = 'BG100'; end if;
  if o.status <> 'redeemed' then raise exception 'only a collected order can be rated' using errcode = 'BG110'; end if;
  insert into public.review (order_id, consumer_id, store_id, rating, tags, body, photo_path)
  values (p_order, auth.uid(), o.store_id, p_rating, coalesce(p_tags,'{}'), p_body, p_photo)
  on conflict (order_id) do update set rating = excluded.rating, tags = excluded.tags, body = excluded.body
  returning * into v;
  return v;
end $$;

create or replace function app.respond_to_review(p_review uuid, p_body text)
returns public.review_response language plpgsql security definer set search_path = '' as $$
declare r public.review; v public.review_response;
begin
  select * into r from public.review where id = p_review;
  if not found or not app.can_store(r.store_id, array['owner','manager']::public.partner_role[]) then raise exception 'not authorised' using errcode = 'BG100'; end if;
  insert into public.review_response (review_id, body, moderation_status, responded_by) values (p_review, p_body, 'flagged', auth.uid())
  on conflict (review_id) do update set body = excluded.body, moderation_status = 'flagged' returning * into v;
  return v;
end $$;

/** Rule 8: refund timing is stated at the moment of refund — the key is returned with the row. */
create or replace function app.request_refund(p_order uuid, p_amount_minor bigint, p_destination text, p_reason_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public."order"; v_id uuid; v_payment uuid;
begin
  select * into o from public."order" where order_id = p_order and consumer_id = auth.uid() for update;
  if not found then raise exception 'not your order' using errcode = 'BG100'; end if;
  if o.payment_status <> 'captured' or o.status not in ('reserved','redeemed') then raise exception 'nothing to refund on this order' using errcode = 'BG110'; end if;
  if p_amount_minor <= 0 or p_amount_minor > o.total_minor then raise exception 'amount out of range' using errcode = 'BG102'; end if;
  select payment_id into v_payment from public.payment where order_id = p_order limit 1;
  insert into public.refund (order_id, payment_id, amount_minor, destination, reason_code, cost_bearer, status, requested_by)
  values (p_order, v_payment, p_amount_minor, p_destination, p_reason_code, 'platform', 'requested', auth.uid()) returning refund_id into v_id;
  return jsonb_build_object('refund_id', v_id, 'status', 'requested',
    'refund_timing_key', o.market || '.' || case when p_destination = 'wallet' then 'wallet' else o.method::text end);
end $$;

/** Starts the statutory clock; blocked by pending orders. The clock length is decision 11 and raises until set. */
create or replace function app.request_deletion()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public."order" where consumer_id = auth.uid() and status in ('held','reserved')) then
    raise exception 'collect or cancel your open orders first' using errcode = 'BG110';
  end if;
  update public.consumer_profile set deletion_requested_at = now() where user_id = auth.uid();
  raise exception 'deletion recorded; the statutory retention clock is undecided (decision 11)' using errcode = 'BG150';
end $$;

grant execute on function app.analytics_summary, app.analytics_insights, app.reliability, app.compliance_ledger, app.end_of_day,
  app.submit_cash_reconciliation, app.cash_liability, app.payouts, app.payout_detail, app.submit_review, app.respond_to_review,
  app.request_refund, app.request_deletion to authenticated;
