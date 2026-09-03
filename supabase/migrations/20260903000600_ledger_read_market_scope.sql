-- ============================================================================
-- 20260903000600_ledger_read_market_scope.sql
-- DECISION D9 (cont.) — the same unscoped-is_ops defect, on the money surface.
-- ============================================================================
-- `ledger_partner_read` ended in an UNSCOPED app.is_ops(...) branch. Permissive
-- policies OR together, so it defeated the market predicate on
-- `ops_ledger_read` directly below it, and a KW-scoped finance user could read
-- every Egyptian ledger balance.
--
-- Found by the D14 regression test, not the phase-1 suite: RLS test 8 only
-- exercises support_agent, who is in neither role list.
set search_path = public, extensions;

drop policy ledger_partner_read on financial_entry;

create policy ledger_partner_read on financial_entry for select
  using ((partner_id is not null
          and app.can_partner(partner_id, array['owner','accountant']::partner_role[]))
         or (app.is_ops(array['finance','admin','compliance']::ops_role[])
             and market = any(app.current_markets())));
