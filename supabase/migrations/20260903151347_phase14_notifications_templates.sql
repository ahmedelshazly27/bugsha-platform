-- Phase 14 — notifications, template review, campaigns (docs/11-i18n.md §9, 08-jobs.md, 13-config.md).
set search_path = public, extensions;

-- Outbound queue consumed by the send-notification Edge Function.
create table if not exists notification_outbox (
  id uuid primary key default uuid_generate_v4(),
  template_key text not null, locale public.locale_code not null, recipient_user uuid not null,
  order_id uuid references "order"(order_id), params jsonb not null default '{}',
  channels text[] not null default '{push}', bypasses_quiet_hours boolean not null default false,
  scheduled_for timestamptz not null default now(), claimed_at timestamptz, sent_at timestamptz, attempts integer not null default 0, last_error text
);
create index if not exists notification_outbox_due on notification_outbox (scheduled_for) where sent_at is null;
alter table notification_outbox enable row level security; alter table notification_outbox force row level security;
drop policy if exists outbox_ops on notification_outbox;
create policy outbox_ops on notification_outbox for select using (app.is_ops());

/** Voice rules are enforced server-side too (11-i18n.md §1). */
create or replace function app.copy_has_forbidden_term(p_locale public.locale_code, p_text text)
returns text language sql immutable set search_path = '' as $$
  select t from unnest(case p_locale
    when 'en' then array['leftover','leftovers','expired','old food','waste','wasted','scraps','hurry',E'don''t miss out','last chance','act now','only for the fastest','needy','poor','charity','save the planet']
    when 'ar-KW' then array['بواقي','مخلفات','منتهي','بايت','زايد','فضلات','نفايات','اسرع','أسرع','لا تفوت الفرصة','الفرصة الأخيرة','محتاجين','الفقراء','صدقة','أنقذ الكوكب']
    else array['بواقي','مخلفات','منتهي','بايت','زايد','فضلات','نفايات','اسرع','بسرعة','متفوتش الفرصة','آخر فرصة','محتاجين','الفقرا','صدقة','أنقذ الكوكب'] end) t
  where lower(p_text) like '%' || lower(t) || '%' limit 1;
$$;

/** Author a template version. A banned term is rejected at authoring, not just at review. */
create or replace function app.ops_upsert_template(p_key text, p_locale public.locale_code, p_title text, p_body text, p_deep_link text default null, p_bypasses_quiet_hours boolean default false)
returns public.notification_template language plpgsql security definer set search_path = '' as $$
declare v_ver integer; t public.notification_template; v_bad text;
begin
  perform app.ops_require(array['ops_manager','admin']::public.ops_role[]);
  v_bad := coalesce(app.copy_has_forbidden_term(p_locale, p_title), app.copy_has_forbidden_term(p_locale, p_body));
  if v_bad is not null then raise exception 'banned term "%" in % copy', v_bad, p_locale using errcode = 'BG170'; end if;
  select coalesce(max(version),0) + 1 into v_ver from public.notification_template where key = p_key and locale = p_locale;
  insert into public.notification_template (key, locale, title, body, deep_link, bypasses_quiet_hours, authored_by, version)
  values (p_key, p_locale, p_title, p_body, p_deep_link, p_bypasses_quiet_hours, auth.uid(), v_ver) returning * into t;
  return t;
end $$;

/** A reviewer may not be the author — the schema constraint enforces it. */
create or replace function app.ops_review_template(p_key text, p_locale public.locale_code, p_version integer)
returns public.notification_template language plpgsql security definer set search_path = '' as $$
declare t public.notification_template; v_bad text;
begin
  perform app.ops_require(array['ops_manager','admin']::public.ops_role[]);
  select * into t from public.notification_template where key = p_key and locale = p_locale and version = p_version;
  if not found then raise exception 'unknown template version' using errcode = 'BG102'; end if;
  v_bad := coalesce(app.copy_has_forbidden_term(p_locale, t.title), app.copy_has_forbidden_term(p_locale, t.body));
  if v_bad is not null then raise exception 'banned term "%" — review refused', v_bad using errcode = 'BG170'; end if;
  update public.notification_template set reviewed_by = auth.uid(), reviewed_at = now() where key = p_key and locale = p_locale and version = p_version returning * into t;
  return t;
