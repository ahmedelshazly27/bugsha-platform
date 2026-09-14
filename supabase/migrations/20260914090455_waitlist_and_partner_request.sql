-- Waitlist + partner code requests, moved here from the paused "Bugsha" project (qrmyhruvnqmjwxcnkocj).
-- Final state of that project's four waitlist migrations plus partner_request.
-- Applied to the platform project (bugsha-dev, fxjvxmuporiwpqalbddv) on 2026-09-14 as version 20260914090455.
-- Copy this file into bugsha-platform/supabase/migrations/ so that repo's history matches the database.
--
-- Access model: RLS on, no policies; only the edge functions (service role) read or write.

create extension if not exists citext with schema extensions;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;

create table if not exists public.waitlist (
  id                    uuid primary key default gen_random_uuid(),
  email                 extensions.citext not null unique,
  area                  text,
  locale                text,
  source                text,
  referrer              text,
  user_agent            text,
  status                text not null default 'subscribed',
  unsubscribe_token     uuid not null default gen_random_uuid(),
  welcome_email_sent_at timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint waitlist_status_check check (status in ('subscribed', 'unsubscribed', 'bounced')),
  constraint waitlist_email_shape_check check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint waitlist_unsubscribe_token_key unique (unsubscribe_token)
);
comment on table  public.waitlist is 'Pre-launch waitlist signups from the Bugsha landing page.';
comment on column public.waitlist.source is 'Where the signup came from, e.g. site-waitlist.';
comment on column public.waitlist.area   is 'Optional "Where" value from the form (Kuwait / Egypt), used for launch sequencing.';
comment on column public.waitlist.status is 'subscribed | unsubscribed | bounced';
create index if not exists waitlist_created_at_idx on public.waitlist (created_at desc);
create index if not exists waitlist_status_idx     on public.waitlist (status);
create index if not exists waitlist_area_idx       on public.waitlist (area) where area is not null;
drop trigger if exists waitlist_set_updated_at on public.waitlist;
create trigger waitlist_set_updated_at before update on public.waitlist for each row execute function public.set_updated_at();
alter table public.waitlist enable row level security;
revoke all on public.waitlist from anon, authenticated;
grant all on public.waitlist to service_role;

-- "You're #128 in line", counted over live subscribers with a deterministic tiebreak.
create or replace function public.waitlist_position(p_email extensions.citext)
returns integer language sql stable security definer set search_path = public, extensions as $$
  select count(*)::int from public.waitlist w
  where w.status = 'subscribed'
    and (w.created_at, w.id) <= (select w2.created_at, w2.id from public.waitlist w2 where w2.email = p_email);
$$;
revoke all on function public.waitlist_position(extensions.citext) from public, anon, authenticated;
grant execute on function public.waitlist_position(extensions.citext) to service_role;

-- Partner code requests (website + partner app). Ops issues the invite code against a request.
create table if not exists public.partner_request (
  id                    uuid primary key default gen_random_uuid(),
  market                text not null,
  legal_name            text not null,
  trading_name          text not null,
  categories            text[] not null default '{}',
  contact_name          text not null,
  contact_phone         text not null,
  contact_email         extensions.citext not null,
  city                  text,
  branch_count          integer not null default 1,
  est_daily_surplus     text,
  referral_source       text,
  source                text,
  locale                text,
  referrer              text,
  user_agent            text,
  status                text not null default 'new',
  decline_reason        text,
  invite_code           text,
  code_issued_at        timestamptz,
  code_issued_by        text,
  notes                 text,
  confirmation_sent_at  timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint partner_request_market_check       check (market in ('KW', 'EG')),
  constraint partner_request_status_check       check (status in ('new', 'contacted', 'code_issued', 'declined')),
  constraint partner_request_branch_count_check check (branch_count between 1 and 500),
  constraint partner_request_email_shape_check  check (contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint partner_request_no_alcohol_check   check (not ('alcohol' = any (categories)))
);
comment on table  public.partner_request is 'Kitchens asking for a Bugsha partner code. Reviewed by ops; a code is issued from the ops console.';
comment on column public.partner_request.status is 'new | contacted | code_issued | declined';
create index if not exists partner_request_created_at_idx on public.partner_request (created_at desc);
create index if not exists partner_request_status_idx     on public.partner_request (status);
create index if not exists partner_request_market_idx     on public.partner_request (market);
create index if not exists partner_request_email_idx      on public.partner_request (contact_email);
drop trigger if exists partner_request_set_updated_at on public.partner_request;
create trigger partner_request_set_updated_at before update on public.partner_request for each row execute function public.set_updated_at();
alter table public.partner_request enable row level security;
revoke all on public.partner_request from anon, authenticated;
grant all on public.partner_request to service_role;
