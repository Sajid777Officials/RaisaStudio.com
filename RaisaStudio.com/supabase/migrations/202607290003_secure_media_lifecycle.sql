-- Phase 4: private draft media, immutable published media, canonical asset
-- metadata, reference tracking, guarded promotion/replacement/deletion, and a
-- compatibility bridge for the legacy portfolio_uploads table/bucket.
--
-- Object bytes still travel through the Supabase Storage API. Database RPCs
-- reserve unpredictable paths and validate state/metadata before and after
-- each Storage operation; no RPC accepts or writes raw file bytes.

begin;

-- ---------------------------------------------------------------------------
-- Canonical media records and current-document references
-- ---------------------------------------------------------------------------

create table if not exists public.portfolio_media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  original_name text not null,
  mime_type text not null,
  byte_size bigint not null,
  alt_text text not null default '',
  published_alt_text text not null default '',
  width integer,
  height integer,
  status text not null default 'reserved',
  staging_bucket text,
  staging_path text,
  public_bucket text,
  public_path text,
  public_url text,
  replacement_for uuid references public.portfolio_media_assets(id) on delete set null,
  legacy_upload_id uuid unique references public.portfolio_uploads(id) on delete set null,
  upload_finalized_at timestamptz,
  promotion_prepared_at timestamptz,
  published_at timestamptz,
  deletion_requested_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portfolio_media_assets_status_check check (
    status in (
      'reserved',
      'staged',
      'promoting',
      'published',
      'deleting',
      'deleted',
      'legacy'
    )
  ),
  constraint portfolio_media_assets_name_check check (
    length(original_name) between 1 and 200
  ),
  constraint portfolio_media_assets_size_check check (
    byte_size between 0 and 3145728
  ),
  constraint portfolio_media_assets_alt_text_check check (
    length(alt_text) <= 500
    and length(published_alt_text) <= 500
  ),
  constraint portfolio_media_assets_dimensions_check check (
    (width is null and height is null)
    or (
      width between 1 and 12000
      and height between 1 and 12000
    )
  ),
  constraint portfolio_media_assets_new_mime_check check (
    legacy_upload_id is not null
    or mime_type in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
  )
);

create unique index if not exists portfolio_media_assets_staging_object_uidx
  on public.portfolio_media_assets (staging_bucket, staging_path)
  where staging_bucket is not null and staging_path is not null;

create unique index if not exists portfolio_media_assets_public_object_uidx
  on public.portfolio_media_assets (public_bucket, public_path)
  where public_bucket is not null and public_path is not null;

create index if not exists portfolio_media_assets_created_at_idx
  on public.portfolio_media_assets (created_at desc);

create index if not exists portfolio_media_assets_status_idx
  on public.portfolio_media_assets (status);

create table if not exists public.portfolio_media_references (
  scope text not null check (scope in ('draft', 'published')),
  json_path text not null,
  asset_id uuid not null
    references public.portfolio_media_assets(id) on delete restrict,
  reference_value text not null,
  revision bigint not null,
  created_at timestamptz not null default now(),
  primary key (scope, json_path)
);

create index if not exists portfolio_media_references_asset_scope_idx
  on public.portfolio_media_references (asset_id, scope);

alter table public.portfolio_media_assets enable row level security;
alter table public.portfolio_media_references enable row level security;

revoke all on table public.portfolio_media_assets from anon, authenticated;
revoke all on table public.portfolio_media_references from anon, authenticated;

-- Canonical tables are RPC-only. Drop possible development-era policies so a
-- rerun cannot accidentally retain direct browser writes.
drop policy if exists "Active admins can read media assets"
  on public.portfolio_media_assets;
drop policy if exists "Editors can manage media assets"
  on public.portfolio_media_assets;
drop policy if exists "Active admins can read media references"
  on public.portfolio_media_references;

-- ---------------------------------------------------------------------------
-- JSON reference extraction and synchronization
-- ---------------------------------------------------------------------------

-- Walk every string leaf and return a deterministic diagnostic path. Matching
-- to media tokens/known legacy URLs is performed separately.
create or replace function public.walk_portfolio_string_values(
  p_value jsonb,
  p_path text default '$'
)
returns table (
  reference_value text,
  json_path text
)
language plpgsql
immutable
set search_path = ''
as $function$
declare
  object_key text;
  child_value jsonb;
  array_index bigint;
begin
  if p_value is null then
    return;
  end if;

  if jsonb_typeof(p_value) = 'object' then
    for object_key, child_value in
      select key, value
      from jsonb_each(p_value)
    loop
      return query
      select walked.reference_value, walked.json_path
      from public.walk_portfolio_string_values(
        child_value,
        p_path || '[' || to_jsonb(object_key)::text || ']'
      ) as walked;
    end loop;
    return;
  end if;

  if jsonb_typeof(p_value) = 'array' then
    for child_value, array_index in
      select value, ordinality - 1
      from jsonb_array_elements(p_value) with ordinality
    loop
      return query
      select walked.reference_value, walked.json_path
      from public.walk_portfolio_string_values(
        child_value,
        p_path || '[' || array_index::text || ']'
      ) as walked;
    end loop;
    return;
  end if;

  if jsonb_typeof(p_value) = 'string' then
    reference_value := p_value #>> '{}';
    json_path := p_path;
    return next;
  end if;
end;
$function$;

create or replace function public.extract_portfolio_media_references(
  p_content jsonb
)
returns table (
  asset_id uuid,
  json_path text,
  reference_value text
)
language sql
stable
set search_path = ''
as $function$
  select distinct on (strings.json_path)
    asset.id as asset_id,
    strings.json_path,
    strings.reference_value
  from public.walk_portfolio_string_values(
    coalesce(p_content, '{}'::jsonb),
    '$'
  ) as strings
  join public.portfolio_media_assets asset
    on strings.reference_value = 'media://' || asset.id::text
    or (
      asset.public_url is not null
      and asset.public_url <> ''
      and strings.reference_value = asset.public_url
    )
  where asset.status <> 'deleted'
  order by
    strings.json_path,
    case
      when strings.reference_value = 'media://' || asset.id::text then 0
      else 1
    end,
    asset.created_at,
    asset.id;
