-- Phase 7 forward hardening: strict content validation, serialized content/media
-- mutations, trusted byte verification, and private signed delivery.
--
-- This migration deliberately does not deploy the companion Edge Function.
-- Deploy `verify-portfolio-media` first in staging, configure its exact origin
-- allowlist, then apply this migration and release the matching frontend.

begin;

-- ---------------------------------------------------------------------------
-- Canonical delivery is private. Access is issued through short-lived signed
-- URLs and this migration's row predicate, never through a public bucket URL.
-- The legacy `portfolio-uploads` compatibility bucket remains unchanged.
-- ---------------------------------------------------------------------------

update storage.buckets
set public = false,
    file_size_limit = 3145728,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
where id = 'portfolio-media-public';

alter table public.portfolio_media_assets
  add column if not exists verified_sha256 text,
  add column if not exists verified_mime_type text,
  add column if not exists verified_byte_size bigint,
  add column if not exists verified_width integer,
  add column if not exists verified_height integer,
  add column if not exists verified_frame_count integer,
  add column if not exists verified_total_pixels bigint,
  add column if not exists verified_at timestamptz,
  add column if not exists verification_version integer,
  add column if not exists verified_staging_bucket text,
  add column if not exists verified_staging_path text,
  add column if not exists verified_storage_object_id uuid,
  add column if not exists verified_storage_object_updated_at timestamptz,
  add column if not exists verified_storage_object_etag text;

create index if not exists portfolio_media_assets_verified_object_idx
  on public.portfolio_media_assets (
    verified_staging_bucket,
    verified_staging_path,
    verified_storage_object_id
  )
  where verified_at is not null;

-- Added NOT VALID so an existing installation can deploy safely and re-verify
-- old canonical assets before validating the historical rows. Every new
-- trusted marker is still checked by the RPC and transition trigger below.
do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.portfolio_media_assets'::regclass
      and conname = 'portfolio_media_verified_digest_check'
  ) then
    alter table public.portfolio_media_assets
      add constraint portfolio_media_verified_digest_check
      check (verified_sha256 is null or verified_sha256 ~ '^[0-9a-f]{64}$')
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.portfolio_media_assets'::regclass
      and conname = 'portfolio_media_verified_limits_check'
  ) then
    alter table public.portfolio_media_assets
      add constraint portfolio_media_verified_limits_check
      check (
        verified_at is null
        or (
          verification_version is not null and verification_version >= 1
          and verified_sha256 is not null
          and verified_mime_type in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
          and verified_byte_size is not null
          and verified_byte_size between 1 and 3145728
          and verified_width is not null
          and verified_width between 1 and 6000
          and verified_height is not null
          and verified_height between 1 and 6000
          and verified_width::bigint * verified_height::bigint <= 12000000
          and verified_frame_count is not null
          and verified_frame_count between 1 and 120
          and verified_total_pixels is not null
          and verified_total_pixels between
            verified_width::bigint * verified_height::bigint
            and 24000000
          and verified_staging_bucket = 'portfolio-media-drafts'
          and verified_staging_path is not null
          and verified_storage_object_id is not null
          and verified_storage_object_updated_at is not null
          and nullif(btrim(verified_storage_object_etag), '') is not null
        )
      ) not valid;
  end if;
end
$constraints$;

-- ---------------------------------------------------------------------------
-- Reusable fail-closed helpers
-- ---------------------------------------------------------------------------

create or replace function public.portfolio_request_is_service_role()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';
$function$;

create or replace function public.assert_portfolio_object_keys(
  p_value jsonb,
  p_allowed text[],
  p_required text[],
  p_path text
)
returns void
language plpgsql
immutable
set search_path = ''
as $function$
declare
  object_key text;
  required_key text;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    raise exception '% must be a JSON object', p_path using errcode = '22023';
  end if;

  for object_key in select jsonb_object_keys(p_value)
  loop
    if not (object_key = any(coalesce(p_allowed, array[]::text[]))) then
      raise exception 'Unknown field %.%', p_path, object_key using errcode = '22023';
    end if;
  end loop;

  foreach required_key in array coalesce(p_required, array[]::text[])
  loop
    if not (p_value ? required_key) then
      raise exception 'Missing required field %.%', p_path, required_key using errcode = '22023';
    end if;
  end loop;
end;
$function$;

create or replace function public.assert_portfolio_no_forbidden_keys(
  p_value jsonb,
  p_path text default '$'
)
returns void
language plpgsql
immutable
set search_path = ''
as $function$
declare
  object_key text;
  child jsonb;
  child_index bigint;
  lowered text;
