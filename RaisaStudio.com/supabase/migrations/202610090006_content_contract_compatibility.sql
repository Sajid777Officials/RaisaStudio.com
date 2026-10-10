-- Forward compatibility fixes for installations that already applied 005.
-- Fresh installations also need the corrected 005 so its reconciliation can finish.
-- No historical revisions or published content are rewritten by this migration.
begin;

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

commit;
