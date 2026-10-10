-- Phase 3: formalize the persisted portfolio document contract without
-- replacing the existing singleton snapshot model or changing browser-facing
-- RPC signatures.
--
-- Compatibility rules:
--   * Documents without a version marker are legacy schema v1.
--   * `schema_version` is accepted as a temporary input alias.
--   * Every new server write is canonicalized to numeric `schemaVersion: 1`.
--   * Full published snapshots remain available to authorized admins.
--   * Anonymous/authenticated public reads receive only the sanitized
--     projection of that snapshot.

begin;

alter table public.portfolio_content
  add column if not exists draft_schema_version integer not null default 1,
  add column if not exists published_schema_version integer not null default 1,
  add column if not exists public_enabled boolean not null default true,
  add column if not exists unpublished_at timestamptz;

do $migration$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.portfolio_content'::regclass
      and conname = 'portfolio_content_draft_schema_version_positive'
  ) then
    alter table public.portfolio_content
      add constraint portfolio_content_draft_schema_version_positive
      check (draft_schema_version > 0) not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.portfolio_content'::regclass
      and conname = 'portfolio_content_published_schema_version_positive'
  ) then
    alter table public.portfolio_content
      add constraint portfolio_content_published_schema_version_positive
      check (published_schema_version > 0) not valid;
  end if;
end
$migration$;

-- One explicit constant for this migration's document contract. A future
-- schema migration replaces this function together with its validator.
create or replace function public.portfolio_supported_schema_version()
returns integer
language sql
immutable
set search_path = ''
as $function$
  select 1;
$function$;

-- Resolve the version before validating the rest of the document. The legacy
-- snake_case spelling is accepted only so an already-saved transitional
-- document can be upgraded without data loss.
create or replace function public.portfolio_content_schema_version(
  p_content jsonb
)
returns integer
language plpgsql
immutable
set search_path = ''
as $function$
declare
  camel_version jsonb;
  snake_version jsonb;
  requested_version integer;
  supported_version integer;
  version_text text;
begin
  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception 'Portfolio content must be a JSON object'
      using errcode = '22023';
  end if;

  camel_version := p_content -> 'schemaVersion';
  snake_version := p_content -> 'schema_version';

  if camel_version is not null
     and snake_version is not null
     and camel_version is distinct from snake_version then
    raise exception 'Conflicting portfolio schema version markers'
      using errcode = '22023';
  end if;

  camel_version := coalesce(camel_version, snake_version);

  -- Absence is the pre-versioning representation of schema v1.
  if camel_version is null then
    return public.portfolio_supported_schema_version();
  end if;

  version_text := camel_version #>> '{}';
  if jsonb_typeof(camel_version) <> 'number'
     or version_text !~ '^[1-9][0-9]*$'
     or length(version_text) > 9 then
    raise exception 'Portfolio schemaVersion must be a positive integer'
      using errcode = '22023';
  end if;

  requested_version := version_text::integer;
  supported_version := public.portfolio_supported_schema_version();

  if requested_version <> supported_version then
    raise exception 'Unsupported portfolio schemaVersion %. This server supports schemaVersion %.',
      requested_version,
      supported_version
      using errcode = '22023';
  end if;

  return requested_version;
end;
$function$;

