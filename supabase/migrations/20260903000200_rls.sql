-- ============================================================================
-- 20260903000200_rls.sql
-- Derived from docs/04-rls.sql, forward-only.
-- Authorisation lives here. Deviations are marked DECISION Dn.
-- ============================================================================

-- ============================================================================
-- Bugsha — 04 RLS
-- Authorisation lives HERE. The client's navigation reflects permissions;
-- this file decides them. Never trust a client-side role check.
-- ============================================================================

-- ─── Helper functions (stable, used inside policies) ────────────────────────

create or replace function app.current_markets() returns market[]
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select o.market_scope from public.ops_user o where o.user_id = auth.uid() and o.disabled_at is null),
    (select array[u.primary_market] from public.app_user u where u.id = auth.uid()),
    '{}'::market[]);
$$;

create or replace function app.ops_role() returns ops_role
language sql stable security definer set search_path = '' as $$
  select role from public.ops_user where user_id = auth.uid() and disabled_at is null;
$$;

create or replace function app.is_ops(p_roles ops_role[] default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ops_user o
                 where o.user_id = auth.uid() and o.disabled_at is null
                   and (p_roles is null or o.role = any(p_roles)));
$$;

-- Stores the caller can act on, with the role they hold there.
create or replace function app.my_stores(p_roles partner_role[] default null)
returns table (store_id uuid, partner_id uuid, role partner_role)
language sql stable security definer set search_path = '' as $$
  select s.store_id, s.partner_id, a.role
  from public.staff_assignment a
  join public.store s
    on (a.store_id = s.store_id) or (a.partner_wide and s.partner_id = a.partner_id)
  where a.user_id = auth.uid() and a.revoked_at is null
    and (p_roles is null or a.role = any(p_roles));
$$;

create or replace function app.can_store(p_store uuid, p_roles partner_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.my_stores(p_roles) m where m.store_id = p_store);
$$;

create or replace function app.can_partner(p_partner uuid, p_roles partner_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff_assignment a
                 where a.user_id = auth.uid() and a.revoked_at is null
                   and a.partner_id = p_partner and a.role = any(p_roles));
$$;

-- ─── Enable RLS everywhere. Default deny. ───────────────────────────────────

do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename not like 'pg_%'
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- ============================================================================
-- CONSUMER
-- ============================================================================

create policy own_user on app_user for select using (id = auth.uid());
create policy own_user_update on app_user for update using (id = auth.uid()) with check (id = auth.uid());

create policy own_profile on consumer_profile for select
  using (user_id = auth.uid() or app.is_ops());
create policy own_profile_update on consumer_profile for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- No consumer-side insert: app.complete_profile() owns creation.

-- Browse is public within a live city. Anonymous browsing is permitted.
create policy browse_public on listing for select
  using (status = 'active' and window_end_utc > now());

create policy store_public on store for select
  using (permanently_closed_at is null
         or app.can_store(store_id, array['owner','manager','staff','accountant']::partner_role[])
         or app.is_ops());

create policy city_public on city for select using (true);
create policy market_config_public on market_config for select using (true);
create policy reason_code_public on reason_code for select using (active or app.is_ops());

-- Orders: the consumer sees their own; the store's staff see theirs.
create policy order_consumer on "order" for select using (consumer_id = auth.uid());
create policy order_store on "order" for select
  using (app.can_store(store_id, array['owner','manager','staff']::partner_role[]));
create policy order_ops on "order" for select
  using (app.is_ops() and market = any(app.current_markets()));
-- NO insert/update/delete policy on "order" for anyone. Every write goes through
-- app.hold_listing() / app.confirm_order() / app.redeem_order() / app.cancel_order().

create policy payment_consumer on payment for select
  using (exists (select 1 from "order" o where o.order_id = payment.order_id and o.consumer_id = auth.uid()));
create policy payment_ops on payment for select
  using (app.is_ops(array['support_agent','ops_manager','finance','compliance','engineering','admin']::ops_role[]));

create policy refund_consumer on refund for select
  using (exists (select 1 from "order" o where o.order_id = refund.order_id and o.consumer_id = auth.uid()));

