-- ============================================================================
-- 20260903000500_views_security_invoker.sql
-- DECISION D14 — closes an RLS bypass in both views from 03-schema.sql §12.
-- ============================================================================
-- Postgres defaults a view to the OWNER's privileges, so a view owned by
-- postgres BYPASSES row level security. Confirmed exploitable on the fixture
-- set: a staff member who cannot read one financial_entry row (RLS test 2c)
-- could read all 15 rows of v_ledger_balance — every account balance in both
-- markets. The phase-1 suite missed it because it queried the TABLE; the leak
-- was in the VIEW.
set search_path = public, extensions;

alter view v_ledger_balance set (security_invoker = on);
alter view v_browse_listing set (security_invoker = on);

-- v_browse_listing joins review for the rating. Under invoker semantics the
-- caller needs its own privilege on that table; `review_public` already limits
-- rows to published ones, so this grants no more than the card already shows.
grant select on review to anon, authenticated;
