-- ============================================================================
-- 20260903000100_schema.sql
-- Derived from docs/03-schema.sql, forward-only.
-- Deviations from the spec text are marked DECISION Dn and recorded in
-- docs/DECISIONS.md. Nothing else is changed.
-- ============================================================================

-- ============================================================================
-- Bugsha — 03 schema
-- Forward-only. Split into supabase/migrations/ in the order the sections appear.
-- Read docs/05-money.md before touching section 7.
-- ============================================================================

-- DECISION D4: extension placement is explicit. Hosted Supabase keeps
-- extensions out of `public`; pg_cron lives in its own schema. Unqualified
-- `create extension` would put them in `public` and collide with the app tables.
create schema if not exists extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists postgis    with schema extensions;
create extension if not exists pg_net     with schema extensions;
-- pg_cron owns its own schema: its control file creates `cron`, so neither
-- pre-creating that schema nor passing `with schema` is permitted (42P06).
create extension if not exists pg_cron;

-- DECISION D4 (cont.): with postgis in `extensions`, the geography type is not
-- visible unqualified. Put it on the search path for the rest of this migration
-- so `geography(point,4326)` resolves in city.centroid and store.location.
set search_path = public, extensions;

create schema if not exists app;   -- business logic functions
comment on schema app is 'Business logic. Callers are clients via RPC; every function is security definer and asserts authorisation explicitly.';