create policy wallet_own on wallet_transaction for select
  using (consumer_id = auth.uid() or app.is_ops());

create policy review_public on review for select
  using (published or consumer_id = auth.uid()
         or app.can_store(store_id, array['owner','manager']::partner_role[]) or app.is_ops());
-- Insert guarded by app.submit_review(): only a redeemed order qualifies (rule 9).

create policy dispute_own on dispute for select
  using (consumer_id = auth.uid() or app.is_ops());

create policy notif_own on notification_log for select
  using (recipient_user = auth.uid() or app.is_ops());
create policy notif_pref_own on notification_preference for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================================
-- PARTNER  — roles are per store; see docs/02-data-model.md §3
-- ============================================================================

create policy partner_read on partner for select
  using (app.can_partner(partner_id, array['owner','manager','staff','accountant']::partner_role[])
         or (app.is_ops() and market = any(app.current_markets())));
-- Only owner may edit partner profile, and only the editable subset — enforced
-- by app.update_partner_profile(), which routes name/logo/description changes
-- into the moderation queue rather than straight to consumers.

create policy store_manage on store for update
  using (app.can_store(store_id, array['owner','manager']::partner_role[]))
  with check (app.can_store(store_id, array['owner','manager']::partner_role[]));

create policy store_hours_rw on store_hours for all
  using (app.can_store(store_id, array['owner','manager']::partner_role[]))
  with check (app.can_store(store_id, array['owner','manager']::partner_role[]));

create policy closure_rw on store_closure for all
  using (app.can_store(store_id, array['owner','manager']::partner_role[]))
  with check (app.can_store(store_id, array['owner','manager']::partner_role[]));

create policy template_read on bag_template for select
  using (app.can_partner(partner_id, array['owner','manager','staff']::partner_role[]));
create policy template_write on bag_template for all
  using (app.can_partner(partner_id, array['owner','manager']::partner_role[]))
  with check (app.can_partner(partner_id, array['owner','manager']::partner_role[]));

create policy schedule_rw on listing_schedule for all
  using (app.can_store(store_id, array['owner','manager']::partner_role[]))
  with check (app.can_store(store_id, array['owner','manager']::partner_role[]));

create policy listing_partner_read on listing for select
  using (app.can_store(store_id, array['owner','manager','staff','accountant']::partner_role[]));
-- Creation, quantity edits, price freeze and cancellation all go through
-- app.publish_listing() / app.update_listing() / app.cancel_listing().
-- Staff may only change quantity: enforced inside the function, not here.

create policy redemption_read on redemption for select
  using (app.can_store(store_id, array['owner','manager','staff']::partner_role[]) or app.is_ops());

create policy cash_collection_read on cash_collection for select
  using (exists (select 1 from "order" o where o.order_id = cash_collection.order_id
                 and app.can_store(o.store_id, array['owner','manager','staff']::partner_role[]))
         or app.is_ops(array['finance','ops_manager','admin']::ops_role[]));

create policy cash_recon_rw on cash_reconciliation for all
  using (app.can_store(store_id, array['owner','manager']::partner_role[])
         or app.is_ops(array['finance','ops_manager','admin']::ops_role[]))
  with check (app.can_store(store_id, array['owner','manager']::partner_role[]));

create policy document_read on partner_document for select
  using (app.can_partner(partner_id, array['owner']::partner_role[])
         or app.is_ops(array['compliance','ops_manager','admin']::ops_role[]));
create policy document_upload on partner_document for insert
  with check (app.can_partner(partner_id, array['owner']::partner_role[]));

create policy staff_read on staff_assignment for select
  using (user_id = auth.uid()
         or app.can_partner(partner_id, array['owner','manager']::partner_role[])
         or app.is_ops());
-- Invites and revocations go through app.invite_staff() / app.revoke_staff();
-- a manager may only manage 'staff', enforced in the function.

create policy contract_read on partner_contract for select
  using (app.can_partner(partner_id, array['owner','accountant']::partner_role[]) or app.is_ops());

-- MONEY: owner and accountant only. A manager never sees payouts.
create policy payout_read on payout for select
  using (app.can_partner(partner_id, array['owner','accountant']::partner_role[])
         or app.is_ops(array['finance','admin']::ops_role[]));

