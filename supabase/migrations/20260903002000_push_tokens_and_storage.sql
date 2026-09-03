-- Expo push tokens per device, and the documents bucket generate-document writes to.
set search_path = public, extensions;
create table if not exists device_token (
  user_id uuid not null references app_user(id) on delete cascade,
  token text not null, platform text not null, updated_at timestamptz not null default now(),
  primary key (user_id, token)
);
alter table device_token enable row level security; alter table device_token force row level security;
create policy own_device on device_token for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create or replace function app.register_device(p_token text, p_platform text) returns void language sql security definer set search_path = '' as $$
  insert into public.device_token (user_id, token, platform) values (auth.uid(), p_token, p_platform)
  on conflict (user_id, token) do update set updated_at = now(), platform = excluded.platform; $$;
grant execute on function app.register_device to authenticated;
insert into storage.buckets (id, name, public) values ('documents', 'documents', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('kyb', 'kyb', false) on conflict (id) do nothing;