$function$;

create or replace function public.sync_portfolio_media_references(
  p_scope text,
  p_content jsonb,
  p_revision bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_scope not in ('draft', 'published') then
    raise exception 'Invalid portfolio media reference scope'
      using errcode = '22023';
  end if;

  delete from public.portfolio_media_references
  where scope = p_scope;

  insert into public.portfolio_media_references (
    scope,
    json_path,
    asset_id,
    reference_value,
    revision,
    created_at
  )
  select
    p_scope,
    extracted.json_path,
    extracted.asset_id,
    extracted.reference_value,
    coalesce(p_revision, 0),
    now()
  from public.extract_portfolio_media_references(
    coalesce(p_content, '{}'::jsonb)
  ) as extracted;
end;
$function$;

-- A media:// token is always controlled by this subsystem. Unknown, deleting,
-- or deleted tokens are rejected even in drafts. Public documents additionally
-- require a finalized immutable object whose Storage metadata still exists.
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
    from public.walk_portfolio_string_values(
      coalesce(p_content, '{}'::jsonb),
      '$'
    ) as strings
    where lower(left(strings.reference_value, 8)) = 'media://'
  loop
    if token_record.reference_value !~* '^media://[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'Invalid media token at %', token_record.json_path
        using errcode = '22023';
    end if;

    token_id := substring(token_record.reference_value from 9)::uuid;

    select *
    into media_record
    from public.portfolio_media_assets
    where id = token_id;

    if not found then
      raise exception 'Unknown media token at %', token_record.json_path
        using errcode = '23503';
    end if;

    if media_record.status in ('deleting', 'deleted') then
      raise exception 'Deleted media token at % cannot be saved', token_record.json_path
        using errcode = '23503';
    end if;

    if p_require_public_object then
      if media_record.status not in ('published', 'legacy')
         or media_record.public_bucket is null
         or media_record.public_path is null then
        raise exception 'Media at % must be promoted before publishing', token_record.json_path
          using errcode = '23514';
      end if;

      if not exists (
        select 1
        from storage.objects object
        where object.bucket_id = media_record.public_bucket
          and object.name = media_record.public_path
      ) then
        raise exception 'Published media object is missing at %', token_record.json_path
          using errcode = '23514';
      end if;
    end if;
  end loop;
end;
$function$;

-- Validate and synchronize every future singleton content change, including
-- trusted SQL changes outside the browser RPCs.
create or replace function public.guard_and_sync_portfolio_media()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  public_projection jsonb;
begin
  if tg_op = 'INSERT' then
    perform public.assert_portfolio_media_tokens(new.draft_json, false);
    perform public.sync_portfolio_media_references(
      'draft',
      new.draft_json,
      new.draft_revision
    );
    public_projection := public.sanitize_published_portfolio(
      new.published_json
    );
    perform public.assert_portfolio_media_tokens(public_projection, true);
    perform public.sync_portfolio_media_references(
      'published',
      public_projection,
      new.published_revision
    );
    return new;
  end if;

  if new.draft_json is distinct from old.draft_json then
    perform public.assert_portfolio_media_tokens(new.draft_json, false);
    perform public.sync_portfolio_media_references(
      'draft',
      new.draft_json,
      new.draft_revision
    );
  end if;

  if new.published_json is distinct from old.published_json then
    public_projection := public.sanitize_published_portfolio(
      new.published_json
    );
    perform public.assert_portfolio_media_tokens(public_projection, true);
    perform public.sync_portfolio_media_references(
      'published',
      public_projection,
      new.published_revision
    );
  end if;

  return new;
end;
$function$;

drop trigger if exists portfolio_media_content_guard_trigger
  on public.portfolio_content;

create trigger portfolio_media_content_guard_trigger
after insert or update of draft_json, published_json
on public.portfolio_content
for each row
execute function public.guard_and_sync_portfolio_media();

-- ---------------------------------------------------------------------------
-- Asset serialization, validation, and reservation
-- ---------------------------------------------------------------------------

create or replace function public.portfolio_media_asset_payload(
  p_asset_id uuid
)
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
    'public_url', asset.public_url,
    'replacement_for', asset.replacement_for,
    'legacy_upload_id', asset.legacy_upload_id,
    'created_at', asset.created_at,
    'updated_at', asset.updated_at,
    'upload_finalized_at', asset.upload_finalized_at,
    'promotion_prepared_at', asset.promotion_prepared_at,
    'published_at', asset.published_at,
    'deletion_requested_at', asset.deletion_requested_at,
    'deleted_at', asset.deleted_at,
    'draft_reference_count', (
      select count(*)
      from public.portfolio_media_references reference
      where reference.asset_id = asset.id
        and reference.scope = 'draft'
    ),
    'published_reference_count', (
      select count(*)
      from public.portfolio_media_references reference
      where reference.asset_id = asset.id
        and reference.scope = 'published'
    ),
    'is_referenced', exists (
      select 1
      from public.portfolio_media_references reference
      where reference.asset_id = asset.id
    ),
    'can_delete',
      not exists (
        select 1
        from public.portfolio_media_references reference
        where reference.asset_id = asset.id
      )
      and asset.status not in ('deleting', 'deleted')
      and (
        (
          asset.public_path is null
          and public.has_admin_role(array['owner', 'publisher', 'editor'])
        )
        or public.has_admin_role(array['owner', 'publisher'])
      )
  )
  into result
  from public.portfolio_media_assets asset
  where asset.id = p_asset_id;

  return result;
end;
$function$;

