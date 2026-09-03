-- ============================================================================
-- pgTAP shared helpers. Sourced by every test file; nothing here persists.
-- Each test authenticates as a real fixture user with a JWT claim, exactly as
-- a client does. Authorisation is decided by the database, never the caller
-- (docs/CLAUDE.md §11).
--
-- This file is deliberately NOT wrapped in a transaction: pg_prove runs each
-- file independently and in name order, so the helpers must survive for
-- 01_rls.sql and 02_ledger.sql to use them. It still emits TAP so the runner
-- sees a passing file rather than a plan-less one.
-- ============================================================================
create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

-- Become a signed-in user. `set local` so it unwinds with the test transaction.
create or replace function tests.authenticate_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end $$;

-- Become an unauthenticated visitor.
create or replace function tests.authenticate_as_anon() returns void
language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
end $$;

create or replace function tests.clear_auth() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', null, true);
end $$;

-- Fixture handles, so a test reads as prose rather than as UUIDs.
create or replace function tests.uid(p_kind text, p_n integer) returns uuid
language sql immutable as $$
  select ((case p_kind
             when 'consumer' then 'cccccccc'
             when 'staff'    then 'bbbbbbbb'
             when 'ops'      then 'aaaaaaaa'
             when 'partner'  then 'dddddddd'
             when 'store'    then 'eeeeeeee'
           end) || '-0000-4000-8000-' || lpad(to_hex(p_n), 12, '0'))::uuid;
$$;

-- ─── TAP ────────────────────────────────────────────────────────────────────
begin;
select plan(2);
select has_function('tests', 'authenticate_as', array['uuid'], 'auth helper is installed');
select has_function('tests', 'uid', array['text','integer'], 'fixture handle helper is installed');
select * from finish();
rollback;
