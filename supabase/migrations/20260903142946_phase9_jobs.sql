-- Phase 9 — scheduled jobs (docs/08-jobs.md). Each is idempotent and safe to
-- re-run, records a job_run row, and never lets one bad row stop the queue.
set search_path = public, extensions;

create table if not exists partner_health_task (
  id uuid primary key default uuid_generate_v4(),
  partner_id uuid not null references partner(partner_id),
  kind text not null, severity integer not null default 1,
  evidence jsonb not null, opened_at timestamptz not null default now(),
  opened_on date not null default current_date,
  resolved_at timestamptz, resolved_by uuid,
  unique (partner_id, kind, opened_on)
);
alter table partner_health_task enable row level security; alter table partner_health_task force row level security;
drop policy if exists ops_health on partner_health_task;
create policy ops_health on partner_health_task for all using (app.is_ops()) with check (app.is_ops());

create or replace function app.job_finish(p_name text, p_rows integer, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.job_run (job_name, finished_at, status, rows_affected, error, runbook_key)
  values (p_name, now(), case when p_error is null then 'ok' else 'partial' end, p_rows, p_error, 'runbook.' || p_name);
$$;

/** Fires at window_end + grace, NOT at window_end. Zero ledger entries. */
create or replace function app.mark_no_shows()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; v_count integer := 0; v_err integer := 0;
begin
  for r in
    select o.order_id, o.consumer_id, o.store_id, o.partner_id, o.listing_id, o.quantity, o.total_minor, o.currency, o.window_start_utc, o.window_end_utc
    from public."order" o join public.market_config mc on mc.market = o.market
    where o.status = 'reserved' and o.window_end_utc + make_interval(mins => mc.late_redeem_grace_minutes) < now()
    for update of o skip locked
  loop
    begin
      update public."order" set status = 'no_show', updated_at = now() where order_id = r.order_id;
      insert into public.no_show_disposition (order_id, disposition) values (r.order_id, 'kept') on conflict do nothing;
      update public.consumer_profile set no_show_count_90d = no_show_count_90d + 1 where user_id = r.consumer_id;
      insert into public.compliance_entry (store_id, partner_id, event_type, listing_id, order_id, quantity, declared_value_minor, currency, window_start_utc, window_end_utc, disposition)
      values (r.store_id, r.partner_id, 'no_show', r.listing_id, r.order_id, r.quantity, r.total_minor, r.currency, r.window_start_utc, r.window_end_utc, 'kept');
      v_count := v_count + 1;
    exception when others then v_err := v_err + 1; end;
  end loop;
  update public.consumer_profile set restricted_until = now() + interval '14 days', restriction_reason_code = 'repeat_no_show'
   where no_show_count_90d >= 3 and (restricted_until is null or restricted_until < now());
  perform app.job_finish('mark_no_shows', v_count, nullif('rows that failed: ' || v_err, 'rows that failed: 0'));
  return v_count;
end $$;

/** 14-day rolling horizon. Idempotent per (schedule_id, local_date). Skips holidays, closures, Ramadan, blocked stores. */
create or replace function app.materialise_schedules()
returns integer language plpgsql security definer set search_path = '' as $$
declare s record; d date; v_count integer := 0; v_err integer := 0; w record; t public.bag_template; st public.store;
begin
  for s in select sc.*, stt.timezone, stt.market from public.listing_schedule sc join public.store stt on stt.store_id = sc.store_id
           where sc.active and sc.paused_at is null loop
    select * into st from public.store where store_id = s.store_id;
    select * into t from public.bag_template where id = s.template_id;
    if st.publishing_blocked_at is not null or t.archived_at is not null then continue; end if;
    for d in select (now() at time zone s.timezone)::date + g from generate_series(0, 13) g loop
      begin
        if not (extract(dow from d)::smallint = any(s.weekdays)) then continue; end if;
        if exists (select 1 from public.listing where schedule_id = s.id and local_date = d) then continue; end if;
        if exists (select 1 from public.market_holiday where market = s.market and holiday_date = d and suppress_materialisation) then continue; end if;
        if exists (select 1 from public.store_closure where store_id = s.store_id and closure_date = d) then continue; end if;
        if s.ramadan_affected and s.ramadan_suspended_from is not null and d between s.ramadan_suspended_from and coalesce(s.ramadan_suspended_to, d) then continue; end if;
        select * into w from app.resolve_local_window(s.timezone, d, s.local_start, s.local_end);
        insert into public.listing (store_id, partner_id, market, city_id, template_id, schedule_id, title_snapshot, description_snapshot,
          allergen_snapshot, category, price_minor, currency, value_min_minor, value_max_minor, quantity_total, quantity_remaining,
          local_date, local_start, local_end, window_start_utc, window_end_utc, reservation_cutoff_utc, status, dietary_flags)
        values (st.store_id, st.partner_id, st.market, st.city_id, t.id, s.id, t.title_en, t.description_en, t.allergen_notes_en, t.category,
          t.price_minor, (select currency from public.market_config where market = st.market), t.value_min_minor, t.value_max_minor,
          s.quantity, s.quantity, d, s.local_start, s.local_end, w.start_utc, w.end_utc, w.end_utc, 'active', t.dietary_flags);
        v_count := v_count + 1;
      exception when others then v_err := v_err + 1; end;
    end loop;
  end loop;
  perform app.job_finish('materialise_schedules', v_count, nullif('rows that failed: ' || v_err, 'rows that failed: 0'));
  return v_count;
end $$;

/** Flags non-existent/ambiguous local times with a concrete replacement; never shifts silently (§13-7). No-op for Kuwait. */
create or replace function app.dst_integrity_check()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l record; v_problems jsonb := '[]'; v_checked integer := 0; v_round timestamptz; v_ambiguous boolean;
begin
  for l in select li.listing_id, li.store_id, li.local_date, li.local_start, s.timezone
           from public.listing li join public.store s on s.store_id = li.store_id
           join public.market_config mc on mc.market = li.market
           where mc.observes_dst and li.status = 'active' and li.local_date >= current_date loop
    v_checked := v_checked + 1;
    v_round := (l.local_date + l.local_start) at time zone l.timezone;
    if (v_round at time zone l.timezone)::time <> l.local_start then
      v_problems := v_problems || jsonb_build_object('listing_id', l.listing_id, 'store_id', l.store_id, 'problem', 'non_existent',
        'local_date', l.local_date, 'local_start', l.local_start, 'suggested_start', l.local_start + interval '1 hour');
      continue;
    end if;
    v_ambiguous := ((v_round - interval '1 hour') at time zone l.timezone)::time = l.local_start
                   and ((v_round - interval '1 hour') at time zone l.timezone)::date = l.local_date;
    if v_ambiguous then
      v_problems := v_problems || jsonb_build_object('listing_id', l.listing_id, 'store_id', l.store_id, 'problem', 'ambiguous',
        'local_date', l.local_date, 'local_start', l.local_start, 'suggested_start', l.local_start + interval '1 hour');
    end if;
  end loop;
  perform app.job_finish('dst_integrity_check', v_checked, case when jsonb_array_length(v_problems) > 0 then jsonb_array_length(v_problems) || ' listings need a replacement window' end);
  return jsonb_build_object('checked', v_checked, 'problems', v_problems);
end $$;

/** Flags at 30 days; on food-licence expiry blocks publishing. Cancels NOTHING. */
create or replace function app.check_document_expiry()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_expired integer; v_blocked integer; v_expiring integer;
begin
  update public.partner_document set status = 'expired' where status = 'approved' and expires_on < current_date;
  get diagnostics v_expired = row_count;
  update public.store s set publishing_blocked_at = now(), publishing_blocked_reason = 'Food permit expired on ' || d.expires_on
  from public.partner_document d join public.market_document_requirement r on r.market = d.market and r.doc_type = d.doc_type
  where d.status = 'expired' and r.blocks_publishing_on_expiry and d.store_id = s.store_id and s.publishing_blocked_at is null;
  get diagnostics v_blocked = row_count;
  update public.store s set publishing_blocked_at = null, publishing_blocked_reason = null
  where s.publishing_blocked_at is not null and exists (
    select 1 from public.partner_document d join public.market_document_requirement r on r.market = d.market and r.doc_type = d.doc_type
    where d.store_id = s.store_id and r.blocks_publishing_on_expiry and d.status = 'approved' and d.expires_on >= current_date);
  select count(*) into v_expiring from public.partner_document where status = 'approved' and expires_on between current_date and current_date + 30;
  perform app.job_finish('check_document_expiry', v_expired + v_blocked);
  return jsonb_build_object('expired', v_expired, 'publishing_blocked', v_blocked, 'expiring_within_30_days', v_expiring);
end $$;

/** The single most important alarm in the system. Raises on imbalance. */
create or replace function app.balance_verification()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_bad jsonb; v_drift bigint;
begin
  select coalesce(jsonb_agg(jsonb_build_object('transaction_id', transaction_id, 'currency', currency, 'delta', delta)), '[]') into v_bad
  from (select transaction_id, currency, sum(case when entry_type='debit' then amount_minor else -amount_minor end) delta
        from public.financial_entry group by transaction_id, currency
        having sum(case when entry_type='debit' then amount_minor else -amount_minor end) <> 0) x;
  select coalesce(sum(case when entry_type='debit' then amount_minor else -amount_minor end), 0) into v_drift from public.financial_entry;
  perform app.job_finish('balance_verification', (select count(*) from public.financial_entry)::int,
    case when jsonb_array_length(v_bad) > 0 or v_drift <> 0 then 'LEDGER IMBALANCE — page on-call' end);
  if jsonb_array_length(v_bad) > 0 or v_drift <> 0 then
    raise exception 'ledger imbalance: drift % across % transactions', v_drift, jsonb_array_length(v_bad) using errcode = 'BG002';
  end if;
  return jsonb_build_object('balanced', true, 'drift', v_drift,
    'captured_without_entries', (select count(*) from public."order" o where o.payment_status = 'captured'
       and not exists (select 1 from public.financial_entry e where e.order_id = o.order_id and e.reference_type = 'order')));
end $$;

/** A 50% two-week decline in listings produces a task sorted first. */
create or replace function app.partner_health_flags()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer := 0; r record;
begin
  for r in
    select p.partner_id,
      count(*) filter (where l.local_date >= current_date - 14) as recent,
      count(*) filter (where l.local_date >= current_date - 28 and l.local_date < current_date - 14) as prior
    from public.partner p join public.listing l on l.partner_id = p.partner_id
    where p.onboarding_status = 'active' and l.local_date >= current_date - 28
    group by p.partner_id
  loop
    if r.prior >= 4 and r.recent <= r.prior / 2 then
      insert into public.partner_health_task (partner_id, kind, severity, evidence)
      values (r.partner_id, 'listing_decline', 3, jsonb_build_object('recent_14d', r.recent, 'prior_14d', r.prior))
      on conflict do nothing;
      v_count := v_count + 1;
    end if;
  end loop;
  perform app.job_finish('partner_health_flags', v_count);
  return v_count;
end $$;

/** PSP settlement reconciliation. Whole input validated first: a malformed file writes zero entries and names the bad rows. */
create or replace function app.reconcile_payments(p_provider text, p_market public.market, p_settlement_date date, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_bad jsonb; r jsonb; p public.payment; v_matched integer := 0; v_exceptions integer := 0; v_gross bigint := 0; v_fee bigint := 0; v_batch uuid;
begin
  select coalesce(jsonb_agg(jsonb_build_object('index', i - 1, 'reason',
    case when x->>'provider_ref' is null then 'missing provider_ref'
         when coalesce(x->>'gross_minor','') !~ '^\d+$' then 'gross_minor is not an integer'
         when coalesce(x->>'fee_minor','') !~ '^\d+$' then 'fee_minor is not an integer'
         when x->>'settled_at' is null then 'missing settled_at' end)), '[]') into v_bad
  from jsonb_array_elements(p_rows) with ordinality as t(x, i)
  where x->>'provider_ref' is null or coalesce(x->>'gross_minor','') !~ '^\d+$' or coalesce(x->>'fee_minor','') !~ '^\d+$' or x->>'settled_at' is null;
  if jsonb_array_length(v_bad) > 0 then
    perform app.job_finish('reconcile_payments', 0, jsonb_array_length(v_bad) || ' malformed rows; nothing written');
    return jsonb_build_object('written', 0, 'bad_rows', v_bad);
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_gross := v_gross + (r->>'gross_minor')::bigint; v_fee := v_fee + (r->>'fee_minor')::bigint;
    select * into p from public.payment where provider = p_provider and provider_ref = r->>'provider_ref';
    if not found then
      insert into public.reconciliation_exception (kind, exception_type, provider_ref, market, actual_minor, status)
      values ('psp', 'settled_not_recorded', r->>'provider_ref', p_market, (r->>'gross_minor')::bigint, 'open');
      v_exceptions := v_exceptions + 1;
    elsif p.amount_minor <> (r->>'gross_minor')::bigint then
      insert into public.reconciliation_exception (kind, exception_type, provider_ref, payment_id, market, expected_minor, actual_minor, currency, status)
      values ('psp', 'amount_mismatch', r->>'provider_ref', p.payment_id, p_market, p.amount_minor, (r->>'gross_minor')::bigint, p.currency, 'open');
      v_exceptions := v_exceptions + 1;
    elsif p.settled_at is not null then
      insert into public.reconciliation_exception (kind, exception_type, provider_ref, payment_id, market, expected_minor, actual_minor, currency, status)
      values ('psp', 'duplicate_capture', r->>'provider_ref', p.payment_id, p_market, p.amount_minor, (r->>'gross_minor')::bigint, p.currency, 'open');
      v_exceptions := v_exceptions + 1;
    else
      update public.payment set settled_at = (r->>'settled_at')::timestamptz, psp_fee_minor = (r->>'fee_minor')::bigint, status = 'settled' where payment_id = p.payment_id;
      perform app.post_settlement(p.payment_id, (r->>'settled_at')::timestamptz);
      v_matched := v_matched + 1;
    end if;
  end loop;
  insert into public.reconciliation_exception (kind, exception_type, provider_ref, payment_id, market, expected_minor, currency, status)
  select 'psp', 'captured_not_settled', p2.provider_ref, p2.payment_id, p_market, p2.amount_minor, p2.currency, 'open'
  from public.payment p2 where p2.provider = p_provider and p2.status = 'captured' and p2.settled_at is null
    and p2.captured_at < p_settlement_date - interval '3 days'
    and not exists (select 1 from public.reconciliation_exception e where e.payment_id = p2.payment_id and e.status = 'open');
  insert into public.settlement_batch (provider, market, settlement_date, gross_minor, fee_minor, net_minor, matched_count, exception_count)
  values (p_provider, p_market, p_settlement_date, v_gross, v_fee, v_gross - v_fee, v_matched, v_exceptions)
  on conflict (provider, settlement_date) do update set matched_count = excluded.matched_count, exception_count = excluded.exception_count
  returning id into v_batch;
  perform app.job_finish('reconcile_payments', v_matched, nullif(v_exceptions || ' exceptions', '0 exceptions'));
  return jsonb_build_object('batch_id', v_batch, 'matched', v_matched, 'exceptions', v_exceptions, 'bad_rows', '[]'::jsonb);
end $$;

create or replace function app.ops_jobs()
returns table (job_name text, last_run timestamptz, status text, rows_affected integer, error text, runbook_key text, alerting boolean)
language sql stable security definer set search_path = '' as $$
  select distinct on (job_name) job_name, finished_at, status, rows_affected, error, runbook_key, status <> 'ok' or error is not null
  from public.job_run where app.is_ops(array['engineering','ops_manager','finance','admin']::public.ops_role[])
  order by job_name, started_at desc;
$$;

create or replace function app.ops_trigger_job(p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  if not app.is_ops(array['engineering','admin']::public.ops_role[]) then raise exception 'ops only' using errcode = 'BG100'; end if;
  case p_name
    when 'release_expired_holds' then v := to_jsonb(app.release_expired_holds());
    when 'mark_no_shows' then v := to_jsonb(app.mark_no_shows());
    when 'materialise_schedules' then v := to_jsonb(app.materialise_schedules());
    when 'dst_integrity_check' then v := app.dst_integrity_check();
    when 'check_document_expiry' then v := app.check_document_expiry();
    when 'balance_verification' then v := app.balance_verification();
    when 'partner_health_flags' then v := to_jsonb(app.partner_health_flags());
    else raise exception 'unknown job %', p_name using errcode = 'BG102';
  end case;
  perform app.audit('ops_trigger_job', 'job', null, null, jsonb_build_object('job', p_name, 'result', v));
  return v;
end $$;

do $$ declare j text; begin
  for j in select jobname from cron.job where jobname like 'bugsha_%' loop perform cron.unschedule(j); end loop;
  perform cron.schedule('bugsha_release_expired_holds', '* * * * *', $c$select app.release_expired_holds()$c$);
  perform cron.schedule('bugsha_mark_no_shows', '*/5 * * * *', $c$select app.mark_no_shows()$c$);
  perform cron.schedule('bugsha_materialise_schedules', '0 2 * * *', $c$select app.materialise_schedules()$c$);
  perform cron.schedule('bugsha_check_document_expiry', '15 2 * * *', $c$select app.check_document_expiry()$c$);
  perform cron.schedule('bugsha_balance_verification', '0 3 * * *', $c$select app.balance_verification()$c$);
  perform cron.schedule('bugsha_partner_health_flags', '30 3 * * *', $c$select app.partner_health_flags()$c$);
  perform cron.schedule('bugsha_dst_integrity_check', '0 4 * * *', $c$select app.dst_integrity_check()$c$);
end $$;

grant execute on function app.ops_jobs, app.ops_trigger_job to authenticated;