create or replace function public.reserve_portfolio_media_upload(
  p_name text,
  p_mime_type text,
  p_size bigint,
  p_alt_text text,
  p_replacement_for uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := (select auth.uid());
  clean_name text;
  clean_mime text := lower(btrim(coalesce(p_mime_type, '')));
  clean_alt text := coalesce(p_alt_text, '');
  extension text;
  asset_id uuid := gen_random_uuid();
  object_nonce uuid := gen_random_uuid();
  object_path text;
  replaced_asset public.portfolio_media_assets;
  changed_at timestamptz := now();
begin
  if not public.has_admin_role(array['owner', 'publisher', 'editor']) then
    raise exception 'Editor access is required'
      using errcode = '42501';
  end if;

  if actor_id is null then
    raise exception 'An authenticated session is required'
      using errcode = '42501';
  end if;

  clean_name := regexp_replace(
    btrim(coalesce(p_name, '')),
    '[[:cntrl:]]+',
    '_',
    'g'
  );
  clean_name := replace(replace(clean_name, '/', '_'), chr(92), '_');
  clean_name := left(clean_name, 200);

  if clean_name = '' then
    raise exception 'A file name is required'
      using errcode = '22023';
  end if;

  extension := case clean_mime
    when 'image/png' then 'png'
    when 'image/jpeg' then 'jpg'
    when 'image/webp' then 'webp'
    when 'image/gif' then 'gif'
    else null
  end;

  if extension is null then
    raise exception 'Only PNG, JPEG, WebP, and GIF images are allowed'
      using errcode = '22023';
  end if;

  if p_size is null or p_size < 1 or p_size > 3145728 then
    raise exception 'Media size must be between 1 byte and 3 MiB'
      using errcode = '22023';
  end if;

  if length(clean_alt) > 500 then
    raise exception 'Alt text may not exceed 500 characters'
      using errcode = '22023';
  end if;

  if p_replacement_for is not null then
    select *
    into replaced_asset
    from public.portfolio_media_assets
    where id = p_replacement_for
    for update;

    if not found or replaced_asset.status in ('deleting', 'deleted') then
      raise exception 'The media asset being replaced is unavailable'
        using errcode = 'P0002';
    end if;
  end if;

  object_path :=
    actor_id::text || '/' ||
    asset_id::text || '/' ||
    object_nonce::text || '.' ||
    extension;

  insert into public.portfolio_media_assets (
    id,
    owner_id,
    original_name,
    mime_type,
    byte_size,
    alt_text,
    status,
    staging_bucket,
    staging_path,
    replacement_for,
    created_at,
    updated_at
  )
  values (
    asset_id,
    actor_id,
    clean_name,
    clean_mime,
    p_size,
    clean_alt,
    'reserved',
    'portfolio-media-drafts',
    object_path,
    p_replacement_for,
    changed_at,
    changed_at
  );

  insert into public.portfolio_activity_log (
    actor_id,
    action,
    resource_type,
    resource_id,
    metadata,
    created_at
  )
  values (
    actor_id,
    case
      when p_replacement_for is null then 'media.upload_reserved'
      else 'media.replacement_reserved'
    end,
    'media',
    asset_id::text,
    jsonb_build_object(
      'name', clean_name,
      'mime_type', clean_mime,
      'size', p_size,
      'replacement_for', p_replacement_for,
      'staging_bucket', 'portfolio-media-drafts',
      'staging_path', object_path
    ),
    changed_at
  );

  return public.portfolio_media_asset_payload(asset_id);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Browser-facing media metadata RPCs
-- ---------------------------------------------------------------------------

create or replace function public.create_portfolio_media_upload(
  p_name text,
  p_mime_type text,
  p_size bigint,
  p_alt_text text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  return public.reserve_portfolio_media_upload(
    p_name,
    p_mime_type,
    p_size,
    p_alt_text,
    null
  );
end;
$function$;

create or replace function public.create_portfolio_media_replacement(
  p_asset_id uuid,
  p_name text,
  p_mime_type text,
  p_size bigint,
  p_alt_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  replacement_alt text;
begin
  if not public.has_admin_role(array['owner', 'publisher', 'editor']) then
    raise exception 'Editor access is required'
      using errcode = '42501';
  end if;

  if p_alt_text is null then
    select alt_text
    into replacement_alt
    from public.portfolio_media_assets
    where id = p_asset_id;

    if not found then
      raise exception 'Media asset not found'
        using errcode = 'P0002';
    end if;
  else
    replacement_alt := p_alt_text;
  end if;

  return public.reserve_portfolio_media_upload(
    p_name,
    p_mime_type,
    p_size,
    replacement_alt,
    p_asset_id
  );
end;
$function$;

create or replace function public.portfolio_storage_object_matches(
  p_bucket text,
  p_path text,
  p_mime_type text,
  p_size bigint
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from storage.objects object
    where object.bucket_id = p_bucket
      and object.name = p_path
      and lower(coalesce(object.metadata ->> 'mimetype', '')) =
        lower(coalesce(p_mime_type, ''))
      and coalesce(object.metadata ->> 'size', '') =
        coalesce(p_size, -1)::text
  );
$function$;

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
  changed_at timestamptz := now();
begin
  if not public.has_admin_role(array['owner', 'publisher', 'editor']) then
    raise exception 'Editor access is required'
      using errcode = '42501';
  end if;

  if (p_width is null) <> (p_height is null) then
    raise exception 'Width and height must both be supplied or both be omitted'
      using errcode = '22023';
  end if;

  if p_width is not null
     and (
       p_width < 1
       or p_width > 12000
       or p_height < 1
       or p_height > 12000
     ) then
    raise exception 'Media dimensions must be between 1 and 12000 pixels'
      using errcode = '22023';
  end if;

  select *
  into asset
  from public.portfolio_media_assets
  where id = p_asset_id
  for update;

  if not found then
    raise exception 'Media asset not found'
      using errcode = 'P0002';
  end if;

  if asset.status = 'staged' then
    return public.portfolio_media_asset_payload(asset.id);
  end if;

  if asset.status <> 'reserved' then
    raise exception 'Only a reserved media upload can be finalized'
      using errcode = '23514';
  end if;

  if not public.portfolio_storage_object_matches(
    asset.staging_bucket,
    asset.staging_path,
    asset.mime_type,
    asset.byte_size
  ) then
    raise exception 'The staged Storage object is missing or its MIME/size metadata does not match the reservation'
      using errcode = '23514';
  end if;

  update public.portfolio_media_assets
  set status = 'staged',
      width = p_width,
      height = p_height,
      upload_finalized_at = changed_at,
      updated_at = changed_at
  where id = asset.id;

  insert into public.portfolio_activity_log (
    actor_id,
    action,
    resource_type,
    resource_id,
    metadata,
    created_at
  )
  values (
    (select auth.uid()),
    'media.upload_finalized',
    'media',
    asset.id::text,
    jsonb_build_object(
      'mime_type', asset.mime_type,
      'size', asset.byte_size,
      'width', p_width,
      'height', p_height
    ),
    changed_at
  );

  return public.portfolio_media_asset_payload(asset.id);
end;
$function$;

create or replace function public.update_portfolio_media_alt_text(
  p_asset_id uuid,
  p_alt_text text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  asset public.portfolio_media_assets;
  clean_alt text := coalesce(p_alt_text, '');
  changed_at timestamptz := now();
begin
  if not public.has_admin_role(array['owner', 'publisher', 'editor']) then
    raise exception 'Editor access is required'
      using errcode = '42501';
  end if;

  if length(clean_alt) > 500 then
    raise exception 'Alt text may not exceed 500 characters'
      using errcode = '22023';
  end if;

  select *
  into asset
  from public.portfolio_media_assets
  where id = p_asset_id
  for update;

  if not found or asset.status in ('deleting', 'deleted') then
    raise exception 'Media asset not found'
      using errcode = 'P0002';
  end if;

  update public.portfolio_media_assets
  set alt_text = clean_alt,
      updated_at = changed_at
  where id = asset.id;

  insert into public.portfolio_activity_log (
    actor_id,
    action,
    resource_type,
    resource_id,
    metadata,
    created_at
  )
  values (
    (select auth.uid()),
    'media.alt_text_updated',
    'media',
    asset.id::text,
    jsonb_build_object(
      'length', length(clean_alt),
      'published_change_pending', asset.status in ('published', 'legacy')
    ),
    changed_at
  );

  return public.portfolio_media_asset_payload(asset.id);
end;
$function$;

create or replace function public.list_portfolio_media(
  p_offset integer default 0,
  p_limit integer default 50
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
  safe_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  result jsonb;
begin
  if not public.has_admin_role(array['owner', 'publisher', 'editor', 'viewer']) then
    raise exception 'Active admin access is required'
      using errcode = '42501';
  end if;

  with page as (
    select asset.id, asset.created_at
    from public.portfolio_media_assets asset
    where asset.status <> 'deleted'
    order by asset.created_at desc, asset.id
    offset safe_offset
    limit safe_limit
  )
  select jsonb_build_object(
    'items',
      coalesce(
        jsonb_agg(
          public.portfolio_media_asset_payload(page.id)
          order by page.created_at desc, page.id
        ),
        '[]'::jsonb
      ),
    'count',
      (
        select count(*)
        from public.portfolio_media_assets asset
        where asset.status <> 'deleted'
      ),
    'offset', safe_offset,
    'limit', safe_limit
  )
  into result
  from page;

  return result;
end;
$function$;

create or replace function public.get_portfolio_media_usage(
  p_asset_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  if not public.has_admin_role(array['owner', 'publisher', 'editor', 'viewer']) then
    raise exception 'Active admin access is required'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.portfolio_media_assets
    where id = p_asset_id
  ) then
    raise exception 'Media asset not found'
      using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'asset_id', p_asset_id,
    'draft',
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'json_path', reference.json_path,
            'revision', reference.revision
          )
          order by reference.json_path
        ) filter (where reference.scope = 'draft'),
        '[]'::jsonb
      ),
    'published',
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'json_path', reference.json_path,
            'revision', reference.revision
          )
          order by reference.json_path
        ) filter (where reference.scope = 'published'),
        '[]'::jsonb
      ),
    'draft_count',
      count(*) filter (where reference.scope = 'draft'),
    'published_count',
      count(*) filter (where reference.scope = 'published'),
    'is_referenced',
      count(reference.asset_id) > 0
  )
  into result
  from public.portfolio_media_references reference
  where reference.asset_id = p_asset_id;

  return result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Promotion and public manifest
