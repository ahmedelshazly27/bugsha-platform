-- translate() maps positionally: the 'to' string was one character short, so
-- آ mapped to ي and ى to ه. Found by search test S-2.
set search_path = public, extensions;
create or replace function app.normalise_ar(p text)
returns text language sql immutable set search_path = '' as $$
  select lower(translate(regexp_replace(coalesce(p,''), '[ً-ْٰـ]', '', 'g'), 'أإآىة', 'ااايه'));
$$;
-- Generated columns are recomputed only on write; force it.
update listing set updated_at = updated_at where true;
update store set updated_at = updated_at where true;