create policy statement_read on statement for select
  using (app.can_partner(partner_id, array['owner','accountant']::partner_role[])
         or app.is_ops(array['finance','admin']::ops_role[]));

-- The partner sees only their own ledger rows, and only via the statement views.
create policy ledger_partner_read on financial_entry for select
  using ((partner_id is not null
          and app.can_partner(partner_id, array['owner','accountant']::partner_role[]))
         or app.is_ops(array['finance','admin','compliance']::ops_role[]));

create policy compliance_read on compliance_entry for select
  using (app.can_store(store_id, array['owner','manager','accountant']::partner_role[])
         or app.is_ops(array['compliance','ops_manager','finance','admin']::ops_role[]));

create policy quality_flag_partner on quality_flag for select
  using (app.can_store(store_id, array['owner','manager']::partner_role[]) or app.is_ops());

create policy review_response_rw on review_response for all
  using (exists (select 1 from review r where r.id = review_response.review_id
                 and app.can_store(r.store_id, array['owner','manager']::partner_role[])))
  with check (exists (select 1 from review r where r.id = review_response.review_id
                 and app.can_store(r.store_id, array['owner','manager']::partner_role[])));

create policy api_key_owner on partner_api_key for select
  using (app.can_partner(partner_id, array['owner']::partner_role[]));

create policy webhook_owner on partner_webhook for all
  using (app.can_partner(partner_id, array['owner']::partner_role[]))
  with check (app.can_partner(partner_id, array['owner']::partner_role[]));

-- ============================================================================
-- OPS  — every role scoped by market. See docs/02-data-model.md §2.
-- ============================================================================

-- Market scoping is not optional. A Kuwait ops manager cannot see Egyptian
-- consumer PII by default, so every ops policy carries the market predicate.

create policy ops_partner_all on partner for update
  using (app.is_ops(array['ops_manager','admin']::ops_role[]) and market = any(app.current_markets()))
  with check (app.is_ops(array['ops_manager','admin']::ops_role[]) and market = any(app.current_markets()));

create policy ops_document_verify on partner_document for update
  using (app.is_ops(array['compliance','ops_manager','admin']::ops_role[])
         and market = any(app.current_markets()))
  with check (app.is_ops(array['compliance','ops_manager','admin']::ops_role[]));

create policy ops_dispute_rw on dispute for all
  using (app.is_ops() and market = any(app.current_markets()))
  with check (app.is_ops() and market = any(app.current_markets()));

create policy ops_incident_read on incident for select
  using (app.is_ops(array['compliance','ops_manager','admin']::ops_role[])
         and market = any(app.current_markets()));
create policy ops_incident_write on incident for insert
  with check (app.is_ops(array['compliance','ops_manager','admin']::ops_role[]));

create policy ops_hold on quality_hold for all
  using (app.is_ops(array['compliance','ops_manager','admin']::ops_role[]))
  with check (app.is_ops(array['compliance','ops_manager','admin']::ops_role[]));

create policy ops_ledger_read on financial_entry for select
  using (app.is_ops(array['finance','admin']::ops_role[]) and market = any(app.current_markets()));
-- No insert policy: every entry is written by an app.post_* function.

create policy ops_payout_run on payout_run for select
  using (app.is_ops(array['finance','admin']::ops_role[]) and market = any(app.current_markets()));

create policy ops_recon on reconciliation_exception for all
  using (app.is_ops(array['finance','admin']::ops_role[]) and market = any(app.current_markets()))
  with check (app.is_ops(array['finance','admin']::ops_role[]));

create policy ops_period on accounting_period for select
  using (app.is_ops(array['finance','admin']::ops_role[]) and market = any(app.current_markets()));

create policy ops_config_read on market_config for select using (true);
create policy ops_config_write on market_config for update
  using (app.is_ops(array['admin']::ops_role[])) with check (app.is_ops(array['admin']::ops_role[]));

create policy ops_city_write on city for all
  using (app.is_ops(array['ops_manager','admin']::ops_role[]))
  with check (app.is_ops(array['ops_manager','admin']::ops_role[]));