-- ---------------------------------------------------------------------------

create or replace function public.portfolio_media_extension(
  p_mime_type text
)
returns text
language sql
immutable
set search_path = ''
as $function$
  select case lower(coalesce(p_mime_type, ''))
    when 'image/png' then 'png'
    when 'image/jpeg' then 'jpg'
    when 'image/webp' then 'webp'
    when 'image/gif' then 'gif'
    else null
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
  media_record record;
  extension text;
  destination_path text;
  result_items jsonb := '[]'::jsonb;
  promoted_count integer := 0;
  changed_at timestamptz := now();
begin
  if not public.has_admin_role(array['owner', 'publisher']) then
    raise exception 'Publisher access is required'
      using errcode = '42501';
  end if;

  select draft_json, draft_revision
  into draft_content, current_revision
  from public.portfolio_content
  where id = 1
  for update;

  if not found then
    raise exception 'Portfolio content row not found'
      using errcode = 'P0002';
  end if;

  if current_revision is distinct from coalesce(p_expected_draft_revision, 0) then
    raise exception 'The draft changed in another session. Reload before preparing media.'
      using errcode = '40001';
  end if;

  public_draft := public.sanitize_published_portfolio(draft_content);
  perform public.assert_portfolio_media_tokens(public_draft, false);

  for media_record in
    select distinct asset.*
    from public.extract_portfolio_media_references(public_draft) reference
    join public.portfolio_media_assets asset
      on asset.id = reference.asset_id
    order by asset.id
  loop
    if media_record.status in ('published', 'legacy') then
      continue;
    end if;

    if media_record.status = 'reserved' then
      raise exception 'Media % must finish uploading before promotion', media_record.id
        using errcode = '23514';
    end if;

    if media_record.status = 'staged' then
      if not public.portfolio_storage_object_matches(
        media_record.staging_bucket,
        media_record.staging_path,
        media_record.mime_type,
        media_record.byte_size
      ) then
        raise exception 'Staged media object % is missing or invalid', media_record.id
          using errcode = '23514';
      end if;

      extension := public.portfolio_media_extension(media_record.mime_type);
      if extension is null then
        raise exception 'Media % has an unsupported MIME type', media_record.id
          using errcode = '23514';
      end if;

      destination_path :=
        'assets/' ||
        media_record.id::text || '/' ||
        gen_random_uuid()::text || '.' ||
        extension;

      update public.portfolio_media_assets
      set status = 'promoting',
          public_bucket = 'portfolio-media-public',
          public_path = destination_path,
          promotion_prepared_at = changed_at,
          updated_at = changed_at
      where id = media_record.id;

      media_record.status := 'promoting';
      media_record.public_bucket := 'portfolio-media-public';
      media_record.public_path := destination_path;
      promoted_count := promoted_count + 1;
    elsif media_record.status <> 'promoting' then
      raise exception 'Media % is not in a promotable state', media_record.id
        using errcode = '23514';
    end if;

    result_items := result_items || jsonb_build_array(
      jsonb_build_object(
        'asset_id', media_record.id,
        'reference_token', 'media://' || media_record.id::text,
        'source_bucket', media_record.staging_bucket,
        'source_path', media_record.staging_path,
        'destination_bucket', media_record.public_bucket,
        'destination_path', media_record.public_path,
        'mime_type', media_record.mime_type,
        'size', media_record.byte_size
      )
    );
  end loop;

  insert into public.portfolio_activity_log (
    actor_id,
    action,
    resource_type,
    resource_id,
    metadata,
    created_at
  )
  values (
    (select auth.uid()),
    'media.promotion_prepared',
    'portfolio',
    'main',
    jsonb_build_object(
      'draft_revision', current_revision,
      'new_promotions', promoted_count,
      'copy_items', jsonb_array_length(result_items)
    ),
    changed_at
  );

  return jsonb_build_object(
    'draft_revision', current_revision,
    'items', result_items
  );
