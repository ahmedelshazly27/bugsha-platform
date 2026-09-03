-- ============================================================================
-- Bugsha fixture set — docs/12-test-plan.md §fixtures
-- Loaded by `supabase db reset`. Order matters: reference → identity →
-- partner → catalog → commerce → money → trust.
-- Built in phase 1, not phase 11, because the ops console and the payout
-- screens are untestable without it.
-- ============================================================================
\i seed/00_reference.sql
\i seed/10_identity.sql
\i seed/20_partner.sql
\i seed/30_catalog.sql
\i seed/40_commerce.sql
\i seed/50_money.sql
\i seed/60_trust.sql