-- Shared structural checks for the record arrays used by navigation,
-- services, projects, and selected work.
create or replace function public.assert_portfolio_record_array(
  p_items jsonb,
  p_path text,
  p_max_items integer,
  p_require_id boolean default true,
  p_visibility_flag text default null
)
returns void
language plpgsql
immutable
set search_path = ''
as $function$
declare
  item jsonb;
  duplicate_id text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception '% must be a JSON array', p_path
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) > p_max_items then
    raise exception '% exceeds the maximum of % records', p_path, p_max_items
      using errcode = '22023';
  end if;

  for item in
    select value
    from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(item) <> 'object' then
      raise exception '% may contain only JSON objects', p_path
        using errcode = '22023';
    end if;

    if p_require_id and (
      not (item ? 'id')
      or jsonb_typeof(item -> 'id') <> 'string'
      or length(btrim(item ->> 'id')) = 0
      or length(item ->> 'id') > 200
    ) then
      raise exception '% records require a non-empty string id of at most 200 characters', p_path
        using errcode = '22023';
    end if;

    if item ? 'is_published'
       and jsonb_typeof(item -> 'is_published') <> 'boolean' then
      raise exception '%.is_published must be a boolean when present', p_path
        using errcode = '22023';
    end if;

    if p_visibility_flag is not null
       and item ? p_visibility_flag
       and jsonb_typeof(item -> p_visibility_flag) <> 'boolean' then
      raise exception '%.% must be a boolean when present', p_path, p_visibility_flag
        using errcode = '22023';
    end if;

    if item ? 'slug'
       and (
         jsonb_typeof(item -> 'slug') <> 'string'
         or length(item ->> 'slug') > 200
       ) then
      raise exception '%.slug must be a string of at most 200 characters', p_path
        using errcode = '22023';
    end if;

    if item ? 'project_id'
       and (
         jsonb_typeof(item -> 'project_id') <> 'string'
         or length(item ->> 'project_id') > 200
       ) then
      raise exception '%.project_id must be a string of at most 200 characters', p_path
        using errcode = '22023';
    end if;

    if item ? 'gallery_images' then
      if jsonb_typeof(item -> 'gallery_images') <> 'array' then
        raise exception '%.gallery_images must be a JSON array', p_path
          using errcode = '22023';
      end if;
      if jsonb_array_length(item -> 'gallery_images') > 100 then
        raise exception '%.gallery_images exceeds the maximum of 100 images per record', p_path
          using errcode = '22023';
      end if;
    end if;
  end loop;

  if p_require_id then
    select entry ->> 'id'
    into duplicate_id
    from jsonb_array_elements(p_items) as records(entry)
    group by entry ->> 'id'
    having count(*) > 1
    limit 1;

    if duplicate_id is not null then
      raise exception '% contains duplicate id "%"', p_path, duplicate_id
        using errcode = '22023';
    end if;
  end if;
end;
$function$;

