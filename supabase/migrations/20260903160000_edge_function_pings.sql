-- Wires the two Edge-Function-backed jobs (09-jobs.md): send-notification and
-- dispatch-partner-webhook are pinged every minute through pg_net. The shared
-- secret lives in Vault as `cron_secret`; the SAME value must be set as
-- CRON_SECRET on the Edge Functions (dashboard or CLI — never in the repo).
set search_path = public, extensions;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cron_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'cron_secret',
      'Shared secret for pg_cron -> Edge Function pings');
  end if;
end $$;

create or replace function app.ping_edge_function(p_name text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_secret text; v_url text := 'https://fxjvxmuporiwpqalbddv.supabase.co/functions/v1/' || p_name;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  return net.http_post(url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb, timeout_milliseconds := 25000);
end $$;
revoke all on function app.ping_edge_function(text) from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('bugsha_send_notifications', 'bugsha_dispatch_partner_webhooks');
select cron.schedule('bugsha_send_notifications', '* * * * *', $$select app.ping_edge_function('send-notification')$$);
select cron.schedule('bugsha_dispatch_partner_webhooks', '* * * * *', $$select app.ping_edge_function('dispatch-partner-webhook')$$);