end $$;

/** Refuses unless ALL THREE locales of the version are reviewed (11-i18n.md §9). */
create or replace function app.publish_notification_template(p_key text, p_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_missing text[];
begin
  perform app.ops_require(array['ops_manager','admin']::public.ops_role[]);
  select array_agg(l::text) into v_missing from unnest(array['en','ar-KW','ar-EG']::public.locale_code[]) l
  where not exists (select 1 from public.notification_template t where t.key = p_key and t.version = p_version and t.locale = l and t.reviewed_at is not null);
  if v_missing is not null then
    raise exception 'publish refused: % not reviewed', array_to_string(v_missing, ', ') using errcode = 'BG171';
  end if;
  update public.notification_template set published = false where key = p_key and published;
  update public.notification_template set published = true where key = p_key and version = p_version;
  perform app.audit('publish_notification_template', 'notification_template', null, null, jsonb_build_object('key', p_key, 'version', p_version));
  return jsonb_build_object('published', true, 'key', p_key, 'version', p_version);
end $$;

create or replace function app.ops_templates(p_key text default null)
returns setof public.notification_template language sql stable security definer set search_path = '' as $$
  select * from public.notification_template where app.is_ops() and (p_key is null or key = p_key) order by key, version desc, locale; $$;

/** Enqueue. Resolves the recipient's locale and preferences; quiet hours unless the template bypasses them. */
create or replace function app.notify(p_user uuid, p_template_key text, p_params jsonb default '{}', p_order uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_locale public.locale_code; v_pref public.notification_preference; v_tpl public.notification_template; v_when timestamptz := now(); v_id uuid;
begin
  select coalesce(u.locale, mc.default_locale) into v_locale from public.app_user u join public.market_config mc on mc.market = u.primary_market where u.id = p_user;
  select * into v_pref from public.notification_preference where user_id = p_user;
  select * into v_tpl from public.notification_template where key = p_template_key and locale = v_locale and published limit 1;
  if v_tpl.key is null then
    insert into public.notification_log (template_key, locale, recipient_user, order_id, channels, suppressed_reason)
    values (p_template_key, v_locale, p_user, p_order, '{}', 'no published template for locale');
    return null;
  end if;
  if not v_tpl.bypasses_quiet_hours and v_pref.quiet_from is not null and localtime between v_pref.quiet_from and v_pref.quiet_to then
    v_when := date_trunc('day', now()) + v_pref.quiet_to;
  end if;
  insert into public.notification_outbox (template_key, locale, recipient_user, order_id, params, channels, bypasses_quiet_hours, scheduled_for)
  values (p_template_key, v_locale, p_user, p_order, p_params, coalesce(v_pref.channel_pref, '{push}'), v_tpl.bypasses_quiet_hours, v_when) returning id into v_id;
  return v_id;
end $$;

/** The Edge Function claims due rows, renders and dispatches, then records. */
create or replace function app.claim_notifications(p_limit integer default 100)
returns setof public.notification_outbox language sql security definer set search_path = '' as $$
  update public.notification_outbox set claimed_at = now(), attempts = attempts + 1
  where id in (select id from public.notification_outbox where sent_at is null and scheduled_for <= now() and (claimed_at is null or claimed_at < now() - interval '10 minutes') order by scheduled_for limit p_limit for update skip locked)
  returning *;
$$;
create or replace function app.record_notification(p_outbox uuid, p_results jsonb, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.notification_outbox;
begin
  select * into o from public.notification_outbox where id = p_outbox;
  if p_error is null then
    update public.notification_outbox set sent_at = now() where id = p_outbox;
    insert into public.notification_log (template_key, locale, recipient_user, order_id, channels, results) values (o.template_key, o.locale, o.recipient_user, o.order_id, o.channels, p_results);
  else
    update public.notification_outbox set last_error = p_error, claimed_at = null where id = p_outbox;
  end if;
end $$;

create or replace function app.ops_notifications(p_user uuid default null, p_limit integer default 100)
returns setof public.notification_log language sql stable security definer set search_path = '' as $$
  select * from public.notification_log where app.is_ops() and (p_user is null or recipient_user = p_user) order by sent_at desc limit least(p_limit, 500); $$;
create or replace function app.ops_resend_notification(p_log uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare l public.notification_log;
begin
  perform app.ops_require(array['support_agent','ops_manager','admin']::public.ops_role[]);
  select * into l from public.notification_log where id = p_log;
  return app.notify(l.recipient_user, l.template_key, '{}', l.order_id);
end $$;

/** Consumer notification preferences (S-C-058). */
create or replace function app.set_notification_preferences(p_categories jsonb, p_quiet_from time default null, p_quiet_to time default null, p_channels text[] default '{push}')
returns public.notification_preference language sql security definer set search_path = '' as $$
  insert into public.notification_preference (user_id, categories, quiet_from, quiet_to, channel_pref) values (auth.uid(), p_categories, p_quiet_from, p_quiet_to, p_channels)
  on conflict (user_id) do update set categories = excluded.categories, quiet_from = excluded.quiet_from, quiet_to = excluded.quiet_to, channel_pref = excluded.channel_pref returning *; $$;

-- Wire the lifecycle events that 11-i18n.md §10 lists to the outbox.
create or replace function app.notify_on_order_change() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'reserved' and old.status = 'held' then
    perform app.notify(new.consumer_id, 'consumer.order_confirmed', jsonb_build_object('code', new.code, 'order_id', new.order_id), new.order_id);
  elsif new.status = 'cancelled_partner' and old.status <> 'cancelled_partner' then
    perform app.notify(new.consumer_id, 'consumer.store_cancelled', jsonb_build_object('order_id', new.order_id), new.order_id);
  elsif new.status = 'redeemed' and old.status <> 'redeemed' then
    perform app.notify(new.consumer_id, 'consumer.collected', jsonb_build_object('order_id', new.order_id), new.order_id);
  end if;
  return new;
end $$;
drop trigger if exists order_notify on "order";
create trigger order_notify after update of status on "order" for each row execute function app.notify_on_order_change();

/** Window reminders: opening in 30 min, closing in 20 min. */
create or replace function app.send_window_reminders() returns integer language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  for r in select order_id, consumer_id, window_start_utc, window_end_utc from public."order" where status = 'reserved'
    and window_start_utc between now() + interval '29 minutes' and now() + interval '31 minutes' loop
    perform app.notify(r.consumer_id, 'consumer.window_opening', jsonb_build_object('minutes', 30), r.order_id); n := n + 1;
  end loop;
  for r in select order_id, consumer_id from public."order" where status = 'reserved'
    and window_end_utc between now() + interval '19 minutes' and now() + interval '21 minutes' loop
    perform app.notify(r.consumer_id, 'consumer.closing_soon', jsonb_build_object('minutes', 20), r.order_id); n := n + 1;
  end loop;
  perform app.job_finish('send_window_reminders', n);
  return n;
end $$;
do $$ begin
  if not exists (select 1 from cron.job where jobname = 'bugsha_window_reminders') then
    perform cron.schedule('bugsha_window_reminders', '* * * * *', $c$select app.send_window_reminders()$c$);
  end if;
end $$;

-- Seed the templates from the approved register, reviewed by a second admin so they publish.
insert into notification_template (key, locale, title, body, deep_link, bypasses_quiet_hours, authored_by, reviewed_by, reviewed_at, published, version)
select t.key, t.locale::public.locale_code, t.title, t.body, t.deep_link, t.bypass, 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000006', now(), true, 1
from (values
  ('consumer.order_confirmed','en','Reserved at {store}','Code {code} · collect {window}','bugsha://order/:id',false),
  ('consumer.order_confirmed','ar-KW','تم الحجز في {store}','الرمز {code} · الاستلام {window}','bugsha://order/:id',false),
  ('consumer.order_confirmed','ar-EG','اتحجزت في {store}','الكود {code} · الاستلام {window}','bugsha://order/:id',false),
  ('consumer.window_opening','en','Pickup opens in {minutes} minutes','{distance} from you','bugsha://order/:id',false),
  ('consumer.window_opening','ar-KW','الاستلام يبدأ بعد {minutes} دقيقة','{distance} منك','bugsha://order/:id',false),
  ('consumer.window_opening','ar-EG','الاستلام هيبدأ بعد {minutes} دقيقة','{distance} منك','bugsha://order/:id',false),
  ('consumer.closing_soon','en','{minutes} minutes left to collect','The window closes at {time}','bugsha://redeem/:id',true),
  ('consumer.closing_soon','ar-KW','باقي {minutes} دقيقة للاستلام','ينتهي الوقت {time}','bugsha://redeem/:id',true),
  ('consumer.closing_soon','ar-EG','فاضل {minutes} دقيقة على الاستلام','الوقت بيقفل {time}','bugsha://redeem/:id',true),
  ('consumer.collected','en','Collected — enjoy it','Rate your bag in a tap','bugsha://review/:id',false),
  ('consumer.collected','ar-KW','تم الاستلام — بالهناء','قيّم بقشتك بضغطة','bugsha://review/:id',false),
  ('consumer.collected','ar-EG','استلمتها — بالهنا','قيّمها بضغطة واحدة','bugsha://review/:id',false),
  ('consumer.store_cancelled','en','{store} had to cancel','Full refund on the way, nothing for you to do','bugsha://order/:id',true),
  ('consumer.store_cancelled','ar-KW','اضطر {store} للإلغاء','الاسترداد كامل في طريقه، لا يلزمك شيء','bugsha://order/:id',true),
  ('consumer.store_cancelled','ar-EG','{store} اضطر يلغي','الفلوس راجعة كاملة، مش محتاج تعمل حاجة','bugsha://order/:id',true),
  ('consumer.refund','en','Refund sent','{amount} is on its way to your bank','bugsha://wallet',false),
  ('consumer.refund','ar-KW','أُرسل الاسترداد','{amount} في طريقها إلى بنكك','bugsha://wallet',false),
  ('consumer.refund','ar-EG','الاسترداد اتبعت','{amount} في طريقها لبنكك','bugsha://wallet',false),
  ('consumer.campaign','en','Ramadan Kareem','Iftar surplus from {time}. Suhoor bakery from {time2}.','bugsha://campaign/:key',false),
  ('consumer.campaign','ar-KW','رمضان كريم','فائض الإفطار من {time}. مخبوزات السحور من {time2}.','bugsha://campaign/:key',false),
  ('consumer.campaign','ar-EG','رمضان كريم','فايض الإفطار من {time}. مخبوزات السحور من {time2}.','bugsha://campaign/:key',false),
  ('partner.document_expired','en','New listings paused — {document} expired','Bags already sold are unaffected. Customers will collect as normal.','bugsha-partner://documents',true),
  ('partner.document_expired','ar-KW','العروض الجديدة موقوفة — انتهت {document}','البقش المباعة غير متأثرة. سيستلمها العملاء كالمعتاد.','bugsha-partner://documents',true),
  ('partner.document_expired','ar-EG','العروض الجديدة موقوفة — {document} خلصت','البقش المبيعة مش متأثرة. العملاء هيستلموها عادي.','bugsha-partner://documents',true)
) as t(key, locale, title, body, deep_link, bypass)
on conflict (key, locale, version) do nothing;

grant execute on function app.ops_upsert_template, app.ops_review_template, app.publish_notification_template, app.ops_templates, app.notify,
  app.ops_notifications, app.ops_resend_notification, app.set_notification_preferences, app.copy_has_forbidden_term to authenticated;
grant execute on function app.claim_notifications, app.record_notification to service_role;