-- Validate schema v1 and return its canonical representation. This is a
-- contract validator rather than a copy validator: leaf copy remains flexible,
-- while the routing, publication, and collection shapes relied on by the
-- application are enforced server-side.
create or replace function public.validate_portfolio_content(
  p_content jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  schema_version integer;
  canonical_content jsonb;
  case_key text;
  case_value jsonb;
  case_count integer;
  tech_value jsonb;
begin
  schema_version := public.portfolio_content_schema_version(p_content);

  if octet_length(p_content::text) > 2097152 then
    raise exception 'Portfolio content exceeds the 2 MiB document limit'
      using errcode = '22023';
  end if;

  if not (p_content ? 'site')
     or jsonb_typeof(p_content -> 'site') <> 'object' then
    raise exception 'Portfolio content requires a site object'
      using errcode = '22023';
  end if;

  if not (p_content ? 'studios')
     or jsonb_typeof(p_content -> 'studios') <> 'object'
     or jsonb_typeof(p_content #> '{studios,graphic}') is distinct from 'object'
     or jsonb_typeof(p_content #> '{studios,webdev}') is distinct from 'object' then
    raise exception 'Portfolio content requires graphic and webdev studio objects'
      using errcode = '22023';
  end if;

  if not (p_content ? 'services')
     or jsonb_typeof(p_content -> 'services') <> 'object' then
    raise exception 'Portfolio content requires a services object'
      using errcode = '22023';
  end if;

  if not (p_content ? 'projects')
     or jsonb_typeof(p_content -> 'projects') <> 'object' then
    raise exception 'Portfolio content requires a projects object'
      using errcode = '22023';
  end if;

  if not (p_content ? 'works')
     or jsonb_typeof(p_content -> 'works') <> 'object' then
    raise exception 'Portfolio content requires a works object'
      using errcode = '22023';
  end if;

  if not (p_content ? 'cases')
     or jsonb_typeof(p_content -> 'cases') <> 'object' then
    raise exception 'Portfolio content requires a cases object'
      using errcode = '22023';
  end if;

  perform public.assert_portfolio_record_array(
    p_content #> '{services,graphic}',
    'services.graphic',
    250,
    true,
    'is_active'
  );
  perform public.assert_portfolio_record_array(
    p_content #> '{services,webdev}',
    'services.webdev',
    250,
    true,
    'is_active'
  );
  perform public.assert_portfolio_record_array(
    p_content #> '{projects,graphic}',
    'projects.graphic',
    2000
  );
  perform public.assert_portfolio_record_array(
    p_content #> '{projects,webdev}',
    'projects.webdev',
    2000
  );
  perform public.assert_portfolio_record_array(
    p_content #> '{works,graphic}',
    'works.graphic',
    1000
  );
  perform public.assert_portfolio_record_array(
    p_content #> '{works,webdev}',
    'works.webdev',
    1000
  );

  if p_content #> '{site,navigation}' is not null then
    perform public.assert_portfolio_record_array(
      p_content #> '{site,navigation}',
      'site.navigation',
      100,
      true,
      'is_visible'
    );
  end if;

  if p_content #> '{site,socialLinks}' is not null then
    perform public.assert_portfolio_record_array(
      p_content #> '{site,socialLinks}',
      'site.socialLinks',
      100,
      true,
      'is_visible'
    );
  end if;

  if p_content #> '{site,contact}' is not null
     and jsonb_typeof(p_content #> '{site,contact}') <> 'object' then
    raise exception 'site.contact must be a JSON object'
      using errcode = '22023';
  end if;

  if p_content #> '{site,footer}' is not null
     and jsonb_typeof(p_content #> '{site,footer}') <> 'object' then
    raise exception 'site.footer must be a JSON object'
      using errcode = '22023';
  end if;

  if p_content #> '{site,seo}' is not null
     and jsonb_typeof(p_content #> '{site,seo}') <> 'object' then
    raise exception 'site.seo must be a JSON object'
      using errcode = '22023';
  end if;

  if p_content -> 'integrations' is not null
     and jsonb_typeof(p_content -> 'integrations') <> 'object' then
    raise exception 'integrations must be a JSON object'
      using errcode = '22023';
  end if;

  if p_content -> 'techStack' is not null then
    if jsonb_typeof(p_content -> 'techStack') <> 'array' then
      raise exception 'techStack must be a JSON array'
        using errcode = '22023';
    end if;

    if jsonb_array_length(p_content -> 'techStack') > 200 then
      raise exception 'techStack exceeds the maximum of 200 entries'
        using errcode = '22023';
    end if;

    for tech_value in
      select value
      from jsonb_array_elements(p_content -> 'techStack')
    loop
      if jsonb_typeof(tech_value) <> 'string'
         or length(tech_value #>> '{}') > 100 then
        raise exception 'techStack entries must be strings of at most 100 characters'
          using errcode = '22023';
      end if;
    end loop;
  end if;

  select count(*)
  into case_count
  from jsonb_object_keys(p_content -> 'cases');

  if case_count > 2000 then
    raise exception 'cases exceeds the maximum of 2000 records'
      using errcode = '22023';
  end if;

  for case_key, case_value in
    select key, value
    from jsonb_each(p_content -> 'cases')
  loop
    if length(btrim(case_key)) = 0 or length(case_key) > 200 then
      raise exception 'Case keys must contain 1 to 200 characters'
        using errcode = '22023';
    end if;

    if jsonb_typeof(case_value) <> 'object' then
      raise exception 'Case "%" must be a JSON object', case_key
        using errcode = '22023';
    end if;

    if case_value ? 'is_published'
       and jsonb_typeof(case_value -> 'is_published') <> 'boolean' then
      raise exception 'Case "%.is_published" must be a boolean', case_key
        using errcode = '22023';
    end if;

    if case_value ? 'side'
       and (
         jsonb_typeof(case_value -> 'side') <> 'string'
         or case_value ->> 'side' not in ('graphic', 'webdev')
       ) then
      raise exception 'Case "%.side" must be graphic or webdev', case_key
        using errcode = '22023';
    end if;

    if case_value ? 'project_id'
       and (
         jsonb_typeof(case_value -> 'project_id') <> 'string'
         or length(btrim(case_value ->> 'project_id')) = 0
         or length(case_value ->> 'project_id') > 200
       ) then
      raise exception 'Case "%.project_id" must be a non-empty string of at most 200 characters', case_key
        using errcode = '22023';
    end if;
  end loop;

  canonical_content :=
    (p_content - 'schema_version')
    || jsonb_build_object('schemaVersion', schema_version);

  return canonical_content;
end;
$function$;

-- Recursively omit records explicitly marked `is_published: false`. Returning
-- SQL NULL is an internal sentinel meaning that the current object/array member
-- is omitted; a JSON null value remains a JSON null value.
create or replace function public.remove_unpublished_portfolio_records(
  p_value jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  value_type text;
  object_key text;
  object_value jsonb;
  clean_value jsonb;
  result jsonb;
begin
  if p_value is null then
    return null;
  end if;

  value_type := jsonb_typeof(p_value);

  if value_type = 'object' then
    if p_value @> '{"is_published": false}'::jsonb then
      return null;
    end if;

    result := '{}'::jsonb;
    for object_key, object_value in
      select key, value
      from jsonb_each(p_value)
    loop
      clean_value := public.remove_unpublished_portfolio_records(object_value);
      if clean_value is not null then
        result := result || jsonb_build_object(object_key, clean_value);
      end if;
    end loop;
    return result;
  end if;

  if value_type = 'array' then
    result := '[]'::jsonb;
    for object_value in
      select value
      from jsonb_array_elements(p_value)
    loop
      clean_value := public.remove_unpublished_portfolio_records(object_value);
      if clean_value is not null then
        result := result || jsonb_build_array(clean_value);
      end if;
    end loop;
    return result;
  end if;

  return p_value;
end;
$function$;

-- Filter a known record array by an opt-out boolean while preserving the
-- original JSON array order. Missing flags are intentionally treated as
-- visible for backward compatibility with pre-CMS content.
create or replace function public.filter_portfolio_record_array(
  p_items jsonb,
  p_visibility_flag text
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  item jsonb;
  result jsonb := '[]'::jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return result;
  end if;

  for item in
    select value
    from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(item) <> 'object'
       or not (
         item ? p_visibility_flag
         and jsonb_typeof(item -> p_visibility_flag) = 'boolean'
         and item -> p_visibility_flag = 'false'::jsonb
       ) then
      result := result || jsonb_build_array(item);
    end if;
  end loop;

  return result;
end;
$function$;

-- Produce the only document shape that public callers may receive. Cases use
-- `project_id` when present; legacy case maps fall back to their map key, id,
-- work_id, or slug. A side, when supplied, must agree with the visible work.
create or replace function public.sanitize_published_portfolio(
  p_content jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  clean_content jsonb;
  graphic_works jsonb;
  webdev_works jsonb;
  case_map jsonb;
  visible_cases jsonb;
begin
  clean_content := coalesce(
    public.remove_unpublished_portfolio_records(p_content),
    '{}'::jsonb
  );

  if clean_content = '{}'::jsonb then
    return clean_content;
  end if;

  -- These collections use older purpose-specific visibility flags rather than
  -- is_published. Removing hidden records here also prevents their labels and
  -- external URLs from being exposed through the anonymous JSON response.
  clean_content := jsonb_set(
    clean_content,
    '{services,graphic}',
    public.filter_portfolio_record_array(
      clean_content #> '{services,graphic}',
      'is_active'
    ),
    true
  );
  clean_content := jsonb_set(
    clean_content,
    '{services,webdev}',
    public.filter_portfolio_record_array(
      clean_content #> '{services,webdev}',
      'is_active'
    ),
    true
  );
  clean_content := jsonb_set(
    clean_content,
    '{site,navigation}',
    public.filter_portfolio_record_array(
      clean_content #> '{site,navigation}',
      'is_visible'
    ),
    true
  );
  clean_content := jsonb_set(
    clean_content,
    '{site,socialLinks}',
    public.filter_portfolio_record_array(
      clean_content #> '{site,socialLinks}',
      'is_visible'
    ),
    true
  );

  graphic_works := case
    when jsonb_typeof(clean_content #> '{works,graphic}') = 'array'
      then clean_content #> '{works,graphic}'
    else '[]'::jsonb
  end;
  webdev_works := case
    when jsonb_typeof(clean_content #> '{works,webdev}') = 'array'
      then clean_content #> '{works,webdev}'
    else '[]'::jsonb
  end;
  case_map := case
    when jsonb_typeof(clean_content -> 'cases') = 'object'
      then clean_content -> 'cases'
    else '{}'::jsonb
  end;

  with visible_work_identifiers as (
    select side, identifier
    from (
      select
        'graphic'::text as side,
        nullif(btrim(work_item ->> identifier_key), '') as identifier
      from jsonb_array_elements(graphic_works) as works(work_item)
      cross join (
        values ('id'::text), ('slug'::text), ('project_id'::text)
      ) as identifiers(identifier_key)

      union all

      select
        'webdev'::text as side,
        nullif(btrim(work_item ->> identifier_key), '') as identifier
      from jsonb_array_elements(webdev_works) as works(work_item)
      cross join (
        values ('id'::text), ('slug'::text), ('project_id'::text)
      ) as identifiers(identifier_key)
    ) candidates
    where identifier is not null
  ),
  linked_cases as (
    select cases.key, cases.value
    from jsonb_each(case_map) as cases(key, value)
    where jsonb_typeof(cases.value) = 'object'
      and exists (
        select 1
        from visible_work_identifiers visible
        where (
          nullif(btrim(cases.value ->> 'side'), '') is null
          or cases.value ->> 'side' = visible.side
        )
        and (
          case
            when nullif(btrim(cases.value ->> 'project_id'), '') is not null
              then visible.identifier = cases.value ->> 'project_id'
            else visible.identifier in (
              cases.key,
              coalesce(cases.value ->> 'id', ''),
              coalesce(cases.value ->> 'work_id', ''),
              coalesce(cases.value ->> 'slug', '')
            )
          end
        )
      )
  )
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  into visible_cases
  from linked_cases;

  return jsonb_set(clean_content, '{cases}', visible_cases, true);
end;
$function$;

create or replace function public.get_published_portfolio()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  stored_content jsonb;
  is_enabled boolean;
begin
  select published_json, public_enabled
  into stored_content, is_enabled
  from public.portfolio_content
  where id = 1;

  if not found then
    return '{}'::jsonb;
  end if;

  if not coalesce(is_enabled, true) then
    return jsonb_build_object(
      'schemaVersion', public.portfolio_supported_schema_version(),
      'publicEnabled', false
    );
  end if;

  return public.sanitize_published_portfolio(
    coalesce(stored_content, '{}'::jsonb)
  ) || jsonb_build_object('publicEnabled', true);
end;
$function$;

create or replace function public.get_portfolio_admin_state()
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

  select jsonb_build_object(
    'draft_json', draft_json,
    'published_json', published_json,
    'draft_revision', draft_revision,
    'published_revision', published_revision,
    'draft_schema_version', draft_schema_version,
    'published_schema_version', published_schema_version,
    'public_enabled', public_enabled,
    'updated_at', updated_at,
    'published_at', published_at,
    'unpublished_at', unpublished_at
  )
  into result
  from public.portfolio_content
  where id = 1;

  return coalesce(result, '{}'::jsonb);
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
  if not public.has_admin_role(array['owner', 'publisher', 'editor']) then
    raise exception 'Editor access is required'
      using errcode = '42501';
  end if;

  validated_content := public.validate_portfolio_content(p_content);
  schema_version := public.portfolio_content_schema_version(validated_content);

  select draft_revision
  into current_revision
  from public.portfolio_content
  where id = 1
  for update;

  if not found then
    raise exception 'Portfolio content row not found'
      using errcode = 'P0002';
  end if;

  if current_revision is distinct from coalesce(p_expected_revision, 0) then
    raise exception 'The draft changed in another session. Reload before saving.'
      using errcode = '40001';
  end if;

  next_revision := current_revision + 1;

  update public.portfolio_content
  set draft_json = validated_content,
      draft_schema_version = schema_version,
      draft_revision = next_revision,
      updated_by = (select auth.uid()),
      updated_at = changed_at
  where id = 1;

  insert into public.portfolio_revisions (
    revision, kind, content_json, created_by, created_at
  )
  values (
    next_revision,
    'draft',
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
    'draft.saved',
    'portfolio',
    'main',
    jsonb_build_object(
      'draft_revision', next_revision,
      'schema_version', schema_version
    ),
    changed_at
  );

  return jsonb_build_object(
    'draft_revision', next_revision,
    'schema_version', schema_version,
    'updated_at', changed_at
  );
end;
$function$;

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
  public_content := public.sanitize_published_portfolio(validated_content)
    || jsonb_build_object('publicEnabled', true);
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
      'schema_version', schema_version
    ),
    changed_at
  );

  insert into public.portfolio_publish_events (
    published_revision, created_at
  )
  values (
    next_published_revision, changed_at
  );

  -- The browser immediately applies this return value to the public app, so it
  -- must be the same projection anonymous readers receive.
  return jsonb_build_object(
    'published_json', public_content,
    'published_revision', next_published_revision,
    'schema_version', schema_version,
    'public_enabled', true,
    'published_at', changed_at
  );
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
  if not public.has_admin_role(array['owner', 'publisher']) then
    raise exception 'Publisher access is required'
      using errcode = '42501';
  end if;

  select content_json
  into restored_content
  from public.portfolio_revisions
  where id = p_revision_id;

  if not found then
    raise exception 'Revision not found'
      using errcode = 'P0002';
  end if;

  validated_content := public.validate_portfolio_content(restored_content);
  schema_version := public.portfolio_content_schema_version(validated_content);

  select draft_revision
  into current_revision
  from public.portfolio_content
  where id = 1
  for update;

  if not found then
    raise exception 'Portfolio content row not found'
      using errcode = 'P0002';
  end if;

  if current_revision is distinct from coalesce(p_expected_revision, 0) then
    raise exception 'The draft changed in another session. Reload before restoring.'
      using errcode = '40001';
  end if;

  next_revision := current_revision + 1;

  update public.portfolio_content
  set draft_json = validated_content,
      draft_schema_version = schema_version,
      draft_revision = next_revision,
      updated_by = (select auth.uid()),
      updated_at = changed_at
  where id = 1;

  insert into public.portfolio_revisions (
    revision, kind, content_json, created_by, created_at
  )
  values (
    next_revision,
    'draft',
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
    'revision.restored',
    'portfolio',
    p_revision_id::text,
    jsonb_build_object(
      'draft_revision', next_revision,
      'schema_version', schema_version
    ),
    changed_at
  );

  return jsonb_build_object(
    'draft_json', validated_content,
    'draft_revision', next_revision,
    'schema_version', schema_version,
    'updated_at', changed_at
  );
end;
$function$;

-- Explicit whole-site unpublish. The last full published snapshot is preserved
-- for audit/recovery and can be made public again only through publish_portfolio.
create or replace function public.unpublish_portfolio(
  p_expected_published_revision bigint
)
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
  schema_version integer;
  changed_at timestamptz := now();
begin
  if not public.has_admin_role(array['owner', 'publisher']) then
    raise exception 'Publisher access is required'
      using errcode = '42501';
  end if;

  select
    published_revision,
    public_enabled,
    published_json,
    published_schema_version
  into
    current_published_revision,
    was_enabled,
    stored_content,
    schema_version
  from public.portfolio_content
  where id = 1
  for update;

  if not found then
    raise exception 'Portfolio content row not found'
      using errcode = 'P0002';
  end if;

  if current_published_revision is distinct from coalesce(p_expected_published_revision, 0) then
    raise exception 'The published site changed in another session. Reload before unpublishing.'
      using errcode = '40001';
  end if;

  if not coalesce(was_enabled, true) then
    return jsonb_build_object(
      'published_json', jsonb_build_object(
        'schemaVersion', public.portfolio_supported_schema_version(),
        'publicEnabled', false
      ),
      'published_revision', current_published_revision,
      'schema_version', schema_version,
      'public_enabled', false,
      'unpublished_at', (
        select unpublished_at
        from public.portfolio_content
        where id = 1
      )
    );
  end if;

  next_published_revision := current_published_revision + 1;

  update public.portfolio_content
  set public_enabled = false,
      published_revision = next_published_revision,
      published_by = (select auth.uid()),
      unpublished_at = changed_at
  where id = 1;

  insert into public.portfolio_revisions (
    revision, kind, content_json, created_by, created_at
  )
  values (
    next_published_revision,
    'published',
    stored_content,
    (select auth.uid()),
    changed_at
  )
  on conflict (kind, revision) do nothing;

  insert into public.portfolio_activity_log (
    actor_id, action, resource_type, resource_id, metadata, created_at
  )
  values (
    (select auth.uid()),
    'portfolio.unpublished',
    'portfolio',
    'main',
    jsonb_build_object(
      'published_revision', next_published_revision,
      'schema_version', schema_version
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
    'published_json', jsonb_build_object(
      'schemaVersion', public.portfolio_supported_schema_version(),
      'publicEnabled', false
    ),
    'published_revision', next_published_revision,
    'schema_version', schema_version,
    'public_enabled', false,
    'unpublished_at', changed_at
  );
end;
$function$;

-- Helper functions are implementation details of the security-definer RPCs.
-- They are deliberately not callable through PostgREST.
revoke all on function public.portfolio_supported_schema_version()
  from public, anon, authenticated;
revoke all on function public.portfolio_content_schema_version(jsonb)
  from public, anon, authenticated;
revoke all on function public.assert_portfolio_record_array(jsonb, text, integer, boolean, text)
  from public, anon, authenticated;
revoke all on function public.validate_portfolio_content(jsonb)
  from public, anon, authenticated;
revoke all on function public.remove_unpublished_portfolio_records(jsonb)
  from public, anon, authenticated;
revoke all on function public.filter_portfolio_record_array(jsonb, text)
  from public, anon, authenticated;
revoke all on function public.sanitize_published_portfolio(jsonb)
  from public, anon, authenticated;

revoke all on function public.get_published_portfolio()
  from public, anon, authenticated;
revoke all on function public.get_portfolio_admin_state()
  from public, anon, authenticated;
revoke all on function public.save_portfolio_draft(jsonb, bigint)
  from public, anon, authenticated;
revoke all on function public.publish_portfolio(bigint)
  from public, anon, authenticated;
revoke all on function public.restore_portfolio_revision(uuid, bigint)
  from public, anon, authenticated;
revoke all on function public.unpublish_portfolio(bigint)
  from public, anon, authenticated;

grant execute on function public.get_published_portfolio()
  to anon, authenticated;
grant execute on function public.get_portfolio_admin_state()
  to authenticated;
grant execute on function public.save_portfolio_draft(jsonb, bigint)
  to authenticated;
grant execute on function public.publish_portfolio(bigint)
  to authenticated;
grant execute on function public.restore_portfolio_revision(uuid, bigint)
  to authenticated;
grant execute on function public.unpublish_portfolio(bigint)
  to authenticated;

commit;
