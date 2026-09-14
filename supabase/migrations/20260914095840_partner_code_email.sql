-- ============================================================================
-- Partner code emails are sent by the database, not by a person.
--
-- Targets bugsha-dev (fxjvxmuporiwpqalbddv). Requires 20260914094502_partner_invite_codes.
-- APPLIED to bugsha-dev on 2026-09-14 as version 20260914095840.
-- Copy into bugsha-platform/supabase/migrations/ next to it.
--
-- How it works
--   ops_issue_partner_code inserts into public.partner_invite_code
--     → AFTER INSERT trigger posts {code} through pg_net to the
--       partner-code-email edge function, signed with a shared secret from Vault
--     → the function renders the "Your Bugsha partner code" email, sends it with
--       Resend, and writes emailed_at / email_error back on the row.
--   app.ops_resend_partner_code(code) posts again on "Resend" in the ops console.
-- ============================================================================

alter table public.partner_invite_code
  add column if not exists emailed_at     timestamptz,
  add column if not exists email_error    text,
  add column if not exists email_attempts integer not null default 0;
comment on column public.partner_invite_code.emailed_at is 'Last time the code email was accepted by the mail provider.';
comment on column public.partner_invite_code.email_error is 'Why the last send failed, if it did.';

-- Shared secret between the trigger and the edge function. Created once; never rotated here.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'partner_code_hook') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'partner_code_hook',
      'Shared secret: partner_invite_code trigger → partner-code-email edge function');
  end if;
end $$;

-- The edge function reads the secret through this (service role only) and compares it
-- with the x-bugsha-hook header.
create or replace function app.hook_secret() returns text
language sql stable security definer set search_path to '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'partner_code_hook' limit 1;
$$;
revoke all on function app.hook_secret() from public, anon, authenticated;
grant execute on function app.hook_secret() to service_role;

create or replace function app.partner_code_email_request(p_code text) returns bigint
language plpgsql security definer set search_path to '' as $$
declare v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'partner_code_hook';
  return net.http_post(
    url := 'https://fxjvxmuporiwpqalbddv.supabase.co/functions/v1/partner-code-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-bugsha-hook', v_secret),
    body := jsonb_build_object('code', p_code),
    timeout_milliseconds := 15000);
end $$;
revoke all on function app.partner_code_email_request(text) from public, anon, authenticated;

create or replace function app.partner_invite_code_email_trigger() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  perform app.partner_code_email_request(new.code);
  return new;
end $$;
drop trigger if exists partner_invite_code_email on public.partner_invite_code;
create trigger partner_invite_code_email after insert on public.partner_invite_code
  for each row execute function app.partner_invite_code_email_trigger();

create or replace function app.ops_resend_partner_code(p_code text) returns void
language plpgsql security definer set search_path to '' as $$
declare c public.partner_invite_code;
begin
  perform app.ops_require(array['ops_manager','admin']::public.ops_role[]);
  select * into c from public.partner_invite_code where code = upper(p_code);
  if not found then raise exception 'code not found' using errcode = 'BG132'; end if;
  if c.revoked_at is not null or c.redeemed_at is not null or c.expires_at < now() then
    raise exception 'code is no longer live' using errcode = 'BG136';
  end if;
  perform app.partner_code_email_request(c.code);
  perform app.audit('ops_resend_partner_code', 'partner_invite_code', null, null, jsonb_build_object('code', c.code), null, null, c.market);
end $$;