end;
$function$;

create or replace function public.finalize_portfolio_media_promotion(
  p_asset_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  asset public.portfolio_media_assets;
  changed_at timestamptz := now();
begin
  if not public.has_admin_role(array['owner', 'publisher']) then
    raise exception 'Publisher access is required'
      using errcode = '42501';
  end if;

  select *
  into asset
  from public.portfolio_media_assets
  where id = p_asset_id
  for update;

  if not found then
    raise exception 'Media asset not found'
      using errcode = 'P0002';
  end if;

  if asset.status in ('published', 'legacy') then
    return public.portfolio_media_asset_payload(asset.id);
  end if;

  if asset.status <> 'promoting' then
    raise exception 'Media must be prepared before promotion can be finalized'
      using errcode = '23514';
  end if;

  if not public.portfolio_storage_object_matches(
    asset.staging_bucket,
    asset.staging_path,
    asset.mime_type,
    asset.byte_size
  ) then
    raise exception 'The private source object is missing or invalid'
      using errcode = '23514';
  end if;

  if not public.portfolio_storage_object_matches(
    asset.public_bucket,
    asset.public_path,
    asset.mime_type,
    asset.byte_size
  ) then
    raise exception 'The copied public object is missing or invalid'
      using errcode = '23514';
  end if;

  update public.portfolio_media_assets
  set status = 'published',
      published_at = changed_at,
      updated_at = changed_at
  where id = asset.id;

  insert into public.portfolio_activity_log (
    actor_id,
    action,
    resource_type,
    resource_id,
    metadata,
    created_at
  )
  values (
    (select auth.uid()),
    'media.promotion_finalized',
    'media',
    asset.id::text,
    jsonb_build_object(
      'public_bucket', asset.public_bucket,
      'public_path', asset.public_path
    ),
    changed_at
  );

  return public.portfolio_media_asset_payload(asset.id);
end;
$function$;

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
  select public_enabled
  into site_enabled
  from public.portfolio_content
  where id = 1;

  if not found or not coalesce(site_enabled, true) then
    return '{}'::jsonb;
  end if;

  select coalesce(
    jsonb_object_agg(
      'media://' || asset.id::text,
      jsonb_build_object(
        'asset_id', asset.id,
        'bucket', asset.public_bucket,
        'path', asset.public_path,
        'public_url', asset.public_url,
        'mime_type', asset.mime_type,
        'width', asset.width,
        'height', asset.height,
        'alt_text', asset.published_alt_text
      )
    ),
    '{}'::jsonb
  )
  into result
  from public.portfolio_media_assets asset
  where asset.status in ('published', 'legacy')
    and asset.public_bucket is not null
    and asset.public_path is not null
    and exists (
      select 1
      from public.portfolio_media_references reference
      where reference.asset_id = asset.id
        and reference.scope = 'published'
    )
    and exists (
      select 1
      from storage.objects object
      where object.bucket_id = asset.public_bucket
        and object.name = asset.public_path
    );

  return result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Reference-guarded, recoverable deletion
-- ---------------------------------------------------------------------------

create or replace function public.request_portfolio_media_deletion(
  p_asset_id uuid
)
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
  if not public.has_admin_role(array['owner', 'publisher', 'editor']) then
    raise exception 'Editor access is required'
      using errcode = '42501';
  end if;

  select *
  into asset
  from public.portfolio_media_assets
  where id = p_asset_id
  for update;

  if not found or asset.status = 'deleted' then
    raise exception 'Media asset not found'
      using errcode = 'P0002';
  end if;

  if asset.public_path is not null or asset.status in ('published', 'legacy') then
    if not public.has_admin_role(array['owner', 'publisher']) then
      raise exception 'Publisher access is required to delete public media'
        using errcode = '42501';
    end if;
  elsif not public.has_admin_role(array['owner', 'publisher', 'editor']) then
    raise exception 'Editor access is required'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.portfolio_media_references reference
    where reference.asset_id = asset.id
  ) then
    raise exception 'Media is referenced by the current draft or published content'
      using errcode = '23503';
  end if;

  if asset.status <> 'deleting' then
    update public.portfolio_media_assets
    set status = 'deleting',
        deletion_requested_at = changed_at,
        updated_at = changed_at
    where id = asset.id;

    insert into public.portfolio_activity_log (
      actor_id,
      action,
      resource_type,
      resource_id,
      metadata,
      created_at
    )
    values (
      (select auth.uid()),
      'media.deletion_requested',
      'media',
      asset.id::text,
      jsonb_build_object(
        'had_staging_object', asset.staging_path is not null,
        'had_public_object', asset.public_path is not null
      ),
      changed_at
    );
  end if;

  if asset.staging_bucket is not null and asset.staging_path is not null then
    objects := objects || jsonb_build_array(
      jsonb_build_object(
        'bucket', asset.staging_bucket,
        'path', asset.staging_path
      )
    );
  end if;

  if asset.public_bucket is not null and asset.public_path is not null then
    objects := objects || jsonb_build_array(
      jsonb_build_object(
        'bucket', asset.public_bucket,
        'path', asset.public_path
      )
    );
  end if;

  return jsonb_build_object(
    'asset_id', asset.id,
    'status', 'deleting',
    'objects', objects
  );