create policy ops_promotion on promotion for all
  using (app.is_ops(array['ops_manager','admin']::ops_role[]) and market = any(app.current_markets()))
  with check (app.is_ops(array['ops_manager','admin']::ops_role[]));

create policy ops_flag on feature_flag for all
  using (app.is_ops(array['engineering','admin']::ops_role[]))
  with check (app.is_ops(array['engineering','admin']::ops_role[]));

create policy ops_template_read on notification_template for select
  using (app.is_ops());
create policy ops_template_write on notification_template for all
  using (app.is_ops(array['ops_manager','admin']::ops_role[]))
  with check (app.is_ops(array['ops_manager','admin']::ops_role[]));

create policy ops_audit_read on audit_log for select
  using (app.is_ops(array['ops_manager','finance','compliance','admin']::ops_role[])
         and (market is null or market = any(app.current_markets())));

create policy ops_job_read on job_run for select
  using (app.is_ops(array['engineering','ops_manager','finance','admin']::ops_role[]));

create policy ops_impersonation on impersonation_session for select
  using (ops_user = auth.uid() or app.is_ops(array['admin','ops_manager']::ops_role[]));

create policy ops_moderation on listing for update
  using (app.is_ops(array['ops_manager','admin']::ops_role[]) and market = any(app.current_markets()))
  with check (app.is_ops(array['ops_manager','admin']::ops_role[]));

-- ============================================================================
-- PII masking for the warehouse / BI role (docs §8.5)
-- ============================================================================

-- DECISION D2: the spec creates bi.consumer_masked but never creates schema `bi`.
create schema if not exists bi;

-- DECISION D3: migrations are forward-only and re-run on every `db reset`, so
-- role creation is made idempotent. CREATE ROLE has no IF NOT EXISTS.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'bi_reader') then
    create role bi_reader noinherit;
  end if;
end $$;

-- Columns arrive masked whatever the query asks for. Unmasking is a separate,
-- justified, time-boxed grant — never a default.
create or replace view bi.consumer_masked as
select user_id, market, city_id,
       left(first_name, 1) || '.'                                as first_name,
       regexp_replace(phone, '(\+\d{3})\d+(\d{3})', '\1•••••\2') as phone,
       regexp_replace(coalesce(email,''), '^(.).*@', '\1•••@')   as email,
       dietary_flags, no_show_count_90d, reliability_score, created_at
from public.consumer_profile;

grant usage on schema bi to bi_reader;
grant select on all tables in schema bi to bi_reader;
revoke all on public.consumer_profile from bi_reader;

-- ============================================================================
-- Grants
-- ============================================================================

-- Clients call functions, not tables, for anything that mutates.
grant usage on schema app to authenticated, anon;
grant execute on all functions in schema app to authenticated;
grant execute on function app.current_markets, app.ops_role, app.is_ops to authenticated, anon;

-- Anonymous browsing only.
grant select on listing, store, city, market_config, v_browse_listing to anon;

-- ============================================================================
-- RLS test checklist — see docs/12-test-plan.md §RLS. Every line must be a test.
-- ============================================================================
--  1. staff at store A cannot read orders at store B (same partner)
--  2. staff cannot read payout, statement or financial_entry at all
--  3. manager cannot read payout; accountant can, but reads no orders board
--  4. manager can invite 'staff' but not 'manager' (function-level)
--  5. consumer cannot read another consumer's order, payment, wallet or dispute
--  6. anon can read v_browse_listing but no consumer_profile row
--  7. KW-scoped ops_manager sees no EG consumer_profile, order or dispute row
--  8. support_agent cannot read financial_entry
--  9. finance cannot update partner or listing
-- 10. engineering cannot approve a payout run
-- 11. no role can UPDATE or DELETE financial_entry, compliance_entry, audit_log
-- 12. no role can INSERT financial_entry directly — only app.post_* functions
-- 13. an entry with effective_at inside a locked period is rejected
-- 14. an unbalanced transaction_id is rejected at commit
-- 15. bi_reader sees masked phone/email and cannot reach consumer_profile
