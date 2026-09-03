-- ============================================================================
-- Fixtures 30 — templates, schedules, and 14 days of materialised listings
-- Local intent (local_date/local_start/local_end) and the resolved UTC instants
-- are BOTH persisted; the resolution uses store.timezone (CLAUDE.md §7).
-- ============================================================================
set search_path = public, extensions;

-- ─── Templates ──────────────────────────────────────────────────────────────
-- price_minor <= value_min_minor * max_price_fraction (0.50), and price inside
-- the market's price_min_minor…price_max_minor band (02-data-model.md §5).
insert into bag_template (id, partner_id, store_id, title_en, title_ar,
                          description_en, description_ar, category,
                          value_min_minor, value_max_minor, price_minor,
                          default_quantity, default_window_start, default_window_end,
                          dietary_flags)
select ('7e719a7e-0000-4000-8000-' || lpad(to_hex(row_number() over (order by s.store_id)), 12, '0'))::uuid,
       s.partner_id, s.store_id,
       'Evening Bakery Bag', 'بقشة المخبز المسائية',
       'A mix of what the counter still has at close. Contents vary each evening.',
       'تشكيلة مما تبقى على الكاونتر عند الإغلاق. المحتويات تختلف كل مساء.',
       'bakery',
       case when s.market = 'KW' then 3000 else 20000 end,
       case when s.market = 'KW' then 6000 else 40000 end,
       case when s.market = 'KW' then 1500 else 8900 end,
       8, time '21:00', time '22:00',
       '{}'::text[]
from store s;

-- ─── Schedules ──────────────────────────────────────────────────────────────
insert into listing_schedule (id, store_id, template_id, weekdays, local_start,
                              local_end, quantity, publish_lead_minutes, ramadan_affected)
select ('5cced001-0000-4000-8000-' || lpad(to_hex(row_number() over (order by t.store_id)), 12, '0'))::uuid,
       t.store_id, t.id, '{0,1,2,3,4,5,6}'::smallint[], time '21:00', time '22:00', 8, 150,
       -- A 21:00 window collides with iftar/suhoor; flagged so the Ramadan
       -- suspension path has something to act on (02-data-model.md §5).
       true
from bag_template t;

-- ─── Materialised listings: 14-day rolling horizon, plus 3 days of history ──
-- The blocked store (…003) gets history only: publishing is blocked, but its
-- existing orders are still honoured (§13-8).
insert into listing (listing_id, store_id, partner_id, market, city_id, template_id,
                     schedule_id, title_snapshot, description_snapshot, category,
                     price_minor, currency, value_min_minor, value_max_minor,
                     quantity_total, quantity_remaining,
                     local_date, local_start, local_end,
                     window_start_utc, window_end_utc, reservation_cutoff_utc,
                     status, created_by)
select
  ('11577000-0000-4000-8000-' || lpad(to_hex(
      (row_number() over (order by s.store_id, d.offset_days))), 12, '0'))::uuid,
  s.store_id, s.partner_id, s.market, s.city_id, t.id, sc.id,
  t.title_en, t.description_en, t.category,
  t.price_minor,
  case when s.market = 'KW' then 'KWD' else 'EGP' end,
  t.value_min_minor, t.value_max_minor,
  8,
  case when d.offset_days < 0 then 0 else 8 end,
  (current_date + d.offset_days), time '21:00', time '22:00',
  ((current_date + d.offset_days) + time '21:00') at time zone s.timezone,
  ((current_date + d.offset_days) + time '22:00') at time zone s.timezone,
  ((current_date + d.offset_days) + time '22:00') at time zone s.timezone,
  case when d.offset_days < 0 then 'closed' else 'active' end::listing_status,
  null   -- materialised by the scheduler, not a user
from store s
join bag_template t   on t.store_id = s.store_id
join listing_schedule sc on sc.store_id = s.store_id
cross join lateral (
  select gs as offset_days
  from generate_series(-3, 13) gs
  where s.store_id <> 'eeeeeeee-0000-4000-8000-000000000003' or gs < 0
) d;