begin
  if p_value is null then
    return;
  end if;

  if jsonb_typeof(p_value) = 'object' then
    for object_key, child in select key, value from jsonb_each(p_value)
    loop
      lowered := lower(object_key);
      if lowered in (
        '__proto__', 'prototype', 'constructor', 'password', 'passcode',
        'secret', 'service_role', 'service_role_key', 'access_token',
        'refresh_token', 'owner_id', 'created_by', 'updated_by',
        'published_by', 'storage_path', 'staging_path', 'staging_bucket'
      ) or left(object_key, 1) in ('_', '$') then
        raise exception 'Forbidden field at %.%', p_path, object_key using errcode = '22023';
      end if;
      perform public.assert_portfolio_no_forbidden_keys(
        child,
        p_path || '[' || to_jsonb(object_key)::text || ']'
      );
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for child, child_index in
      select value, ordinality - 1 from jsonb_array_elements(p_value) with ordinality
    loop
      perform public.assert_portfolio_no_forbidden_keys(
        child,
        p_path || '[' || child_index::text || ']'
      );
    end loop;
  elsif jsonb_typeof(p_value) = 'string' then
    -- URL-bearing fields are validated at their typed sinks below. Ordinary
    -- prose such as "Data: ..." is safe; control characters never are.
    if translate(p_value #>> '{}', E'\n\r\t', '') ~ '[[:cntrl:]]' then
      raise exception 'Unsafe string value at %', p_path using errcode = '22023';
    end if;
  end if;
end;
$function$;

create or replace function public.portfolio_safe_https_url(
  p_value text,
  p_allow_relative boolean default false,
  p_allow_media_token boolean default false
)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select case
    when coalesce(p_value, '') = '' then true
    when p_value ~ '[[:cntrl:][:space:]]' or p_value ~* '%0d|%0a|%5c' or strpos(p_value, E'\\') > 0 then false
    when p_allow_media_token and p_value ~ '^media://[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then true
    when p_allow_relative
      and left(p_value, 1) = '/'
      and left(p_value, 2) <> '//'
      and p_value ~ '^/[A-Za-z0-9._~!$&''()*+,;=:@%/?#-]*$' then true
    when p_allow_relative and p_value ~ '^#[A-Za-z0-9._~!$&''()*+,;=:@%/?#-]+$' then true
    when p_value ~ '^https://([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(:[1-9][0-9]{0,4})?(/[^[:space:]\\]*)?$'
      and p_value !~ '[[:cntrl:]]'
      and p_value !~* '%0d|%0a|%5c'
      then true
    else false
  end;
$function$;

create or replace function public.portfolio_safe_identifier(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select coalesce(p_value,'') ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
    and lower(p_value) not in ('about','admin','preview');
$function$;

create or replace function public.portfolio_safe_email(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select coalesce(p_value,'') = ''
    or (
      length(p_value) <= 254
      and p_value !~ '[[:cntrl:][:space:]]'
      and p_value ~ '^[A-Za-z0-9.!#$%&''*+/=?^_{}~-]+@[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$'
    );
$function$;

create or replace function public.assert_portfolio_field_types(
  p_value jsonb,
  p_string_fields text[],
  p_boolean_fields text[],
  p_number_fields text[],
  p_array_fields text[],
  p_object_fields text[],
  p_path text
)
returns void
language plpgsql
immutable
set search_path = ''
as $function$
declare
  field_name text;
begin
  foreach field_name in array coalesce(p_string_fields, array[]::text[])
  loop
    if p_value ? field_name then
      if jsonb_typeof(p_value -> field_name) <> 'string'
         or length(p_value ->> field_name) > 20000 then
        raise exception '%.% must be a string of at most 20000 characters', p_path, field_name
          using errcode = '22023';
      end if;
    end if;
  end loop;

  foreach field_name in array coalesce(p_boolean_fields, array[]::text[])
  loop
    if p_value ? field_name and jsonb_typeof(p_value -> field_name) <> 'boolean' then
      raise exception '%.% must be a boolean', p_path, field_name using errcode = '22023';
    end if;
  end loop;

  foreach field_name in array coalesce(p_number_fields, array[]::text[])
  loop
    if p_value ? field_name and jsonb_typeof(p_value -> field_name) <> 'number' then
      raise exception '%.% must be a number', p_path, field_name using errcode = '22023';
    end if;
  end loop;

  foreach field_name in array coalesce(p_array_fields, array[]::text[])
  loop
    if p_value ? field_name and jsonb_typeof(p_value -> field_name) <> 'array' then
      raise exception '%.% must be an array', p_path, field_name using errcode = '22023';
    end if;
  end loop;

  foreach field_name in array coalesce(p_object_fields, array[]::text[])
  loop
    if p_value ? field_name and jsonb_typeof(p_value -> field_name) <> 'object' then
      raise exception '%.% must be an object', p_path, field_name using errcode = '22023';
    end if;
  end loop;
end;
$function$;

create or replace function public.assert_portfolio_string_array(
  p_value jsonb,
  p_path text,
  p_max_items integer,
  p_max_length integer default 500
)
returns void
language plpgsql
immutable
set search_path = ''
as $function$
declare
  item jsonb;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'array' then
    raise exception '% must be an array', p_path using errcode = '22023';
  end if;
  if jsonb_array_length(p_value) > p_max_items then
    raise exception '% exceeds its item limit', p_path using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(p_value)
  loop
    if jsonb_typeof(item) <> 'string' or length(item #>> '{}') > p_max_length then
      raise exception '% entries must be bounded strings', p_path using errcode = '22023';
    end if;
  end loop;
end;
$function$;

create or replace function public.assert_portfolio_seo(
  p_value jsonb,
  p_path text,
  p_allow_pages boolean default false
)
returns void
language plpgsql
immutable
set search_path = ''
as $function$
declare
  page_name text;
  page_value jsonb;
begin
  perform public.assert_portfolio_object_keys(
    p_value,
    case when p_allow_pages
      then array['title','description','keywords','canonicalUrl','ogImage','noIndex','pages']
      else array['title','description','keywords','canonicalUrl','ogImage','noIndex']
    end,
    array[]::text[],
    p_path
  );
  perform public.assert_portfolio_field_types(
    p_value,
    array['title','description','canonicalUrl','ogImage'],
    array['noIndex'],
    array[]::text[],
    array['keywords'],
    case when p_allow_pages then array['pages'] else array[]::text[] end,
    p_path
  );
  if p_value ? 'keywords' then
    perform public.assert_portfolio_string_array(p_value -> 'keywords', p_path || '.keywords', 100, 100);
  end if;
  if not public.portfolio_safe_https_url(p_value ->> 'canonicalUrl', false, false) then
    raise exception '%.canonicalUrl must be an absolute HTTPS URL', p_path using errcode = '22023';
  end if;
  if not public.portfolio_safe_https_url(p_value ->> 'ogImage', false, true) then
    raise exception '%.ogImage must be an HTTPS URL or managed media token', p_path using errcode = '22023';
  end if;

  if p_allow_pages and p_value ? 'pages' then
    perform public.assert_portfolio_object_keys(
      p_value -> 'pages',
      array['home','graphic','webdev','about'],
      array[]::text[],
      p_path || '.pages'
    );
    for page_name, page_value in select key, value from jsonb_each(p_value -> 'pages')
    loop
      perform public.assert_portfolio_seo(page_value, p_path || '.pages.' || page_name, false);
    end loop;
  end if;
end;
$function$;

create or replace function public.assert_portfolio_gallery(
  p_value jsonb,
  p_parent_id text,
  p_path text
)
returns void
language plpgsql
immutable
set search_path = ''
as $function$
declare
  item jsonb;
  item_index bigint;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'array' then
    raise exception '% must be an array', p_path using errcode = '22023';
  end if;
  if jsonb_array_length(p_value) > 100 then
    raise exception '% exceeds 100 images', p_path using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_value) image
    group by image ->> 'id' having count(*) > 1
  ) then
    raise exception '% contains a duplicate image id', p_path using errcode = '22023';
  end if;

  for item, item_index in
    select value, ordinality - 1 from jsonb_array_elements(p_value) with ordinality
  loop
    perform public.assert_portfolio_object_keys(
      item,
      array['id','project_id','image_url','caption','alt_text','sort_order','created_at','updated_at'],
      array['id','project_id','image_url','sort_order'],
      p_path || '[' || item_index::text || ']'
    );
    perform public.assert_portfolio_field_types(
      item,
      array['id','project_id','image_url','caption','alt_text','created_at','updated_at'],
      array[]::text[], array['sort_order'], array[]::text[], array[]::text[],
      p_path || '[' || item_index::text || ']'
    );
    if btrim(item ->> 'id') = '' or length(item ->> 'id') > 200 then
      raise exception '% has an invalid image id', p_path using errcode = '22023';
    end if;
    if not public.portfolio_safe_identifier(item ->> 'id') then
      raise exception '% has a path-unsafe image id', p_path using errcode = '22023';
    end if;
    if not public.portfolio_safe_identifier(item ->> 'project_id')
       or item ->> 'project_id' <> p_parent_id then
      raise exception '% contains an image linked to a different project', p_path using errcode = '23503';
    end if;
    if not public.portfolio_safe_https_url(item ->> 'image_url', false, true) then
      raise exception '% contains an unsafe image URL', p_path using errcode = '22023';
    end if;
    if length(coalesce(item ->> 'alt_text','')) > 500
       or (nullif(item ->> 'image_url','') is not null and btrim(coalesce(item ->> 'alt_text','')) = '') then
      raise exception '% requires bounded alternative text for every image', p_path using errcode = '22023';
    end if;
    if (item ->> 'sort_order')::numeric <> trunc((item ->> 'sort_order')::numeric)
       or (item ->> 'sort_order')::numeric not between 0 and 1000000 then
      raise exception '% contains an invalid image sort_order', p_path using errcode = '22023';
    end if;
  end loop;
end;
$function$;

-- This replaces the permissive v1 validator. It accepts only the normalized
-- CMS contract, rejects private/prototype fields recursively, validates all URL
-- sinks, and resolves relationships to one exact canonical record.
create or replace function public.validate_portfolio_content(p_content jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  schema_version integer;
  canonical_content jsonb;
  side_name text;
  side_value jsonb;
  item jsonb;
  item_index bigint;
  case_key text;
  case_value jsonb;
  case_count integer;
  known_ids text[];
  known_slugs text[];
  category_matches integer;
  work_matches integer;
  fact jsonb;
  fact_index bigint;
  collection_name text;
  global_work_aliases text[] := array[]::text[];
  case_aliases text[] := array[]::text[];
  current_case_aliases text[];
  candidate_alias text;
begin
  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception 'Portfolio content must be a JSON object' using errcode = '22023';
  end if;
  if octet_length(p_content::text) > 2097152 then
    raise exception 'Portfolio content exceeds the 2 MiB document limit' using errcode = '22023';
  end if;

  perform public.assert_portfolio_no_forbidden_keys(p_content, '$');
  perform public.assert_portfolio_object_keys(
    p_content,
    array['schemaVersion','schema_version','publicEnabled','site','studios','services','projects','works','cases','techStack','integrations'],
    array['site','studios','services','projects','works','cases'],
    '$'
  );
  if p_content ? 'schemaVersion' and p_content ? 'schema_version' then
    raise exception 'Use only schemaVersion; duplicate version fields are ambiguous' using errcode = '22023';
  end if;
  schema_version := public.portfolio_content_schema_version(p_content);
  if schema_version <> 1 then
    raise exception 'Unsupported portfolio schema version %', schema_version using errcode = '22023';
  end if;
  if p_content ? 'publicEnabled' and jsonb_typeof(p_content -> 'publicEnabled') <> 'boolean' then
    raise exception '$.publicEnabled must be a boolean' using errcode = '22023';
  end if;

  perform public.assert_portfolio_object_keys(
    p_content -> 'site',
    array['brandName','logoMark','trademark','contactEmail','metaTitle','metaDescription','contact','navigation','socialLinks','footer','seo'],
    array['navigation','socialLinks'],
    '$.site'
  );
  perform public.assert_portfolio_field_types(
    p_content -> 'site',
    array['brandName','logoMark','trademark','contactEmail','metaTitle','metaDescription'],
    array[]::text[], array[]::text[], array['navigation','socialLinks'],
    array['contact','footer','seo'], '$.site'
  );

  foreach collection_name in array array['navigation','socialLinks']
  loop
    if jsonb_array_length(p_content #> array['site',collection_name]) > 100 then
      raise exception '$.site.% exceeds 100 records', collection_name using errcode = '22023';
    end if;
    known_ids := array[]::text[];
    for item, item_index in
      select value, ordinality - 1
      from jsonb_array_elements(p_content #> array['site',collection_name]) with ordinality
    loop
      perform public.assert_portfolio_object_keys(
        item, array['id','label','target','url','is_visible','order'],
        array['id','label','is_visible','order'], '$.site.' || collection_name || '[' || item_index::text || ']'
      );
      perform public.assert_portfolio_field_types(
        item, array['id','label','target','url'], array['is_visible'], array['order'],
        array[]::text[], array[]::text[], '$.site.' || collection_name || '[' || item_index::text || ']'
      );
      if btrim(item ->> 'id') = '' or item ->> 'id' = any(known_ids) then
        raise exception '$.site.% contains a blank or duplicate id', collection_name using errcode = '23505';
      end if;
      -- Navigation IDs are record keys, not nested case routes (for example, about).
      if coalesce(item ->> 'id', '') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$' or btrim(item ->> 'label') = '' then
        raise exception '$.site.% contains an unsafe id or blank label', collection_name using errcode = '22023';
      end if;
      if (item ->> 'order')::numeric <> trunc((item ->> 'order')::numeric)
         or (item ->> 'order')::numeric not between 0 and 1000000 then
        raise exception '$.site.%[%].order must be a bounded integer', collection_name, item_index using errcode = '22023';
      end if;
      known_ids := array_append(known_ids, item ->> 'id');
      if not public.portfolio_safe_https_url(item ->> 'url', true, false) then
        raise exception '$.site.%[%].url is unsafe', collection_name, item_index using errcode = '22023';
      end if;
    end loop;
  end loop;

  if p_content #> '{site,contact}' is not null then
    perform public.assert_portfolio_object_keys(
      p_content #> '{site,contact}', array['email','phone','location'], array[]::text[], '$.site.contact'
    );
    perform public.assert_portfolio_field_types(
      p_content #> '{site,contact}', array['email','phone','location'],
      array[]::text[], array[]::text[], array[]::text[], array[]::text[], '$.site.contact'
    );
  end if;
  if not public.portfolio_safe_email(p_content #>> '{site,contactEmail}')
     or not public.portfolio_safe_email(p_content #>> '{site,contact,email}') then
    raise exception 'Portfolio contact email is malformed' using errcode = '22023';
  end if;
  if p_content #> '{site,footer}' is not null then
    perform public.assert_portfolio_object_keys(
      p_content #> '{site,footer}', array['eyebrow','tagline','contactLabel','copyright'], array[]::text[], '$.site.footer'
    );
    perform public.assert_portfolio_field_types(
      p_content #> '{site,footer}', array['eyebrow','tagline','contactLabel','copyright'],
      array[]::text[], array[]::text[], array[]::text[], array[]::text[], '$.site.footer'
    );
  end if;
  if p_content #> '{site,seo}' is not null then
    perform public.assert_portfolio_seo(p_content #> '{site,seo}', '$.site.seo', true);
  end if;

  for side_name, side_value in
    select key, value from jsonb_each(p_content -> 'studios')
  loop
    if side_name not in ('graphic','webdev') then
      raise exception 'Unknown studio side %', side_name using errcode = '22023';
    end if;
    perform public.assert_portfolio_object_keys(
      side_value,
      array[
        'heroEyebrow','heroTitleTop','heroTitleEm','heroTitleSuffix','heroSub','heroCta','heroHoverLabel','heroStats',
        'pageEyebrow','pageTitlePre','pageTitleEm','pageTitlePost','pageTitleSecond','pageLede','pageStats',
        'backLabel','crumbLabel','stackLabel','servicesTitle','servicesSubtitle','categoryCrumbLabel','allServicesLabel',
        'workCtaLabel','projectCtaLabel','loadMoreLabel','showTechStack','showServices','showPortfolio','showAbout',
        'portfolioTitle','portfolioMeta','servicesMeta','aboutEyebrow','aboutTitle','aboutLead','aboutBody','aboutPillars'
      ],
      array[]::text[], '$.studios.' || side_name
    );
    perform public.assert_portfolio_field_types(
      side_value,
      array[
        'heroEyebrow','heroTitleTop','heroTitleEm','heroTitleSuffix','heroSub','heroCta','heroHoverLabel',
        'pageEyebrow','pageTitlePre','pageTitleEm','pageTitlePost','pageTitleSecond','pageLede','backLabel','crumbLabel',
        'stackLabel','servicesTitle','servicesSubtitle','categoryCrumbLabel','allServicesLabel','workCtaLabel',
        'projectCtaLabel','loadMoreLabel','portfolioTitle','portfolioMeta','servicesMeta','aboutEyebrow','aboutTitle',
        'aboutLead','aboutBody'
      ],
      array['showTechStack','showServices','showPortfolio','showAbout'], array[]::text[],
      array['heroStats','pageStats','aboutPillars'], array[]::text[], '$.studios.' || side_name
    );
    if side_value ? 'aboutPillars' then
      perform public.assert_portfolio_string_array(side_value -> 'aboutPillars', '$.studios.' || side_name || '.aboutPillars', 20, 300);
    end if;
    for fact_index in 1..2 loop
      if side_value ? (case when fact_index = 1 then 'heroStats' else 'pageStats' end) then
        if jsonb_array_length(side_value -> (case when fact_index = 1 then 'heroStats' else 'pageStats' end)) > 12 then
          raise exception '$.studios.% stats exceed 12 entries', side_name using errcode = '22023';
        end if;
        for fact in select value from jsonb_array_elements(
          side_value -> (case when fact_index = 1 then 'heroStats' else 'pageStats' end)
        )
        loop
          perform public.assert_portfolio_object_keys(fact, array['value','suffix','label'], array['value','suffix','label'], '$.studios.stats');
          perform public.assert_portfolio_field_types(fact, array['value','suffix','label'], array[]::text[], array[]::text[], array[]::text[], array[]::text[], '$.studios.stats');
          if length(fact ->> 'value') > 100 or length(fact ->> 'suffix') > 50
             or length(fact ->> 'label') > 200 or btrim(fact ->> 'label') = '' then
            raise exception '$.studios.% contains an invalid stat', side_name using errcode = '22023';
          end if;
        end loop;
      end if;
    end loop;
  end loop;
  perform public.assert_portfolio_object_keys(p_content -> 'studios', array['graphic','webdev'], array['graphic','webdev'], '$.studios');

  foreach side_name in array array['graphic','webdev']
  loop
    perform public.assert_portfolio_object_keys(p_content -> 'services', array['graphic','webdev'], array['graphic','webdev'], '$.services');
    if jsonb_typeof(p_content #> array['services',side_name]) <> 'array'
       or jsonb_array_length(p_content #> array['services',side_name]) > 250 then
      raise exception '$.services.% must be an array with at most 250 records', side_name using errcode = '22023';
    end if;
    known_ids := array[]::text[];
    known_slugs := array[]::text[];
    for item, item_index in
      select value, ordinality - 1 from jsonb_array_elements(p_content #> array['services',side_name]) with ordinality
    loop
      perform public.assert_portfolio_object_keys(
        item,
        array['id','name','title','slug','icon','icon_url','thumb','short_description','shortDescription','desc','order','num','is_active','created_at','updated_at'],
        array['id','name','title','slug','order','is_active'], '$.services.' || side_name || '[' || item_index::text || ']'
      );
      perform public.assert_portfolio_field_types(
        item, array['id','name','title','slug','icon_url','thumb','short_description','shortDescription','desc','num','created_at','updated_at'],
        array['is_active'], array['icon','order'], array[]::text[], array[]::text[], '$.services.' || side_name || '[' || item_index::text || ']'
      );
      if not public.portfolio_safe_identifier(item ->> 'id')
         or not public.portfolio_safe_identifier(item ->> 'slug')
         or btrim(item ->> 'name') = '' or btrim(item ->> 'title') = '' then
        raise exception '$.services.% contains an invalid id/slug or blank title', side_name using errcode = '22023';
      end if;
      if item ->> 'id' = any(known_ids) or item ->> 'id' = any(known_slugs)
         or item ->> 'slug' = any(known_ids) or item ->> 'slug' = any(known_slugs) then
        raise exception '$.services.% contains a duplicate or cross-alias id/slug', side_name using errcode = '23505';
      end if;
      if (item ->> 'order')::numeric <> trunc((item ->> 'order')::numeric)
         or (item ->> 'order')::numeric not between 0 and 1000000
         or (item ->> 'icon')::numeric <> trunc((item ->> 'icon')::numeric)
         or (item ->> 'icon')::numeric not between 0 and 1000 then
        raise exception '$.services.% has an out-of-range order or icon', side_name using errcode = '22023';
      end if;
      known_ids := array_append(known_ids, item ->> 'id');
      known_slugs := array_append(known_slugs, item ->> 'slug');
      if not public.portfolio_safe_https_url(item ->> 'icon_url', false, true) then
        raise exception '$.services.% contains an unsafe icon URL', side_name using errcode = '22023';
      end if;
    end loop;

    perform public.assert_portfolio_object_keys(p_content -> 'projects', array['graphic','webdev'], array['graphic','webdev'], '$.projects');
    if jsonb_typeof(p_content #> array['projects',side_name]) <> 'array'
       or jsonb_array_length(p_content #> array['projects',side_name]) > 2000 then
      raise exception '$.projects.% must be an array with at most 2000 records', side_name using errcode = '22023';
    end if;
    known_ids := array[]::text[];
    known_slugs := array[]::text[];
    for item, item_index in
      select value, ordinality - 1 from jsonb_array_elements(p_content #> array['projects',side_name]) with ordinality
    loop
      perform public.assert_portfolio_object_keys(
        item,
        array[
          'id','category_id','categoryId','category_slug','title','slug','short_description','shortDescription','desc',
          'full_description','fullDescription','description','image_url','image','gallery_images','tags','client_name',
          'clientName','project_date','projectDate','year','stack','is_featured','is_published','sort_order','thumb','pal',
          'cover_alt','num','created_at','updated_at'
        ],
        array['id','category_id','title','slug','gallery_images','is_featured','is_published','sort_order'],
        '$.projects.' || side_name || '[' || item_index::text || ']'
      );
      perform public.assert_portfolio_field_types(
        item,
        array[
          'id','category_id','categoryId','category_slug','title','slug','short_description','shortDescription','desc',
          'full_description','fullDescription','description','image_url','image','client_name','clientName','project_date',
          'projectDate','year','stack','thumb','cover_alt','num','created_at','updated_at'
        ],
        array['is_featured','is_published'], array['sort_order','pal'], array['gallery_images','tags'], array[]::text[],
        '$.projects.' || side_name || '[' || item_index::text || ']'
      );
      if not public.portfolio_safe_identifier(item ->> 'id')
         or not public.portfolio_safe_identifier(item ->> 'slug')
         or not public.portfolio_safe_identifier(item ->> 'category_id')
         or btrim(item ->> 'title') = '' then
        raise exception '$.projects.% contains an unsafe identity/category or blank title', side_name using errcode = '22023';
      end if;
      if item ->> 'id' = any(known_ids) or item ->> 'id' = any(known_slugs)
         or item ->> 'slug' = any(known_ids) or item ->> 'slug' = any(known_slugs) then
        raise exception '$.projects.% contains a duplicate or cross-alias id/slug', side_name using errcode = '23505';
      end if;
      if (item ->> 'sort_order')::numeric <> trunc((item ->> 'sort_order')::numeric)
         or (item ->> 'sort_order')::numeric not between 0 and 1000000
         or (item ->> 'pal') is not null and (
           (item ->> 'pal')::numeric <> trunc((item ->> 'pal')::numeric)
           or (item ->> 'pal')::numeric not between 0 and 99
         ) then
        raise exception '$.projects.% has an out-of-range sort order or palette', side_name using errcode = '22023';
      end if;
      known_ids := array_append(known_ids, item ->> 'id');
      known_slugs := array_append(known_slugs, item ->> 'slug');
      select count(*) into category_matches
      from jsonb_array_elements(p_content #> array['services',side_name]) service
      where item ->> 'category_id' in (service ->> 'id', service ->> 'slug');
      if category_matches <> 1 then
        raise exception '$.projects.%[%].category_id must resolve to exactly one service', side_name, item_index using errcode = '23503';
      end if;
      if not public.portfolio_safe_https_url(item ->> 'image_url', false, true)
         or not public.portfolio_safe_https_url(item ->> 'image', false, true) then
        raise exception '$.projects.%[%] contains an unsafe cover URL', side_name, item_index using errcode = '22023';
      end if;
      if length(coalesce(item ->> 'cover_alt','')) > 500
         or (
           nullif(coalesce(nullif(item ->> 'image_url',''), item ->> 'image'),'') is not null
           and btrim(coalesce(item ->> 'cover_alt','')) = ''
         ) then
        raise exception '$.projects.%[%] requires bounded alternative text for its cover', side_name, item_index using errcode = '22023';
      end if;
      perform public.assert_portfolio_gallery(item -> 'gallery_images', item ->> 'id', '$.projects.' || side_name || '[' || item_index::text || '].gallery_images');
      if item ? 'tags' then perform public.assert_portfolio_string_array(item -> 'tags', '$.projects.tags', 100, 200); end if;
    end loop;

    perform public.assert_portfolio_object_keys(p_content -> 'works', array['graphic','webdev'], array['graphic','webdev'], '$.works');
    if jsonb_typeof(p_content #> array['works',side_name]) <> 'array'
       or jsonb_array_length(p_content #> array['works',side_name]) > 1000 then
      raise exception '$.works.% must be an array with at most 1000 records', side_name using errcode = '22023';
    end if;
    known_ids := array[]::text[];
    known_slugs := array[]::text[];
    for item, item_index in
      select value, ordinality - 1 from jsonb_array_elements(p_content #> array['works',side_name]) with ordinality
    loop
      perform public.assert_portfolio_object_keys(
        item,
        array[
          'id','title','slug','category_id','cat','category','cover_image_url','image','short_description','shortDescription','desc',
          'full_description','fullDescription','client_name','clientName','year','stack','is_featured','is_published','sort_order',
          'gallery_images','tags','thumb','pal','span','num','cover_alt','num','created_at','updated_at'
        ],
        array['id','title','slug','category_id','is_featured','is_published','sort_order','gallery_images'],
        '$.works.' || side_name || '[' || item_index::text || ']'
      );
      perform public.assert_portfolio_field_types(
        item,
        array[
          'id','title','slug','category_id','cat','category','cover_image_url','image','short_description','shortDescription','desc',
          'full_description','fullDescription','client_name','clientName','year','stack','thumb','num','cover_alt','num','created_at','updated_at'
        ],
        array['is_featured','is_published'], array['sort_order','pal','span'], array['gallery_images','tags'], array[]::text[],
        '$.works.' || side_name || '[' || item_index::text || ']'
      );
      if not public.portfolio_safe_identifier(item ->> 'id')
         or not public.portfolio_safe_identifier(item ->> 'slug')
         or not public.portfolio_safe_identifier(item ->> 'category_id')
         or btrim(item ->> 'title') = '' then
        raise exception '$.works.% contains an unsafe identity/category or blank title', side_name using errcode = '22023';
      end if;
      if item ->> 'id' = any(known_ids) or item ->> 'id' = any(known_slugs)
         or item ->> 'slug' = any(known_ids) or item ->> 'slug' = any(known_slugs)
         or item ->> 'id' = any(global_work_aliases) or item ->> 'slug' = any(global_work_aliases) then
        raise exception '$.works.% contains a duplicate or cross-alias id/slug', side_name using errcode = '23505';
      end if;
      known_ids := array_append(known_ids, item ->> 'id');
      known_slugs := array_append(known_slugs, item ->> 'slug');
      global_work_aliases := array_append(global_work_aliases, item ->> 'id');
      if item ->> 'slug' <> item ->> 'id' then
        global_work_aliases := array_append(global_work_aliases, item ->> 'slug');
      end if;
      select count(*) into category_matches
      from jsonb_array_elements(p_content #> array['services',side_name]) service
      where item ->> 'category_id' in (service ->> 'id', service ->> 'slug');
      if category_matches <> 1 then
        raise exception '$.works.%[%].category_id must resolve to exactly one service', side_name, item_index using errcode = '23503';
      end if;
      if (item ->> 'sort_order')::numeric <> trunc((item ->> 'sort_order')::numeric)
         or (item ->> 'sort_order')::numeric not between 0 and 1000000
         or (item ->> 'pal') is not null and (
           (item ->> 'pal')::numeric <> trunc((item ->> 'pal')::numeric)
           or (item ->> 'pal')::numeric not between 0 and 99
         )
         or (item ->> 'span') is not null and (
           (item ->> 'span')::numeric <> trunc((item ->> 'span')::numeric)
           or (item ->> 'span')::numeric not between 1 and 12
         ) then
        raise exception '$.works.% has an out-of-range sort, palette, or span', side_name using errcode = '22023';
      end if;
      if not public.portfolio_safe_https_url(item ->> 'cover_image_url', false, true)
         or not public.portfolio_safe_https_url(item ->> 'image', false, true) then
        raise exception '$.works.%[%] contains an unsafe cover URL', side_name, item_index using errcode = '22023';
      end if;
      if length(coalesce(item ->> 'cover_alt','')) > 500
         or (
           nullif(coalesce(nullif(item ->> 'cover_image_url',''), item ->> 'image'),'') is not null
           and btrim(coalesce(item ->> 'cover_alt','')) = ''
         ) then
        raise exception '$.works.%[%] requires bounded alternative text for its cover', side_name, item_index using errcode = '22023';
      end if;
      perform public.assert_portfolio_gallery(item -> 'gallery_images', item ->> 'id', '$.works.' || side_name || '[' || item_index::text || '].gallery_images');
      if item ? 'tags' then perform public.assert_portfolio_string_array(item -> 'tags', '$.works.tags', 100, 200); end if;
    end loop;
  end loop;

  if p_content ? 'techStack' then
    perform public.assert_portfolio_string_array(p_content -> 'techStack', '$.techStack', 200, 100);
  end if;
  if p_content ? 'integrations' then
    perform public.assert_portfolio_object_keys(p_content -> 'integrations', array['github'], array[]::text[], '$.integrations');
    if p_content #> '{integrations,github}' is not null then
      perform public.assert_portfolio_object_keys(
        p_content #> '{integrations,github}', array['enabled','username','eyebrow','title','linkLabel','limit'], array[]::text[], '$.integrations.github'
      );
      perform public.assert_portfolio_field_types(
        p_content #> '{integrations,github}', array['username','eyebrow','title','linkLabel'], array['enabled'], array['limit'],
        array[]::text[], array[]::text[], '$.integrations.github'
      );
      if (p_content #>> '{integrations,github,limit}') is not null and (
        (p_content #>> '{integrations,github,limit}')::numeric <> trunc((p_content #>> '{integrations,github,limit}')::numeric)
        or (p_content #>> '{integrations,github,limit}')::numeric not between 1 and 100
      ) then
        raise exception '$.integrations.github.limit must be an integer from 1 to 100' using errcode = '22023';
      end if;
    end if;
  end if;

  select count(*) into case_count from jsonb_object_keys(p_content -> 'cases');
  if case_count > 2000 then
    raise exception '$.cases exceeds 2000 records' using errcode = '22023';
  end if;
  known_ids := array[]::text[];
  for case_key, case_value in select key, value from jsonb_each(p_content -> 'cases')
  loop
    current_case_aliases := array[]::text[];
    if not public.portfolio_safe_identifier(case_key) then
      raise exception '$.cases has an invalid route key' using errcode = '22023';
    end if;
    perform public.assert_portfolio_object_keys(
      case_value,
      array[
        'id','slug','project_id','side','is_published','title','eyebrow','pal','thumb','num','cover_image_url','image','cover_alt',
        'client_name','year','short_description','full_description','gallery_images','side_info','challenge','pull','process','tools','results','seo','created_at','updated_at'
      ],
      array['project_id','side','title'], '$.cases.' || case_key
    );
    perform public.assert_portfolio_field_types(
      case_value,
      array[
        'id','slug','project_id','side','title','eyebrow','thumb','num','cover_image_url','image','cover_alt','client_name','year',
        'short_description','full_description','challenge','pull','process','tools','created_at','updated_at'
      ],
      array['is_published'], array['pal'], array['gallery_images','side_info','results'], array['seo'], '$.cases.' || case_key
    );
    if case_value ->> 'side' not in ('graphic','webdev')
       or not public.portfolio_safe_identifier(case_value ->> 'project_id')
       or btrim(case_value ->> 'title') = '' then
      raise exception '$.cases.% has an invalid canonical side/project relationship', case_key using errcode = '23503';
    end if;
    foreach candidate_alias in array array[
      case_key,
      nullif(case_value ->> 'id',''),
      nullif(case_value ->> 'slug','')
    ]
    loop
      if candidate_alias is null then continue; end if;
      if not public.portfolio_safe_identifier(candidate_alias) then
        raise exception '$.cases.% contains a path-unsafe id/slug alias', case_key using errcode = '22023';
      end if;
      if candidate_alias = any(case_aliases) then
        raise exception '$.cases contains an ambiguous route alias %', candidate_alias using errcode = '23505';
      end if;
      if exists (
        select 1
        from (
          select value as work_value from jsonb_array_elements(p_content #> '{works,graphic}')
          union all
          select value as work_value from jsonb_array_elements(p_content #> '{works,webdev}')
        ) all_works
        where candidate_alias in (all_works.work_value ->> 'id', all_works.work_value ->> 'slug')
          and all_works.work_value ->> 'id' <> case_value ->> 'project_id'
      ) then
        raise exception '$.cases.% alias % conflicts with a different work route', case_key, candidate_alias
          using errcode = '23505';
      end if;
      if not (candidate_alias = any(current_case_aliases)) then
        current_case_aliases := array_append(current_case_aliases, candidate_alias);
      end if;
    end loop;
    case_aliases := array_cat(case_aliases, current_case_aliases);
    select count(*) into work_matches
    from jsonb_array_elements(p_content #> array['works',case_value ->> 'side']) work
    where work ->> 'id' = case_value ->> 'project_id';
    if work_matches <> 1 then
      raise exception '$.cases.%.project_id must resolve to exactly one work on the declared side', case_key using errcode = '23503';
    end if;
    if case_value ->> 'project_id' = any(known_ids) then
      raise exception 'Only one case may link to work %', case_value ->> 'project_id' using errcode = '23505';
    end if;
    known_ids := array_append(known_ids, case_value ->> 'project_id');
    if not public.portfolio_safe_https_url(case_value ->> 'cover_image_url', false, true)
       or not public.portfolio_safe_https_url(case_value ->> 'image', false, true) then
      raise exception '$.cases.% contains an unsafe cover URL', case_key using errcode = '22023';
    end if;
    if length(coalesce(case_value ->> 'cover_alt','')) > 500
       or (
         nullif(coalesce(nullif(case_value ->> 'cover_image_url',''), case_value ->> 'image'),'') is not null
         and btrim(coalesce(case_value ->> 'cover_alt','')) = ''
       ) then
      raise exception '$.cases.% requires bounded alternative text for its cover', case_key using errcode = '22023';
    end if;
    if (case_value ->> 'pal') is not null and (
      (case_value ->> 'pal')::numeric <> trunc((case_value ->> 'pal')::numeric)
      or (case_value ->> 'pal')::numeric not between 0 and 99
    ) then
      raise exception '$.cases.% has an out-of-range palette', case_key using errcode = '22023';
    end if;
    if case_value ? 'seo' then perform public.assert_portfolio_seo(case_value -> 'seo', '$.cases.' || case_key || '.seo', false); end if;
    if case_value ? 'gallery_images' then perform public.assert_portfolio_gallery(case_value -> 'gallery_images', case_value ->> 'project_id', '$.cases.' || case_key || '.gallery_images'); end if;
    if case_value ? 'side_info' then
      if jsonb_array_length(case_value -> 'side_info') > 100 then raise exception '$.cases.%.side_info is too large', case_key using errcode = '22023'; end if;
      for fact, fact_index in select value, ordinality - 1 from jsonb_array_elements(case_value -> 'side_info') with ordinality
      loop
        if jsonb_typeof(fact) <> 'array' or jsonb_array_length(fact) <> 2
           or exists (select 1 from jsonb_array_elements(fact) v where jsonb_typeof(v) <> 'string') then
          raise exception '$.cases.%.side_info[%] must contain two strings', case_key, fact_index using errcode = '22023';
        end if;
      end loop;
    end if;
    if case_value ? 'results' then
      if jsonb_array_length(case_value -> 'results') > 100 then raise exception '$.cases.%.results is too large', case_key using errcode = '22023'; end if;
      for fact, fact_index in select value, ordinality - 1 from jsonb_array_elements(case_value -> 'results') with ordinality
      loop
        if jsonb_typeof(fact) <> 'array' or jsonb_array_length(fact) <> 3
           or exists (select 1 from jsonb_array_elements(fact) v where jsonb_typeof(v) <> 'string') then
          raise exception '$.cases.%.results[%] must contain three strings', case_key, fact_index using errcode = '22023';
        end if;
      end loop;
    end if;
  end loop;

  -- publicEnabled is authoritative database state and is never accepted as
  -- content data. schema_version is a one-way legacy input alias.
  canonical_content := (p_content - 'schema_version' - 'publicEnabled')
    || jsonb_build_object('schemaVersion', schema_version);
  return canonical_content;
end;
$function$;

-- Public projection uses an explicit root allowlist and exact canonical case
-- relationship. A hidden case cannot survive because both its own flag and its
-- linked work's flag are tested before it is aggregated.
create or replace function public.sanitize_published_portfolio(p_content jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  clean jsonb;
  visible_cases jsonb;
begin
  if p_content is null or p_content = '{}'::jsonb then return '{}'::jsonb; end if;

  clean := jsonb_build_object(
    'schemaVersion', 1,
    'site', jsonb_build_object(
      'brandName', p_content #> '{site,brandName}',
      'logoMark', p_content #> '{site,logoMark}',
      'trademark', p_content #> '{site,trademark}',
      'contactEmail', p_content #> '{site,contactEmail}',
      'metaTitle', p_content #> '{site,metaTitle}',
      'metaDescription', p_content #> '{site,metaDescription}',
      'contact', coalesce(p_content #> '{site,contact}', '{}'::jsonb),
      'footer', coalesce(p_content #> '{site,footer}', '{}'::jsonb),
      'seo', coalesce(p_content #> '{site,seo}', '{}'::jsonb),
      'navigation', public.filter_portfolio_record_array(p_content #> '{site,navigation}', 'is_visible'),
      'socialLinks', public.filter_portfolio_record_array(p_content #> '{site,socialLinks}', 'is_visible')
    ),
    'studios', jsonb_build_object(
      'graphic', coalesce(p_content #> '{studios,graphic}', '{}'::jsonb),
      'webdev', coalesce(p_content #> '{studios,webdev}', '{}'::jsonb)
    ),
    'services', jsonb_build_object(
      'graphic', public.filter_portfolio_record_array(p_content #> '{services,graphic}', 'is_active'),
      'webdev', public.filter_portfolio_record_array(p_content #> '{services,webdev}', 'is_active')
    ),
    'projects', jsonb_build_object(
      'graphic', public.filter_portfolio_record_array(p_content #> '{projects,graphic}', 'is_published'),
      'webdev', public.filter_portfolio_record_array(p_content #> '{projects,webdev}', 'is_published')
    ),
    'works', jsonb_build_object(
      'graphic', public.filter_portfolio_record_array(p_content #> '{works,graphic}', 'is_published'),
      'webdev', public.filter_portfolio_record_array(p_content #> '{works,webdev}', 'is_published')
    ),
    'techStack', coalesce(p_content -> 'techStack', '[]'::jsonb),
    'integrations', coalesce(p_content -> 'integrations', '{}'::jsonb),
    'cases', '{}'::jsonb
  );

  select coalesce(jsonb_object_agg(case_row.key, case_row.value), '{}'::jsonb)
  into visible_cases
  from jsonb_each(coalesce(p_content -> 'cases', '{}'::jsonb)) case_row
  where coalesce((case_row.value ->> 'is_published')::boolean, true)
    and exists (
      select 1
      from jsonb_array_elements(clean #> array['works', case_row.value ->> 'side']) work
      where work ->> 'id' = case_row.value ->> 'project_id'
        and coalesce((work ->> 'is_published')::boolean, true)
    );

  return jsonb_set(clean, '{cases}', visible_cases, true);
end;
$function$;

-- Forward-only copy reconciliation. Migration 002 stays immutable; live values
-- and explicit JSON nulls win, and an unused `{}` singleton remains pristine.
create or replace function public.portfolio_fill_missing_studio_defaults(p_content jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  result jsonb := p_content;
  side_name text;
  key_name text;
  default_value jsonb;
  defaults jsonb := jsonb_build_object(
    'graphic', jsonb_build_object(
      'heroHoverLabel','Explore Graphic Design',
      'backLabel','Back to hero',
      'crumbLabel','Index / Studio A - Graphic Design',
      'servicesTitle','Services',
      'servicesSubtitle','/ ten disciplines',
      'categoryCrumbLabel','Services',
      'allServicesLabel','All services',
      'workCtaLabel','View case',
      'projectCtaLabel','View details',
      'loadMoreLabel','Load more',
      'showServices',true,
      'showPortfolio',true,
      'showAbout',true
    ),
    'webdev', jsonb_build_object(
      'heroHoverLabel','Explore Software Development',
      'backLabel','Back to hero',
      'crumbLabel','Index / Studio B - Software Development',
      'stackLabel','Stack -',
      'servicesTitle','Services',
      'servicesSubtitle','/ ten disciplines',
      'categoryCrumbLabel','Services',
      'allServicesLabel','All services',
      'workCtaLabel','View build',
      'projectCtaLabel','View details',
      'loadMoreLabel','Load more',
      'showTechStack',true,
      'showServices',true,
      'showPortfolio',true,
      'showAbout',true
    )
  );
begin
  if result is null or result = '{}'::jsonb then return result; end if;
  foreach side_name in array array['graphic','webdev']
  loop
    if jsonb_typeof(result #> array['studios',side_name]) <> 'object' then continue; end if;
    for key_name, default_value in select key, value from jsonb_each(defaults -> side_name)
    loop
      -- `#>` returns SQL NULL only for a missing path; JSON null is preserved.
      if result #> array['studios',side_name,key_name] is null then
        result := jsonb_set(result, array['studios',side_name,key_name], default_value, true);
      end if;
    end loop;
  end loop;
  return result;
end;
$function$;

-- Pre-005 clients derived selected-work category_id from display copy. Repair
-- only relationships that do not already resolve to exactly one side-local
-- service; deterministic ordinal fallback preserves every work record.
create or replace function public.portfolio_repair_work_categories(p_content jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  result jsonb := p_content;
  side_name text;
  work_value jsonb;
  work_index bigint;
  service_count integer;
  match_count integer;
  fallback_alias text;
  fallback_id text;
begin
  if result is null or result = '{}'::jsonb then return result; end if;
  foreach side_name in array array['graphic','webdev']
  loop
    if jsonb_typeof(result #> array['services',side_name]) <> 'array'
       or jsonb_typeof(result #> array['works',side_name]) <> 'array' then
      continue;
    end if;
    service_count := jsonb_array_length(result #> array['services',side_name]);
    if service_count < 1 then continue; end if;
    for work_value, work_index in
      select value, ordinality - 1
      from jsonb_array_elements(result #> array['works',side_name]) with ordinality
    loop
      select count(*) into match_count
      from jsonb_array_elements(result #> array['services',side_name]) service
      where work_value ->> 'category_id' in (service ->> 'id', service ->> 'slug');
      if match_count <> 1 then
        fallback_alias := case side_name || ':' || coalesce(work_value ->> 'id','')
          when 'graphic:g1' then 'packaging-design'
          when 'graphic:g2' then 'poster-design'
          when 'graphic:g3' then 'vector-art'
          when 'graphic:g4' then 'business-cards'
          when 'graphic:g5' then 'social-media-posts'
          when 'graphic:g6' then 'poster-design'
          when 'webdev:w1' then 'software-development'
          when 'webdev:w2' then 'business-websites'
          when 'webdev:w3' then 'e-commerce'
          when 'webdev:w4' then 'backend'
          when 'webdev:w5' then 'portfolio-sites'
          when 'webdev:w6' then 'frontend'
          else null
        end;
        fallback_id := null;
        if fallback_alias is not null then
          select service ->> 'id' into fallback_id
          from jsonb_array_elements(result #> array['services',side_name]) service
          where fallback_alias in (service ->> 'id', service ->> 'slug')
          limit 1;
        end if;
        if fallback_id is null then
          select services.value ->> 'id' into fallback_id
          from jsonb_array_elements(result #> array['services',side_name])
            with ordinality as services(value, ordinal)
          where services.ordinal = mod(work_index, service_count) + 1;
        end if;
        result := jsonb_set(
          result,
          array['works',side_name,work_index::text,'category_id'],
          to_jsonb(fallback_id),
          true
        );
      end if;
    end loop;
  end loop;
  return result;
end;
$function$;

create or replace function public.portfolio_count_invalid_work_categories(p_content jsonb)
returns integer
language plpgsql
immutable
set search_path = ''
as $function$
declare
  result integer := 0;
  side_name text;
  work_value jsonb;
  match_count integer;
begin
  if p_content is null or p_content = '{}'::jsonb then return 0; end if;
  foreach side_name in array array['graphic','webdev']
  loop
    if jsonb_typeof(p_content #> array['services',side_name]) <> 'array'
       or jsonb_typeof(p_content #> array['works',side_name]) <> 'array' then
      continue;
    end if;
    for work_value in select value from jsonb_array_elements(p_content #> array['works',side_name])
    loop
      select count(*) into match_count
      from jsonb_array_elements(p_content #> array['services',side_name]) service
      where work_value ->> 'category_id' in (service ->> 'id', service ->> 'slug');
      if match_count <> 1 then result := result + 1; end if;
    end loop;
  end loop;
  return result;
end;
$function$;

do $reconcile$
declare
  current_row public.portfolio_content;
  next_draft jsonb;
  next_published jsonb;
  draft_changed boolean;
  published_changed boolean;
  next_draft_revision bigint;
  next_published_revision bigint;
  draft_category_repairs integer := 0;
  published_category_repairs integer := 0;
  changed_at timestamptz := now();
begin
  select * into current_row from public.portfolio_content where id = 1 for update;
  if not found then return; end if;
  if current_row.draft_json = '{}'::jsonb then
    next_draft := current_row.draft_json;
  else
    draft_category_repairs := public.portfolio_count_invalid_work_categories(current_row.draft_json);
    next_draft := public.validate_portfolio_content(
      public.portfolio_repair_work_categories(
        public.portfolio_fill_missing_studio_defaults(current_row.draft_json)
      )
    );
  end if;
  if current_row.published_json = '{}'::jsonb then
    next_published := current_row.published_json;
  else
    published_category_repairs := public.portfolio_count_invalid_work_categories(current_row.published_json);
    next_published := public.validate_portfolio_content(
      public.portfolio_repair_work_categories(
        public.portfolio_fill_missing_studio_defaults(current_row.published_json)
      )
    );
  end if;
  draft_changed := next_draft is distinct from current_row.draft_json;
  published_changed := next_published is distinct from current_row.published_json;
  if not draft_changed and not published_changed then return; end if;

  next_draft_revision := current_row.draft_revision + case when draft_changed then 1 else 0 end;
  next_published_revision := current_row.published_revision + case when published_changed then 1 else 0 end;
  update public.portfolio_content
  set draft_json = next_draft,
      published_json = next_published,
      draft_revision = next_draft_revision,
      published_revision = next_published_revision,
      updated_at = case when draft_changed then changed_at else updated_at end
  where id = 1;

  if draft_changed then
    insert into public.portfolio_revisions (revision,kind,content_json,created_by,created_at)
    values (next_draft_revision,'draft',next_draft,null,changed_at);
  end if;
  if published_changed then
    insert into public.portfolio_revisions (revision,kind,content_json,created_by,created_at)
    values (next_published_revision,'published',next_published,null,changed_at);
    insert into public.portfolio_publish_events (published_revision,created_at)
    values (next_published_revision,changed_at);
  end if;
  insert into public.portfolio_activity_log (actor_id,action,resource_type,resource_id,metadata,created_at)
  values (
    null,'migration.content_reconciled','portfolio','main',
    jsonb_build_object(
      'migration','202608040005','draft_changed',draft_changed,'published_changed',published_changed,
      'draft_revision',next_draft_revision,'published_revision',next_published_revision,
      'draft_work_category_repairs',draft_category_repairs,
      'published_work_category_repairs',published_category_repairs
    ),changed_at
  );
end
$reconcile$;

-- ---------------------------------------------------------------------------
-- Trusted media verification and immutable-object binding
-- ---------------------------------------------------------------------------

create or replace function public.portfolio_verified_source_is_current(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.portfolio_media_assets asset
    join storage.objects object
      on object.id = asset.verified_storage_object_id
     and object.bucket_id = asset.verified_staging_bucket
     and object.name = asset.verified_staging_path
    where asset.id = p_asset_id
      and asset.legacy_upload_id is null
      and asset.verified_at is not null
      and asset.verification_version = 1
      and asset.staging_bucket = asset.verified_staging_bucket
      and asset.staging_path = asset.verified_staging_path
      and asset.mime_type = asset.verified_mime_type
      and asset.byte_size = asset.verified_byte_size
      and asset.width = asset.verified_width
      and asset.height = asset.verified_height
      and object.updated_at is not distinct from asset.verified_storage_object_updated_at
      and lower(coalesce(object.metadata ->> 'mimetype', '')) = asset.verified_mime_type
      and coalesce(object.metadata ->> 'size', '') = asset.verified_byte_size::text
      and nullif(btrim(coalesce(object.metadata ->> 'eTag', object.metadata ->> 'etag', '')), '')
          = asset.verified_storage_object_etag
  );
$function$;

create or replace function public.portfolio_public_copy_matches_verification(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.portfolio_media_assets asset
    join storage.objects object
      on object.bucket_id = asset.public_bucket
     and object.name = asset.public_path
    where asset.id = p_asset_id
      and asset.public_bucket = 'portfolio-media-public'
      and asset.verified_at is not null
      and lower(coalesce(object.metadata ->> 'mimetype', '')) = asset.verified_mime_type
      and coalesce(object.metadata ->> 'size', '') = asset.verified_byte_size::text
      and nullif(btrim(coalesce(object.metadata ->> 'eTag', object.metadata ->> 'etag', '')), '')
          = asset.verified_storage_object_etag
  );
$function$;

create or replace function public.guard_portfolio_media_verified_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' and old.verified_at is not null and (
    new.verified_sha256,
    new.verified_mime_type,
    new.verified_byte_size,
    new.verified_width,
    new.verified_height,
    new.verified_frame_count,
    new.verified_total_pixels,
    new.verified_at,
    new.verification_version,
    new.verified_staging_bucket,
    new.verified_staging_path,
    new.verified_storage_object_id,
    new.verified_storage_object_updated_at,
    new.verified_storage_object_etag,
    new.staging_bucket,
    new.staging_path,
    new.mime_type,
    new.byte_size,
    new.width,
    new.height
  ) is distinct from (
    old.verified_sha256,
    old.verified_mime_type,
    old.verified_byte_size,
    old.verified_width,
    old.verified_height,
    old.verified_frame_count,
    old.verified_total_pixels,
    old.verified_at,
    old.verification_version,
    old.verified_staging_bucket,
    old.verified_staging_path,
    old.verified_storage_object_id,
    old.verified_storage_object_updated_at,
    old.verified_storage_object_etag,
    old.staging_bucket,
    old.staging_path,
    old.mime_type,
    old.byte_size,
    old.width,
    old.height
  ) then
    raise exception 'Verified media bindings are immutable' using errcode = '23514';
  end if;

  if new.legacy_upload_id is null
     and new.status in ('staged','promoting','published')
     and (
       tg_op = 'INSERT'
       or new.status is distinct from old.status
       or new.verified_at is distinct from old.verified_at
     ) then
    if new.verified_at is null
       or new.verification_version is distinct from 1
       or coalesce(new.verified_sha256,'') !~ '^[0-9a-f]{64}$'
       or new.verified_mime_type is distinct from new.mime_type
       or new.verified_byte_size is distinct from new.byte_size
       or new.verified_width is distinct from new.width
       or new.verified_height is distinct from new.height
       or new.verified_width is null
       or new.verified_height is null
       or new.verified_width not between 1 and 6000
       or new.verified_height not between 1 and 6000
       or new.verified_width::bigint * new.verified_height::bigint > 12000000
       or new.verified_frame_count is null
       or new.verified_frame_count not between 1 and 120
       or new.verified_total_pixels is null
       or new.verified_total_pixels < new.verified_width::bigint * new.verified_height::bigint
       or new.verified_total_pixels > 24000000
       or new.verified_staging_bucket is distinct from new.staging_bucket
       or new.verified_staging_path is distinct from new.staging_path then
      raise exception 'Trusted media verification is required before this state transition'
        using errcode = '23514';
    end if;
  end if;

  if new.legacy_upload_id is null
     and new.status in ('promoting','published')
     and new.status is distinct from old.status
     and not public.portfolio_verified_source_is_current(new.id) then
    raise exception 'The verified source object changed; verify it again before promotion'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

drop trigger if exists portfolio_media_verified_transition_trigger
  on public.portfolio_media_assets;
create trigger portfolio_media_verified_transition_trigger
before insert or update on public.portfolio_media_assets
for each row execute function public.guard_portfolio_media_verified_transition();

create or replace function public.record_portfolio_media_verification(
  p_asset_id uuid,
  p_actor_id uuid,
  p_sha256 text,
  p_mime_type text,
  p_byte_size bigint,
  p_width integer,
  p_height integer,
  p_frame_count integer,
  p_total_pixels bigint,
  p_verification_version integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  asset public.portfolio_media_assets;
  actor_role text;
  object_record record;
  normalized_etag text;
  changed_at timestamptz := now();
begin
  if not public.portfolio_request_is_service_role() then
    raise exception 'Only the trusted media verifier may record verification'
      using errcode = '42501';
  end if;
  select role into actor_role
  from public.admin_users
  where user_id = p_actor_id
    and is_active = true
    and role in ('owner','publisher','editor');
  if not found then
    raise exception 'An active editor session is required' using errcode = '42501';
  end if;

  select * into asset
  from public.portfolio_media_assets
  where id = p_asset_id
  for update;
  if not found then raise exception 'Media asset not found' using errcode = 'P0002'; end if;
  if asset.legacy_upload_id is not null then
    raise exception 'Legacy media cannot use canonical verification' using errcode = '23514';
  end if;
  if asset.owner_id is distinct from p_actor_id and actor_role not in ('owner','publisher') then
    raise exception 'Editors may verify only their own reserved uploads' using errcode = '42501';
  end if;
  if asset.status not in ('reserved','staged','promoting','published') then
    raise exception 'Media is not in a verifiable state' using errcode = '23514';
  end if;
  if asset.staging_bucket <> 'portfolio-media-drafts'
     or asset.staging_path is null then
    raise exception 'The server-derived reserved path is invalid' using errcode = '23514';
  end if;

  if p_verification_version is distinct from 1
     or lower(coalesce(p_mime_type,'')) not in ('image/png','image/jpeg','image/webp','image/gif')
     or p_mime_type is distinct from asset.mime_type
     or p_byte_size is distinct from asset.byte_size
     or p_byte_size not between 1 and 3145728
     or lower(coalesce(p_sha256,'')) !~ '^[0-9a-f]{64}$'
     or p_width is null
     or p_height is null
     or p_width not between 1 and 6000
     or p_height not between 1 and 6000
     or p_width::bigint * p_height::bigint > 12000000
     or p_frame_count is null
     or p_frame_count not between 1 and 120
     or p_total_pixels is null
     or p_total_pixels < p_width::bigint * p_height::bigint
     or p_total_pixels > 24000000 then
    raise exception 'Trusted media verification results violate the enforced limits'
      using errcode = '22023';
  end if;

  select object.id, object.updated_at, object.metadata
  into object_record
  from storage.objects object
  where object.bucket_id = asset.staging_bucket
    and object.name = asset.staging_path;
  if not found then raise exception 'Reserved Storage object is missing' using errcode = '23514'; end if;
  normalized_etag := nullif(btrim(coalesce(object_record.metadata ->> 'eTag', object_record.metadata ->> 'etag', '')), '');
  if lower(coalesce(object_record.metadata ->> 'mimetype','')) <> p_mime_type
     or coalesce(object_record.metadata ->> 'size','') <> p_byte_size::text
     or normalized_etag is null then
    raise exception 'Storage identity does not match the verified bytes' using errcode = '23514';
  end if;

  if asset.verified_at is not null then
    if (
      asset.verified_sha256,
      asset.verified_mime_type,
      asset.verified_byte_size,
      asset.verified_width,
      asset.verified_height,
      asset.verified_frame_count,
      asset.verified_total_pixels,
      asset.verified_staging_bucket,
      asset.verified_staging_path,
      asset.verified_storage_object_id,
      asset.verified_storage_object_updated_at,
      asset.verified_storage_object_etag
    ) is distinct from (
      lower(p_sha256), p_mime_type, p_byte_size, p_width, p_height,
      p_frame_count, p_total_pixels, asset.staging_bucket, asset.staging_path,
      object_record.id, object_record.updated_at, normalized_etag
    ) then
      raise exception 'The immutable verified media binding does not match this object'
        using errcode = '23514';
    end if;
  else
    update public.portfolio_media_assets
    set verified_sha256 = lower(p_sha256),
        verified_mime_type = p_mime_type,
        verified_byte_size = p_byte_size,
        verified_width = p_width,
        verified_height = p_height,
        verified_frame_count = p_frame_count,
        verified_total_pixels = p_total_pixels,
        verified_at = changed_at,
        verification_version = p_verification_version,
        verified_staging_bucket = staging_bucket,
        verified_staging_path = staging_path,
        verified_storage_object_id = object_record.id,
        verified_storage_object_updated_at = object_record.updated_at,
        verified_storage_object_etag = normalized_etag,
        width = p_width,
        height = p_height,
        status = case when status = 'reserved' then 'staged' else status end,
        upload_finalized_at = coalesce(upload_finalized_at, changed_at),
        updated_at = changed_at
    where id = asset.id;

    insert into public.portfolio_activity_log (
      actor_id, action, resource_type, resource_id, metadata, created_at
    ) values (
      p_actor_id, 'media.upload_verified', 'media', asset.id::text,
      jsonb_build_object(
        'mime_type', p_mime_type, 'size', p_byte_size, 'width', p_width,
        'height', p_height, 'frame_count', p_frame_count,
        'total_pixels', p_total_pixels, 'sha256', lower(p_sha256),
        'verification_version', p_verification_version
      ), changed_at
    );
  end if;

  return jsonb_build_object(
    'asset_id', asset.id,
    'status', case when asset.status = 'reserved' then 'staged' else asset.status end,
    'mime_type', p_mime_type,
    'byte_size', p_byte_size,
    'width', p_width,
    'height', p_height,
    'frame_count', p_frame_count,
    'total_pixels', p_total_pixels,
    'checksum_sha256', lower(p_sha256),
    'verified_at', coalesce(asset.verified_at, changed_at),
    'verification_version', p_verification_version
  );
end;
$function$;

-- Compatibility endpoint: the browser cannot create a verification marker.
-- It may only read the result after the trusted Edge Function has completed.
create or replace function public.finalize_portfolio_media_upload(
  p_asset_id uuid,
  p_width integer default null,
  p_height integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  asset public.portfolio_media_assets;
begin
  if not public.has_admin_role(array['owner','publisher','editor']) then
    raise exception 'Editor access is required' using errcode = '42501';
  end if;
  select * into asset from public.portfolio_media_assets where id = p_asset_id for update;
  if not found then raise exception 'Media asset not found' using errcode = 'P0002'; end if;
  if asset.status = 'staged'
     and asset.verified_at is not null
     and public.portfolio_verified_source_is_current(asset.id) then
    if p_width is not null and p_width is distinct from asset.verified_width
       or p_height is not null and p_height is distinct from asset.verified_height then
      raise exception 'Client dimensions do not match trusted verification' using errcode = '23514';
    end if;
    return public.portfolio_media_asset_payload(asset.id);
  end if;
  raise exception 'Use the trusted verify-portfolio-media Edge Function before finalizing upload'
    using errcode = '23514';
end;
$function$;

create or replace function public.assert_portfolio_media_tokens(
  p_content jsonb,
  p_require_public_object boolean default false
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  token_record record;
  token_id uuid;
  media_record public.portfolio_media_assets;
begin
  for token_record in
    select strings.reference_value, strings.json_path
    from public.walk_portfolio_string_values(coalesce(p_content, '{}'::jsonb), '$') strings
    where lower(left(strings.reference_value, 8)) = 'media://'
  loop
    if token_record.reference_value !~ '^media://[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'Invalid media token at %', token_record.json_path using errcode = '22023';
    end if;
    token_id := substring(token_record.reference_value from 9)::uuid;
    select * into media_record from public.portfolio_media_assets where id = token_id;
    if not found then raise exception 'Unknown media token at %', token_record.json_path using errcode = '23503'; end if;
    if media_record.status in ('deleting','deleted') then
      raise exception 'Deleted media token at % cannot be saved', token_record.json_path using errcode = '23503';
    end if;
    if media_record.legacy_upload_id is null
       and media_record.status <> 'reserved'
       and not public.portfolio_verified_source_is_current(media_record.id) then
      raise exception 'Media at % is not bound to its trusted verification', token_record.json_path using errcode = '23514';
    end if;
    if p_require_public_object then
      if media_record.status not in ('published','legacy')
         or media_record.public_bucket is null or media_record.public_path is null then
        raise exception 'Media at % must be promoted before publishing', token_record.json_path using errcode = '23514';
      end if;
      if media_record.legacy_upload_id is null
         and not public.portfolio_public_copy_matches_verification(media_record.id) then
        raise exception 'Published media at % is not the verified immutable object', token_record.json_path using errcode = '23514';
      end if;
      if media_record.legacy_upload_id is not null and not exists (
        select 1 from storage.objects object
        where object.bucket_id = media_record.public_bucket and object.name = media_record.public_path
      ) then
        raise exception 'Published legacy media is missing at %', token_record.json_path using errcode = '23514';
      end if;
    end if;
  end loop;
end;
$function$;

-- Supabase Storage INSERT preflight uses `contentLength`; older releases and
-- post-upload metadata use `size`. Accept either spelling but require the exact
-- server reservation, MIME, owner, path, and reserved state.
create or replace function public.can_insert_portfolio_media_draft_object(
  p_bucket text,
  p_path text,
  p_metadata jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_bucket = 'portfolio-media-drafts'
    and public.has_admin_role(array['owner','publisher','editor'])
    and exists (
      select 1
      from public.portfolio_media_assets asset
      where asset.owner_id = (select auth.uid())
        and asset.status = 'reserved'
        and asset.staging_bucket = p_bucket
        and asset.staging_path = p_path
        and lower(coalesce(p_metadata ->> 'mimetype','')) = asset.mime_type
        and coalesce(p_metadata ->> 'contentLength', p_metadata ->> 'size','') = asset.byte_size::text
    );
$function$;

-- Only an active staff member or a currently published/reference-bound asset
-- on an enabled site may pass Storage SELECT RLS to mint/read a signed URL.
create or replace function public.can_read_portfolio_media_delivery_object(
  p_bucket text,
  p_path text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_bucket = 'portfolio-media-public'
    and (
      public.has_admin_role(array['owner','publisher','editor','viewer'])
      or exists (
        select 1
        from public.portfolio_media_assets asset
        join public.portfolio_media_references reference
          on reference.asset_id = asset.id
         and reference.scope = 'published'
        join public.portfolio_content content on content.id = 1
        where asset.public_bucket = p_bucket
          and asset.public_path = p_path
          and asset.status = 'published'
          and asset.legacy_upload_id is null
          and content.public_enabled = true
          and public.portfolio_verified_source_is_current(asset.id)
          and public.portfolio_public_copy_matches_verification(asset.id)
      )
    );
$function$;

create or replace function public.can_insert_portfolio_media_public_object(
  p_bucket text,
  p_path text,
  p_metadata jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_bucket = 'portfolio-media-public'
    and public.has_admin_role(array['owner','publisher'])
    and exists (
      select 1
      from public.portfolio_media_assets asset
      where asset.status = 'promoting'
        and asset.public_bucket = p_bucket
        and asset.public_path = p_path
        and public.portfolio_verified_source_is_current(asset.id)
        and lower(coalesce(p_metadata ->> 'mimetype','')) = asset.verified_mime_type
        and coalesce(p_metadata ->> 'size','') = asset.verified_byte_size::text
        and nullif(btrim(coalesce(p_metadata ->> 'eTag', p_metadata ->> 'etag', '')), '')
            = asset.verified_storage_object_etag
    );
$function$;

drop policy if exists "Phase4 public reads published media" on storage.objects;
drop policy if exists "Phase7 signed reads verified published media" on storage.objects;
create policy "Phase7 signed reads verified published media"
on storage.objects
for select
to anon, authenticated
using (public.can_read_portfolio_media_delivery_object(bucket_id, name));

create or replace function public.get_public_media_manifest()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  site_enabled boolean;
  result jsonb;
begin
  select public_enabled into site_enabled from public.portfolio_content where id = 1;
  if not found or not coalesce(site_enabled, true) then return '{}'::jsonb; end if;

  select coalesce(jsonb_object_agg(
    'media://' || asset.id::text,
    jsonb_build_object(
      'asset_id', asset.id,
      'bucket', asset.public_bucket,
      'path', asset.public_path,
      -- Legacy objects retain their historical public URL. The canonical
      -- private bucket never exposes or reconstructs a direct public URL.
      'public_url', case when asset.legacy_upload_id is not null then asset.public_url else null end,
      'delivery', case when asset.legacy_upload_id is not null then 'legacy-public' else 'signed' end,
      'signed_url_expires_in', case when asset.legacy_upload_id is null then 300 else null end,
      'mime_type', asset.mime_type,
      'width', asset.width,
      'height', asset.height,
      'alt_text', asset.published_alt_text
    )
  ), '{}'::jsonb)
  into result
  from public.portfolio_media_assets asset
  where asset.status in ('published','legacy')
    and asset.public_bucket is not null
    and asset.public_path is not null
    and exists (
      select 1 from public.portfolio_media_references reference
      where reference.asset_id = asset.id and reference.scope = 'published'
    )
    and exists (
      select 1 from storage.objects object
      where object.bucket_id = asset.public_bucket and object.name = asset.public_path
    )
    and (
      asset.legacy_upload_id is not null
      or (
        public.portfolio_verified_source_is_current(asset.id)
        and public.portfolio_public_copy_matches_verification(asset.id)
      )
    );
  return result;
end;
$function$;

create or replace function public.prepare_portfolio_media_promotion(
  p_expected_draft_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  draft_content jsonb;
  public_draft jsonb;
  current_revision bigint;
  media_record public.portfolio_media_assets;
  extension text;
  destination_path text;
  result_items jsonb := '[]'::jsonb;
  promoted_count integer := 0;
  changed_at timestamptz := now();
begin
  if not public.has_admin_role(array['owner','publisher']) then
    raise exception 'Publisher access is required' using errcode = '42501';
  end if;
  select draft_json, draft_revision into draft_content, current_revision
  from public.portfolio_content where id = 1 for update;
  if not found then raise exception 'Portfolio content row not found' using errcode = 'P0002'; end if;
  if current_revision is distinct from coalesce(p_expected_draft_revision,0) then
    raise exception 'The draft changed in another session. Reload before preparing media.' using errcode = '40001';
  end if;

  draft_content := public.validate_portfolio_content(draft_content);
  public_draft := public.sanitize_published_portfolio(draft_content);
  perform 1
  from public.portfolio_media_assets asset
  where asset.id in (
    select reference.asset_id from public.extract_portfolio_media_references(public_draft) reference
  )
  order by asset.id
  for update;
  perform public.assert_portfolio_media_tokens(public_draft, false);

  for media_record in
    select asset.*
    from public.portfolio_media_assets asset
    where asset.id in (
      select reference.asset_id from public.extract_portfolio_media_references(public_draft) reference
    )
    order by asset.id
  loop
    if media_record.status in ('published','legacy') then continue; end if;
    if media_record.status = 'reserved' then
      raise exception 'Media % must be verified before promotion', media_record.id using errcode = '23514';
    end if;
    if media_record.status not in ('staged','promoting')
       or not public.portfolio_verified_source_is_current(media_record.id) then
      raise exception 'Media % is not a verified promotable object', media_record.id using errcode = '23514';
    end if;
    if media_record.status = 'staged' then
      extension := public.portfolio_media_extension(media_record.verified_mime_type);
      if extension is null then raise exception 'Media % has an unsupported MIME type', media_record.id using errcode = '23514'; end if;
      destination_path := 'assets/' || media_record.id::text || '/' || gen_random_uuid()::text || '.' || extension;
      update public.portfolio_media_assets
      set status = 'promoting', public_bucket = 'portfolio-media-public',
          public_path = destination_path, public_url = null,
          promotion_prepared_at = changed_at, updated_at = changed_at
      where id = media_record.id;
      media_record.status := 'promoting';
      media_record.public_bucket := 'portfolio-media-public';
      media_record.public_path := destination_path;
      promoted_count := promoted_count + 1;
    end if;
    result_items := result_items || jsonb_build_array(jsonb_build_object(
      'asset_id', media_record.id,
      'reference_token', 'media://' || media_record.id::text,
      'source_bucket', media_record.verified_staging_bucket,
      'source_path', media_record.verified_staging_path,
      'destination_bucket', media_record.public_bucket,
      'destination_path', media_record.public_path,
      'mime_type', media_record.verified_mime_type,
      'size', media_record.verified_byte_size,
      'checksum_sha256', media_record.verified_sha256
    ));
  end loop;

  insert into public.portfolio_activity_log (
    actor_id, action, resource_type, resource_id, metadata, created_at
  ) values (
    (select auth.uid()), 'media.promotion_prepared', 'portfolio', 'main',
    jsonb_build_object('draft_revision', current_revision, 'new_promotions', promoted_count, 'copy_items', jsonb_array_length(result_items)),
    changed_at
  );
  return jsonb_build_object('draft_revision', current_revision, 'items', result_items);
end;
$function$;

create or replace function public.finalize_portfolio_media_promotion(p_asset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  asset public.portfolio_media_assets;
  changed_at timestamptz := now();
begin
  if not public.has_admin_role(array['owner','publisher']) then
    raise exception 'Publisher access is required' using errcode = '42501';
  end if;
  select * into asset from public.portfolio_media_assets where id = p_asset_id for update;
  if not found then raise exception 'Media asset not found' using errcode = 'P0002'; end if;
  if asset.status in ('published','legacy') then return public.portfolio_media_asset_payload(asset.id); end if;
  if asset.status <> 'promoting' then
    raise exception 'Media must be prepared before promotion can be finalized' using errcode = '23514';
  end if;
  if not public.portfolio_verified_source_is_current(asset.id) then
    raise exception 'The verified private source changed' using errcode = '23514';
  end if;
  if not public.portfolio_public_copy_matches_verification(asset.id) then
    raise exception 'The delivery object is not the verified immutable copy' using errcode = '23514';
  end if;
  update public.portfolio_media_assets
  set status = 'published', published_at = changed_at, public_url = null, updated_at = changed_at
  where id = asset.id;
  insert into public.portfolio_activity_log (
    actor_id, action, resource_type, resource_id, metadata, created_at
  ) values (
    (select auth.uid()), 'media.promotion_finalized', 'media', asset.id::text,
    jsonb_build_object('public_bucket', asset.public_bucket, 'public_path', asset.public_path, 'sha256', asset.verified_sha256),
    changed_at
  );
  return public.portfolio_media_asset_payload(asset.id);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Deterministic singleton -> asset lock order for every content mutation
-- ---------------------------------------------------------------------------

create or replace function public.lock_portfolio_media_assets(p_content jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform 1
  from public.portfolio_media_assets asset
  where asset.id in (
    select reference.asset_id
    from public.extract_portfolio_media_references(coalesce(p_content, '{}'::jsonb)) reference
  )
  order by asset.id
  for update;
end;
$function$;

create or replace function public.save_portfolio_draft(
  p_content jsonb,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_revision bigint;
  next_revision bigint;
  schema_version integer;
  validated_content jsonb;
  changed_at timestamptz := now();
begin
  if not public.has_admin_role(array['owner','publisher','editor']) then
    raise exception 'Editor access is required' using errcode = '42501';
  end if;
  select draft_revision into current_revision
  from public.portfolio_content where id = 1 for update;
  if not found then raise exception 'Portfolio content row not found' using errcode = 'P0002'; end if;
  if current_revision is distinct from coalesce(p_expected_revision,0) then
    raise exception 'The draft changed in another session. Reload before saving.' using errcode = '40001';
  end if;
  validated_content := public.validate_portfolio_content(p_content);
  schema_version := public.portfolio_content_schema_version(validated_content);
  perform public.lock_portfolio_media_assets(validated_content);
  perform public.assert_portfolio_media_tokens(validated_content, false);
  next_revision := current_revision + 1;
  update public.portfolio_content
  set draft_json = validated_content, draft_schema_version = schema_version,
      draft_revision = next_revision, updated_by = (select auth.uid()), updated_at = changed_at
  where id = 1;
  insert into public.portfolio_revisions (revision, kind, content_json, created_by, created_at)
  values (next_revision, 'draft', validated_content, (select auth.uid()), changed_at)
  on conflict (kind, revision) do nothing;
  insert into public.portfolio_activity_log (actor_id, action, resource_type, resource_id, metadata, created_at)
  values (
    (select auth.uid()), 'draft.saved', 'portfolio', 'main',
    jsonb_build_object('draft_revision', next_revision, 'schema_version', schema_version), changed_at
  );
  return jsonb_build_object('draft_revision', next_revision, 'schema_version', schema_version, 'updated_at', changed_at);
end;
$function$;

create or replace function public.restore_portfolio_revision(
  p_revision_id uuid,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  restored_content jsonb;
  validated_content jsonb;
  schema_version integer;
  current_revision bigint;
  next_revision bigint;
  changed_at timestamptz := now();
begin
  if not public.has_admin_role(array['owner','publisher']) then
    raise exception 'Publisher access is required' using errcode = '42501';
  end if;
  select draft_revision into current_revision
  from public.portfolio_content where id = 1 for update;
  if not found then raise exception 'Portfolio content row not found' using errcode = 'P0002'; end if;
  if current_revision is distinct from coalesce(p_expected_revision,0) then
    raise exception 'The draft changed in another session. Reload before restoring.' using errcode = '40001';
  end if;
  select content_json into restored_content
  from public.portfolio_revisions where id = p_revision_id;
  if not found then raise exception 'Revision not found' using errcode = 'P0002'; end if;
  -- Retained pre-005 revisions are immutable. Apply the same deterministic
  -- legacy reconciliation used by 005 to the new draft before strict validation.
  validated_content := public.validate_portfolio_content(
    public.portfolio_repair_work_categories(public.portfolio_fill_missing_studio_defaults(restored_content))
  );
  schema_version := public.portfolio_content_schema_version(validated_content);
  perform public.lock_portfolio_media_assets(validated_content);
  perform public.assert_portfolio_media_tokens(validated_content, false);
  next_revision := current_revision + 1;
  update public.portfolio_content
  set draft_json = validated_content, draft_schema_version = schema_version,
      draft_revision = next_revision, updated_by = (select auth.uid()), updated_at = changed_at
  where id = 1;
  insert into public.portfolio_revisions (revision, kind, content_json, created_by, created_at)
  values (next_revision, 'draft', validated_content, (select auth.uid()), changed_at)
  on conflict (kind, revision) do nothing;
  insert into public.portfolio_activity_log (actor_id, action, resource_type, resource_id, metadata, created_at)
  values (
    (select auth.uid()), 'revision.restored', 'portfolio', p_revision_id::text,
    jsonb_build_object('draft_revision', next_revision, 'schema_version', schema_version), changed_at
  );
  return jsonb_build_object(
    'draft_json', validated_content, 'draft_revision', next_revision,
    'schema_version', schema_version, 'updated_at', changed_at
  );
end;
$function$;

create or replace function public.publish_portfolio(p_expected_draft_revision bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_draft_revision bigint;
  current_published_revision bigint;
  next_published_revision bigint;
  draft_content jsonb;
  validated_content jsonb;
  public_content jsonb;
  schema_version integer;
  changed_at timestamptz := now();
begin
  if not public.has_admin_role(array['owner','publisher']) then
    raise exception 'Publisher access is required' using errcode = '42501';
  end if;
  select draft_json, draft_revision, published_revision
  into draft_content, current_draft_revision, current_published_revision
  from public.portfolio_content where id = 1 for update;
  if not found then raise exception 'Portfolio content row not found' using errcode = 'P0002'; end if;
  if current_draft_revision is distinct from coalesce(p_expected_draft_revision,0) then
    raise exception 'The draft changed in another session. Reload before publishing.' using errcode = '40001';
  end if;
  validated_content := public.validate_portfolio_content(draft_content);
  schema_version := public.portfolio_content_schema_version(validated_content);
  public_content := public.sanitize_published_portfolio(validated_content);
  perform public.lock_portfolio_media_assets(public_content);
  perform public.assert_portfolio_media_tokens(public_content, true);
  next_published_revision := current_published_revision + 1;
  update public.portfolio_content
  set draft_json = validated_content, draft_schema_version = schema_version,
      published_json = validated_content, published_schema_version = schema_version,
      published_revision = next_published_revision, public_enabled = true,
      unpublished_at = null, published_by = (select auth.uid()), published_at = changed_at
  where id = 1;
  update public.portfolio_media_assets asset
  set published_alt_text = asset.alt_text, updated_at = changed_at
  where asset.id in (
    select reference.asset_id from public.extract_portfolio_media_references(public_content) reference
  );
  insert into public.portfolio_revisions (revision, kind, content_json, created_by, created_at)
  values (next_published_revision, 'published', validated_content, (select auth.uid()), changed_at)
  on conflict (kind, revision) do nothing;
  insert into public.portfolio_activity_log (actor_id, action, resource_type, resource_id, metadata, created_at)
  values (
    (select auth.uid()), 'portfolio.published', 'portfolio', 'main',
    jsonb_build_object(
      'draft_revision', current_draft_revision,
      'published_revision', next_published_revision,
      'schema_version', schema_version,
      'published_media_count', (
        select count(distinct reference.asset_id)
        from public.extract_portfolio_media_references(public_content) reference
      )
    ), changed_at
  );
  insert into public.portfolio_publish_events (published_revision, created_at)
  values (next_published_revision, changed_at);
  return jsonb_build_object(
    'published_json', public_content || jsonb_build_object('publicEnabled', true),
    'published_revision', next_published_revision,
    'schema_version', schema_version,
    'public_enabled', true,
    'published_at', changed_at
  );
end;
$function$;

create or replace function public.unpublish_portfolio(p_expected_published_revision bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_published_revision bigint;
  next_published_revision bigint;
  was_enabled boolean;
  stored_content jsonb;
  public_content jsonb;
  schema_version integer;
  prior_unpublished_at timestamptz;
  changed_at timestamptz := now();
begin
  if not public.has_admin_role(array['owner','publisher']) then
    raise exception 'Publisher access is required' using errcode = '42501';
  end if;
  select published_revision, public_enabled, published_json, published_schema_version, unpublished_at
  into current_published_revision, was_enabled, stored_content, schema_version, prior_unpublished_at
  from public.portfolio_content where id = 1 for update;
  if not found then raise exception 'Portfolio content row not found' using errcode = 'P0002'; end if;
  if current_published_revision is distinct from coalesce(p_expected_published_revision,0) then
    raise exception 'The published site changed in another session. Reload before unpublishing.' using errcode = '40001';
  end if;
  public_content := public.sanitize_published_portfolio(stored_content);
  perform public.lock_portfolio_media_assets(public_content);
  if not coalesce(was_enabled,true) then
    return jsonb_build_object(
      'published_json', jsonb_build_object('schemaVersion',1,'publicEnabled',false),
      'published_revision', current_published_revision, 'schema_version', schema_version,
      'public_enabled', false, 'unpublished_at', prior_unpublished_at
    );
  end if;
  next_published_revision := current_published_revision + 1;
  update public.portfolio_content
  set public_enabled = false, published_revision = next_published_revision,
      published_by = (select auth.uid()), unpublished_at = changed_at
  where id = 1;
  insert into public.portfolio_revisions (revision, kind, content_json, created_by, created_at)
  values (next_published_revision, 'published', stored_content, (select auth.uid()), changed_at)
  on conflict (kind, revision) do nothing;
  insert into public.portfolio_activity_log (actor_id, action, resource_type, resource_id, metadata, created_at)
  values (
    (select auth.uid()), 'portfolio.unpublished', 'portfolio', 'main',
    jsonb_build_object('published_revision', next_published_revision, 'schema_version', schema_version), changed_at
  );
  insert into public.portfolio_publish_events (published_revision, created_at)
  values (next_published_revision, changed_at);
  return jsonb_build_object(
    'published_json', jsonb_build_object('schemaVersion',1,'publicEnabled',false),
    'published_revision', next_published_revision, 'schema_version', schema_version,
    'public_enabled', false, 'unpublished_at', changed_at
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Revision-aware deletion. Lock order is always singleton -> asset.
-- ---------------------------------------------------------------------------

create or replace function public.portfolio_media_has_retained_revision_reference(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.portfolio_revisions revision
    cross join lateral public.extract_portfolio_media_references(revision.content_json) reference
    where reference.asset_id = p_asset_id
  );
$function$;

create or replace function public.portfolio_media_asset_payload(p_asset_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'asset_id', asset.id,
    'id', asset.id,
    'reference_token', 'media://' || asset.id::text,
    'owner_id', asset.owner_id,
    'name', asset.original_name,
    'original_name', asset.original_name,
    'mime_type', asset.mime_type,
    'size', asset.byte_size,
    'byte_size', asset.byte_size,
    'alt_text', asset.alt_text,
    'published_alt_text', asset.published_alt_text,
    'width', asset.width,
    'height', asset.height,
    'status', asset.status,
    'storage_bucket', asset.staging_bucket,
    'storage_path', asset.staging_path,
    'staging_bucket', asset.staging_bucket,
    'staging_path', asset.staging_path,
    'public_bucket', asset.public_bucket,
    'public_path', asset.public_path,
    'public_url', case when asset.legacy_upload_id is not null then asset.public_url else null end,
    'replacement_for', asset.replacement_for,
    'legacy_upload_id', asset.legacy_upload_id,
    'created_at', asset.created_at,
    'updated_at', asset.updated_at,
    'upload_finalized_at', asset.upload_finalized_at,
    'promotion_prepared_at', asset.promotion_prepared_at,
    'published_at', asset.published_at,
    'deletion_requested_at', asset.deletion_requested_at,
    'deleted_at', asset.deleted_at,
    'verified_at', asset.verified_at,
    'verification_version', asset.verification_version,
    'checksum_sha256', asset.verified_sha256,
    'frame_count', asset.verified_frame_count,
    'total_pixels', asset.verified_total_pixels,
    'draft_reference_count', (
      select count(*) from public.portfolio_media_references reference
      where reference.asset_id = asset.id and reference.scope = 'draft'
    ),
    'published_reference_count', (
      select count(*) from public.portfolio_media_references reference
      where reference.asset_id = asset.id and reference.scope = 'published'
    ),
    'is_referenced', exists (
      select 1 from public.portfolio_media_references reference where reference.asset_id = asset.id
    ),
    'retained_revision_reference', public.portfolio_media_has_retained_revision_reference(asset.id),
    'can_delete',
      not exists (
        select 1 from public.portfolio_media_references reference where reference.asset_id = asset.id
      )
      and not public.portfolio_media_has_retained_revision_reference(asset.id)
      and asset.status not in ('deleting','deleted')
      and (
        (asset.public_path is null and public.has_admin_role(array['owner','publisher','editor']))
        or public.has_admin_role(array['owner','publisher'])
      )
  ) into result
  from public.portfolio_media_assets asset where asset.id = p_asset_id;
  return result;
end;
$function$;

create or replace function public.request_portfolio_media_deletion(p_asset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  asset public.portfolio_media_assets;
  objects jsonb := '[]'::jsonb;
  changed_at timestamptz := now();
begin
  if not public.has_admin_role(array['owner','publisher','editor']) then
    raise exception 'Editor access is required' using errcode = '42501';
  end if;
  perform 1 from public.portfolio_content where id = 1 for update;
  if not found then raise exception 'Portfolio content row not found' using errcode = 'P0002'; end if;
  select * into asset from public.portfolio_media_assets where id = p_asset_id for update;
  if not found or asset.status = 'deleted' then raise exception 'Media asset not found' using errcode = 'P0002'; end if;
  if asset.public_path is not null or asset.status in ('published','legacy') then
    if not public.has_admin_role(array['owner','publisher']) then
      raise exception 'Publisher access is required to delete delivery media' using errcode = '42501';
    end if;
  end if;
  if exists (
    select 1 from public.portfolio_media_references reference where reference.asset_id = asset.id
  ) then
    raise exception 'Media is referenced by the current draft or published content' using errcode = '23503';
  end if;
  if public.portfolio_media_has_retained_revision_reference(asset.id) then
    raise exception 'Media is referenced by retained revision history and cannot be deleted' using errcode = '23503';
  end if;
  if asset.status <> 'deleting' then
    update public.portfolio_media_assets
    set status = 'deleting', deletion_requested_at = changed_at, updated_at = changed_at
    where id = asset.id;
    insert into public.portfolio_activity_log (actor_id, action, resource_type, resource_id, metadata, created_at)
    values (
      (select auth.uid()), 'media.deletion_requested', 'media', asset.id::text,
      jsonb_build_object('had_staging_object', asset.staging_path is not null, 'had_public_object', asset.public_path is not null),
      changed_at
    );
  end if;
  if asset.staging_bucket is not null and asset.staging_path is not null then
    objects := objects || jsonb_build_array(jsonb_build_object('bucket',asset.staging_bucket,'path',asset.staging_path));
  end if;
  if asset.public_bucket is not null and asset.public_path is not null then
    objects := objects || jsonb_build_array(jsonb_build_object('bucket',asset.public_bucket,'path',asset.public_path));
  end if;
  return jsonb_build_object('asset_id',asset.id,'status','deleting','objects',objects);
end;
$function$;

create or replace function public.finalize_portfolio_media_deletion(p_asset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  asset public.portfolio_media_assets;
  changed_at timestamptz := now();
begin
  if not public.has_admin_role(array['owner','publisher','editor']) then
    raise exception 'Editor access is required' using errcode = '42501';
  end if;
  perform 1 from public.portfolio_content where id = 1 for update;
  if not found then raise exception 'Portfolio content row not found' using errcode = 'P0002'; end if;
  select * into asset from public.portfolio_media_assets where id = p_asset_id for update;
  if not found then raise exception 'Media asset not found' using errcode = 'P0002'; end if;
  if asset.public_path is not null or asset.status in ('published','legacy') then
    if not public.has_admin_role(array['owner','publisher']) then
      raise exception 'Publisher access is required to delete delivery media' using errcode = '42501';
    end if;
  end if;
  if asset.status = 'deleted' then return public.portfolio_media_asset_payload(asset.id); end if;
  if asset.status <> 'deleting' then
    raise exception 'Media deletion must be requested before it is finalized' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.portfolio_media_references reference where reference.asset_id = asset.id
  ) or public.portfolio_media_has_retained_revision_reference(asset.id) then
    raise exception 'Media became referenced again; deletion cannot be finalized' using errcode = '23503';
  end if;
  if exists (
    select 1 from storage.objects object
    where (object.bucket_id = asset.staging_bucket and object.name = asset.staging_path)
       or (object.bucket_id = asset.public_bucket and object.name = asset.public_path)
  ) then
    raise exception 'Storage objects still exist; remove them before finalizing deletion' using errcode = '23514';
  end if;
  update public.portfolio_media_assets
  set status = 'deleted', deleted_at = changed_at, updated_at = changed_at where id = asset.id;
  insert into public.portfolio_activity_log (actor_id, action, resource_type, resource_id, metadata, created_at)
  values (
    (select auth.uid()), 'media.deleted', 'media', asset.id::text,
    jsonb_build_object(
      'staging_bucket',asset.staging_bucket,'staging_path',asset.staging_path,
      'public_bucket',asset.public_bucket,'public_path',asset.public_path
    ), changed_at
  );
  return public.portfolio_media_asset_payload(asset.id);
end;
$function$;

create or replace function public.can_delete_portfolio_media_object(p_bucket text, p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.portfolio_media_assets asset
    where asset.status = 'deleting'
      and (
        (
          asset.staging_bucket = p_bucket and asset.staging_path = p_path
          and ((asset.public_path is null and public.has_admin_role(array['owner','publisher','editor']))
               or public.has_admin_role(array['owner','publisher']))
        )
        or (
          asset.public_bucket = p_bucket and asset.public_path = p_path
          and public.has_admin_role(array['owner','publisher'])
        )
      )
      and not exists (
        select 1 from public.portfolio_media_references reference where reference.asset_id = asset.id
      )
      and not public.portfolio_media_has_retained_revision_reference(asset.id)
  );
$function$;

create or replace function public.can_delete_portfolio_upload(p_storage_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.portfolio_media_assets asset
    where asset.legacy_upload_id is not null
      and asset.public_bucket = 'portfolio-uploads'
      and asset.public_path = p_storage_path
      and asset.status = 'deleting'
      and public.has_admin_role(array['owner','publisher'])
      and not exists (
        select 1 from public.portfolio_media_references reference where reference.asset_id = asset.id
      )
      and not public.portfolio_media_has_retained_revision_reference(asset.id)
  );
$function$;

-- ---------------------------------------------------------------------------
-- Explicit function ACLs
-- ---------------------------------------------------------------------------

revoke all on function public.portfolio_request_is_service_role() from public, anon, authenticated;
revoke all on function public.assert_portfolio_object_keys(jsonb,text[],text[],text) from public, anon, authenticated;
revoke all on function public.assert_portfolio_no_forbidden_keys(jsonb,text) from public, anon, authenticated;
revoke all on function public.portfolio_safe_https_url(text,boolean,boolean) from public, anon, authenticated;
revoke all on function public.portfolio_safe_identifier(text) from public, anon, authenticated;
revoke all on function public.portfolio_safe_email(text) from public, anon, authenticated;
revoke all on function public.assert_portfolio_field_types(jsonb,text[],text[],text[],text[],text[],text) from public, anon, authenticated;
revoke all on function public.assert_portfolio_string_array(jsonb,text,integer,integer) from public, anon, authenticated;
revoke all on function public.assert_portfolio_seo(jsonb,text,boolean) from public, anon, authenticated;
revoke all on function public.assert_portfolio_gallery(jsonb,text,text) from public, anon, authenticated;
revoke all on function public.validate_portfolio_content(jsonb) from public, anon, authenticated;
revoke all on function public.sanitize_published_portfolio(jsonb) from public, anon, authenticated;
revoke all on function public.portfolio_fill_missing_studio_defaults(jsonb) from public, anon, authenticated;
revoke all on function public.portfolio_repair_work_categories(jsonb) from public, anon, authenticated;
revoke all on function public.portfolio_count_invalid_work_categories(jsonb) from public, anon, authenticated;
revoke all on function public.portfolio_verified_source_is_current(uuid) from public, anon, authenticated;
revoke all on function public.portfolio_public_copy_matches_verification(uuid) from public, anon, authenticated;
revoke all on function public.guard_portfolio_media_verified_transition() from public, anon, authenticated;
revoke all on function public.record_portfolio_media_verification(uuid,uuid,text,text,bigint,integer,integer,integer,bigint,integer)
  from public, anon, authenticated;
revoke all on function public.lock_portfolio_media_assets(jsonb) from public, anon, authenticated;
revoke all on function public.portfolio_media_has_retained_revision_reference(uuid) from public, anon, authenticated;

revoke all on function public.can_insert_portfolio_media_draft_object(text,text,jsonb) from public, anon, authenticated;
revoke all on function public.can_read_portfolio_media_delivery_object(text,text) from public, anon, authenticated;
grant execute on function public.can_insert_portfolio_media_draft_object(text,text,jsonb) to authenticated;
grant execute on function public.can_read_portfolio_media_delivery_object(text,text) to anon, authenticated;
grant execute on function public.can_insert_portfolio_media_public_object(text,text,jsonb) to authenticated;
grant execute on function public.can_delete_portfolio_media_object(text,text) to authenticated;
grant execute on function public.can_delete_portfolio_upload(text) to authenticated;

grant execute on function public.record_portfolio_media_verification(uuid,uuid,text,text,bigint,integer,integer,integer,bigint,integer)
  to service_role;

revoke all on function public.finalize_portfolio_media_upload(uuid,integer,integer) from public, anon, authenticated;
revoke all on function public.prepare_portfolio_media_promotion(bigint) from public, anon, authenticated;
revoke all on function public.finalize_portfolio_media_promotion(uuid) from public, anon, authenticated;
revoke all on function public.portfolio_media_asset_payload(uuid) from public, anon, authenticated;
revoke all on function public.request_portfolio_media_deletion(uuid) from public, anon, authenticated;
revoke all on function public.finalize_portfolio_media_deletion(uuid) from public, anon, authenticated;
grant execute on function public.finalize_portfolio_media_upload(uuid,integer,integer) to authenticated;
grant execute on function public.prepare_portfolio_media_promotion(bigint) to authenticated;
grant execute on function public.finalize_portfolio_media_promotion(uuid) to authenticated;
grant execute on function public.request_portfolio_media_deletion(uuid) to authenticated;
grant execute on function public.finalize_portfolio_media_deletion(uuid) to authenticated;

revoke all on function public.get_public_media_manifest() from public, anon, authenticated;
grant execute on function public.get_public_media_manifest() to anon, authenticated;

revoke all on function public.save_portfolio_draft(jsonb,bigint) from public, anon, authenticated;
revoke all on function public.restore_portfolio_revision(uuid,bigint) from public, anon, authenticated;
revoke all on function public.publish_portfolio(bigint) from public, anon, authenticated;
revoke all on function public.unpublish_portfolio(bigint) from public, anon, authenticated;
grant execute on function public.save_portfolio_draft(jsonb,bigint) to authenticated;
grant execute on function public.restore_portfolio_revision(uuid,bigint) to authenticated;
grant execute on function public.publish_portfolio(bigint) to authenticated;
grant execute on function public.unpublish_portfolio(bigint) to authenticated;

commit;