end;
$function$;

create or replace function public.finalize_portfolio_media_deletion(
  p_asset_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  asset public.portfolio_media_assets;
  changed_at timestamptz := now();
begin
  if not public.has_admin_role(array['owner', 'publisher', 'editor']) then
    raise exception 'Editor access is required'
      using errcode = '42501';
  end if;

  select *
  into asset
  from public.portfolio_media_assets
  where id = p_asset_id
  for update;

  if not found then
    raise exception 'Media asset not found'
      using errcode = 'P0002';
  end if;

  if asset.public_path is not null or asset.status in ('published', 'legacy') then
    if not public.has_admin_role(array['owner', 'publisher']) then
      raise exception 'Publisher access is required to delete public media'
        using errcode = '42501';
    end if;
  elsif not public.has_admin_role(array['owner', 'publisher', 'editor']) then
    raise exception 'Editor access is required'
      using errcode = '42501';
  end if;

  if asset.status = 'deleted' then
    return public.portfolio_media_asset_payload(asset.id);
  end if;

  if asset.status <> 'deleting' then
    raise exception 'Media deletion must be requested before it is finalized'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.portfolio_media_references reference
    where reference.asset_id = asset.id
  ) then
    raise exception 'Media became referenced again; deletion cannot be finalized'
      using errcode = '23503';
  end if;

  if exists (
    select 1
    from storage.objects object
    where (
      object.bucket_id = asset.staging_bucket
      and object.name = asset.staging_path
    )
    or (
      object.bucket_id = asset.public_bucket
      and object.name = asset.public_path
    )
  ) then
    raise exception 'Storage objects still exist; remove them before finalizing deletion'
      using errcode = '23514';
  end if;

  update public.portfolio_media_assets
  set status = 'deleted',
      deleted_at = changed_at,
      updated_at = changed_at
  where id = asset.id;

  insert into public.portfolio_activity_log (
    actor_id,
    action,
    resource_type,
    resource_id,
    metadata,
    created_at
  )
  values (
    (select auth.uid()),
    'media.deleted',
    'media',
    asset.id::text,
    jsonb_build_object(
      'staging_bucket', asset.staging_bucket,
      'staging_path', asset.staging_path,
      'public_bucket', asset.public_bucket,
      'public_path', asset.public_path
    ),
    changed_at
  );

  return public.portfolio_media_asset_payload(asset.id);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Publish gate: content publication cannot outrun media promotion
-- ---------------------------------------------------------------------------

create or replace function public.publish_portfolio(
  p_expected_draft_revision bigint
)
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
  if not public.has_admin_role(array['owner', 'publisher']) then
    raise exception 'Publisher access is required'
      using errcode = '42501';
  end if;

  select draft_json, draft_revision, published_revision
  into draft_content, current_draft_revision, current_published_revision
  from public.portfolio_content
  where id = 1
  for update;

  if not found then
    raise exception 'Portfolio content row not found'
      using errcode = 'P0002';
  end if;

  if current_draft_revision is distinct from coalesce(p_expected_draft_revision, 0) then
    raise exception 'The draft changed in another session. Reload before publishing.'
      using errcode = '40001';
  end if;

  validated_content := public.validate_portfolio_content(draft_content);
  schema_version := public.portfolio_content_schema_version(validated_content);
  public_content := public.sanitize_published_portfolio(validated_content);

  -- Hidden/unpublished records remain in the internal snapshot but their media
  -- does not need promotion and never enters the public reference manifest.
  perform public.assert_portfolio_media_tokens(public_content, true);

  next_published_revision := current_published_revision + 1;

  update public.portfolio_content
  set draft_json = validated_content,
      draft_schema_version = schema_version,
      published_json = validated_content,
      published_schema_version = schema_version,
      published_revision = next_published_revision,
      public_enabled = true,
      unpublished_at = null,
      published_by = (select auth.uid()),
      published_at = changed_at
  where id = 1;

  -- Alt text follows the content approval boundary. Editors may update the
  -- draft value, but anonymous manifest callers receive only this copy.
  update public.portfolio_media_assets asset
  set published_alt_text = asset.alt_text,
      updated_at = changed_at
  where asset.id in (
    select distinct reference.asset_id
    from public.extract_portfolio_media_references(public_content) reference
  );

  insert into public.portfolio_revisions (
    revision, kind, content_json, created_by, created_at
  )
  values (
    next_published_revision,
    'published',
    validated_content,
    (select auth.uid()),
    changed_at
  )
  on conflict (kind, revision) do nothing;

  insert into public.portfolio_activity_log (
    actor_id, action, resource_type, resource_id, metadata, created_at
  )
  values (
    (select auth.uid()),
    'portfolio.published',
    'portfolio',
    'main',
    jsonb_build_object(
      'draft_revision', current_draft_revision,
      'published_revision', next_published_revision,
      'schema_version', schema_version,
      'published_media_count', (
        select count(distinct reference.asset_id)
        from public.extract_portfolio_media_references(public_content) reference
      )
    ),
    changed_at
  );

  insert into public.portfolio_publish_events (
    published_revision, created_at
  )
  values (
    next_published_revision, changed_at
  );

  return jsonb_build_object(
    'published_json', public_content,
    'published_revision', next_published_revision,
    'schema_version', schema_version,
    'public_enabled', true,
    'published_at', changed_at
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Storage authorization helpers
-- ---------------------------------------------------------------------------

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
  select
    p_bucket = 'portfolio-media-drafts'
    and public.has_admin_role(array['owner', 'publisher', 'editor'])
    and exists (
      select 1
      from public.portfolio_media_assets asset
      where asset.owner_id = (select auth.uid())
        and asset.status = 'reserved'
        and asset.staging_bucket = p_bucket
        and asset.staging_path = p_path
        and lower(coalesce(p_metadata ->> 'mimetype', '')) = asset.mime_type
        and coalesce(p_metadata ->> 'size', '') = asset.byte_size::text
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
  select
    p_bucket = 'portfolio-media-public'
    and public.has_admin_role(array['owner', 'publisher'])
    and exists (
      select 1
      from public.portfolio_media_assets asset
      where asset.status = 'promoting'
        and asset.public_bucket = p_bucket
        and asset.public_path = p_path
        and lower(coalesce(p_metadata ->> 'mimetype', '')) = asset.mime_type
        and coalesce(p_metadata ->> 'size', '') = asset.byte_size::text
    );
$function$;

create or replace function public.can_read_portfolio_media_private_object(
  p_bucket text,
  p_path text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    p_bucket = 'portfolio-media-drafts'
    and public.has_admin_role(array['owner', 'publisher', 'editor', 'viewer'])
    and exists (
      select 1
      from public.portfolio_media_assets asset
      where asset.staging_bucket = p_bucket
        and asset.staging_path = p_path
        and asset.status <> 'deleted'
    );
$function$;

create or replace function public.can_delete_portfolio_media_object(
  p_bucket text,
  p_path text
)
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
          asset.staging_bucket = p_bucket
          and asset.staging_path = p_path
          and (
            (
              asset.public_path is null
              and public.has_admin_role(array['owner', 'publisher', 'editor'])
            )
            or public.has_admin_role(array['owner', 'publisher'])
          )
        )
        or (
          asset.public_bucket = p_bucket
          and asset.public_path = p_path
          and public.has_admin_role(array['owner', 'publisher'])
        )
      )
      and not exists (
        select 1
        from public.portfolio_media_references reference
        where reference.asset_id = asset.id
      )
  );
$function$;

-- Keep the legacy compatibility helper fail-closed and backed by canonical
-- reference rows. Direct legacy table/object deletion is revoked below.
create or replace function public.can_delete_portfolio_upload(
  p_storage_path text
)
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
      and public.has_admin_role(array['owner', 'publisher'])
      and not exists (
        select 1
        from public.portfolio_media_references reference
        where reference.asset_id = asset.id
      )
  );
$function$;

-- ---------------------------------------------------------------------------
-- Legacy metadata bridge
-- ---------------------------------------------------------------------------

insert into public.portfolio_media_assets (
  id,
  owner_id,
  original_name,
  mime_type,
  byte_size,
  alt_text,
  published_alt_text,
  status,
  public_bucket,
  public_path,
  public_url,
  legacy_upload_id,
  upload_finalized_at,
  published_at,
  created_at,
  updated_at
)
select
  upload.id,
  upload.owner_id,
  left(
    coalesce(
      nullif(
        replace(
          replace(
            regexp_replace(
              btrim(upload.name),
              '[[:cntrl:]]+',
              '_',
              'g'
            ),
            '/',
            '_'
          ),
          chr(92),
          '_'
        ),
        ''
      ),
      'legacy-media-' || upload.id::text
    ),
    200
  ),
  lower(coalesce(nullif(btrim(upload.mime_type), ''), 'application/octet-stream')),
  least(greatest(coalesce(upload.size, 0), 0), 3145728),
  left(coalesce(upload.alt_text, ''), 500),
  left(coalesce(upload.alt_text, ''), 500),
  'legacy',
  'portfolio-uploads',
  upload.storage_path,
  upload.public_url,
  upload.id,
  upload.created_at,
  upload.created_at,
  upload.created_at,
  coalesce(upload.updated_at, upload.created_at)
from public.portfolio_uploads upload
on conflict (id) do nothing;

alter table public.portfolio_uploads
  add column if not exists media_asset_id uuid
    references public.portfolio_media_assets(id) on delete set null;

update public.portfolio_uploads upload
set media_asset_id = upload.id
where upload.media_asset_id is distinct from upload.id
  and exists (
    select 1
    from public.portfolio_media_assets asset
    where asset.id = upload.id
  );

-- Legacy metadata remains readable for compatibility, but browser writes now
-- go exclusively through the canonical RPCs.
revoke all on table public.portfolio_uploads from anon, authenticated;
grant select on table public.portfolio_uploads to authenticated;

drop policy if exists "Editors can insert uploads"
  on public.portfolio_uploads;
drop policy if exists "Editors can update uploads"
  on public.portfolio_uploads;
drop policy if exists "Editors can delete uploads"
  on public.portfolio_uploads;
drop policy if exists "Authenticated users can manage uploads"
  on public.portfolio_uploads;

-- Backfill current references after canonicalizing legacy metadata. Published
-- references follow the same visibility projection anonymous callers receive.
do $backfill$
declare
  content_row public.portfolio_content;
begin
  select *
  into content_row
  from public.portfolio_content
  where id = 1;

  if found then
    perform public.sync_portfolio_media_references(
      'draft',
      content_row.draft_json,
      content_row.draft_revision
    );
    perform public.sync_portfolio_media_references(
      'published',
      public.sanitize_published_portfolio(content_row.published_json),
      content_row.published_revision
    );
  end if;
end
$backfill$;

-- ---------------------------------------------------------------------------
-- Buckets and immutable Storage policies
-- ---------------------------------------------------------------------------

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values
  (
    'portfolio-media-drafts',
    'portfolio-media-drafts',
    false,
    3145728,
    array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
  ),
  (
    'portfolio-media-public',
    'portfolio-media-public',
    true,
    3145728,
    array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
  )
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Remove the old mutable/public-upload policies and any prior Phase 4 policy
-- definitions. No UPDATE policy is recreated for any managed media bucket.
drop policy if exists "Public can view uploads" on storage.objects;
drop policy if exists "Authenticated users can upload" on storage.objects;
drop policy if exists "Authenticated users can delete uploads" on storage.objects;
drop policy if exists "Active admins can view portfolio objects" on storage.objects;
drop policy if exists "Editors can upload portfolio objects" on storage.objects;
drop policy if exists "Editors can update portfolio objects" on storage.objects;
drop policy if exists "Editors can delete portfolio objects" on storage.objects;

drop policy if exists "Phase4 admins read private media" on storage.objects;
drop policy if exists "Phase4 editors insert reserved private media" on storage.objects;
drop policy if exists "Phase4 admins delete requested private media" on storage.objects;
drop policy if exists "Phase4 public reads published media" on storage.objects;
drop policy if exists "Phase4 publishers insert prepared public media" on storage.objects;
drop policy if exists "Phase4 publishers delete requested public media" on storage.objects;
drop policy if exists "Phase4 admins read legacy media" on storage.objects;
drop policy if exists "Phase4 publishers delete requested legacy media" on storage.objects;

create policy "Phase4 admins read private media"
on storage.objects
for select
to authenticated
using (
  public.can_read_portfolio_media_private_object(bucket_id, name)
);

create policy "Phase4 editors insert reserved private media"
on storage.objects
for insert
to authenticated
with check (
  public.can_insert_portfolio_media_draft_object(
    bucket_id,
    name,
    metadata
  )
);

create policy "Phase4 admins delete requested private media"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'portfolio-media-drafts'
  and public.can_delete_portfolio_media_object(bucket_id, name)
);

create policy "Phase4 public reads published media"
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'portfolio-media-public'
);

create policy "Phase4 publishers insert prepared public media"
on storage.objects
for insert
to authenticated
with check (
  public.can_insert_portfolio_media_public_object(
    bucket_id,
    name,
    metadata
  )
);

create policy "Phase4 publishers delete requested public media"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'portfolio-media-public'
  and public.can_delete_portfolio_media_object(bucket_id, name)
);

create policy "Phase4 admins read legacy media"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'portfolio-uploads'
  and public.has_admin_role(array['owner', 'publisher', 'editor', 'viewer'])
);

create policy "Phase4 publishers delete requested legacy media"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'portfolio-uploads'
  and public.can_delete_portfolio_media_object(bucket_id, name)
);

-- ---------------------------------------------------------------------------
-- Explicit function ACLs
-- ---------------------------------------------------------------------------

revoke all on function public.walk_portfolio_string_values(jsonb, text)
  from public, anon, authenticated;
revoke all on function public.extract_portfolio_media_references(jsonb)
  from public, anon, authenticated;
revoke all on function public.sync_portfolio_media_references(text, jsonb, bigint)
  from public, anon, authenticated;
revoke all on function public.assert_portfolio_media_tokens(jsonb, boolean)
  from public, anon, authenticated;
revoke all on function public.guard_and_sync_portfolio_media()
  from public, anon, authenticated;
revoke all on function public.portfolio_media_asset_payload(uuid)
  from public, anon, authenticated;
revoke all on function public.reserve_portfolio_media_upload(text, text, bigint, text, uuid)
  from public, anon, authenticated;
revoke all on function public.portfolio_storage_object_matches(text, text, text, bigint)
  from public, anon, authenticated;
revoke all on function public.portfolio_media_extension(text)
  from public, anon, authenticated;

revoke all on function public.create_portfolio_media_upload(text, text, bigint, text)
  from public, anon, authenticated;
revoke all on function public.create_portfolio_media_replacement(uuid, text, text, bigint, text)
  from public, anon, authenticated;
revoke all on function public.finalize_portfolio_media_upload(uuid, integer, integer)
  from public, anon, authenticated;
revoke all on function public.update_portfolio_media_alt_text(uuid, text)
  from public, anon, authenticated;
revoke all on function public.list_portfolio_media(integer, integer)
  from public, anon, authenticated;
revoke all on function public.get_portfolio_media_usage(uuid)
  from public, anon, authenticated;
revoke all on function public.prepare_portfolio_media_promotion(bigint)
  from public, anon, authenticated;
revoke all on function public.finalize_portfolio_media_promotion(uuid)
  from public, anon, authenticated;
revoke all on function public.get_public_media_manifest()
  from public, anon, authenticated;
revoke all on function public.request_portfolio_media_deletion(uuid)
  from public, anon, authenticated;
revoke all on function public.finalize_portfolio_media_deletion(uuid)
  from public, anon, authenticated;
revoke all on function public.publish_portfolio(bigint)
  from public, anon, authenticated;

revoke all on function public.can_insert_portfolio_media_draft_object(text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.can_insert_portfolio_media_public_object(text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.can_read_portfolio_media_private_object(text, text)
  from public, anon, authenticated;
revoke all on function public.can_delete_portfolio_media_object(text, text)
  from public, anon, authenticated;
revoke all on function public.can_delete_portfolio_upload(text)
  from public, anon, authenticated;

grant execute on function public.create_portfolio_media_upload(text, text, bigint, text)
  to authenticated;
grant execute on function public.create_portfolio_media_replacement(uuid, text, text, bigint, text)
  to authenticated;
grant execute on function public.finalize_portfolio_media_upload(uuid, integer, integer)
  to authenticated;
grant execute on function public.update_portfolio_media_alt_text(uuid, text)
  to authenticated;
grant execute on function public.list_portfolio_media(integer, integer)
  to authenticated;
grant execute on function public.get_portfolio_media_usage(uuid)
  to authenticated;
grant execute on function public.prepare_portfolio_media_promotion(bigint)
  to authenticated;
grant execute on function public.finalize_portfolio_media_promotion(uuid)
  to authenticated;
grant execute on function public.request_portfolio_media_deletion(uuid)
  to authenticated;
grant execute on function public.finalize_portfolio_media_deletion(uuid)
  to authenticated;
grant execute on function public.publish_portfolio(bigint)
  to authenticated;

grant execute on function public.get_public_media_manifest()
  to anon, authenticated;

-- Storage RLS policies invoke these narrowly scoped predicates.
grant execute on function public.can_insert_portfolio_media_draft_object(text, text, jsonb)
  to authenticated;
grant execute on function public.can_insert_portfolio_media_public_object(text, text, jsonb)
  to authenticated;
grant execute on function public.can_read_portfolio_media_private_object(text, text)
  to authenticated;
grant execute on function public.can_delete_portfolio_media_object(text, text)
  to authenticated;
grant execute on function public.can_delete_portfolio_upload(text)
  to authenticated;

commit;
