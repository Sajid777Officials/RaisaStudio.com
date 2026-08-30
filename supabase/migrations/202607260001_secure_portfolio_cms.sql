-- RAISA Studio secure portfolio CMS
-- Run once in Supabase SQL Editor after creating the first auth user.
-- Safe to re-run: existing admin_users rows (including the owner) are preserved.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Staff access
-- ---------------------------------------------------------------------------

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'publisher', 'editor', 'viewer')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;
revoke all on table public.admin_users from anon, authenticated;
grant select on table public.admin_users to authenticated;

drop policy if exists "Users can read own admin role" on public.admin_users;
create policy "Users can read own admin role"
on public.admin_users
for select
to authenticated
using ((select auth.uid()) = user_id and is_active = true);

create or replace function public.has_admin_role(allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = (select auth.uid())
      and is_active = true
      and role = any(coalesce(allowed_roles, array[]::text[]))
  );
$$;

revoke all on function public.has_admin_role(text[]) from public;
grant execute on function public.has_admin_role(text[]) to authenticated;

create or replace function public.get_admin_profile()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'user_id', user_id,
        'role', role,
        'is_active', is_active
      )
      from public.admin_users
      where user_id = (select auth.uid())
        and is_active = true
    ),
    'null'::jsonb
  );
$$;

revoke all on function public.get_admin_profile() from public;
grant execute on function public.get_admin_profile() to authenticated;

-- ---------------------------------------------------------------------------
-- Draft and published content snapshots
-- ---------------------------------------------------------------------------

create table if not exists public.portfolio_content (
  id integer primary key default 1 check (id = 1),
  draft_json jsonb not null default '{}'::jsonb,
  published_json jsonb not null default '{}'::jsonb,
  draft_revision bigint not null default 0,
  published_revision bigint not null default 0,
  updated_by uuid references auth.users(id) on delete set null,
  published_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

-- Upgrade the earlier single-content-table schema without losing its data.
alter table public.portfolio_content add column if not exists draft_json jsonb not null default '{}'::jsonb;
alter table public.portfolio_content add column if not exists published_json jsonb not null default '{}'::jsonb;
alter table public.portfolio_content add column if not exists draft_revision bigint not null default 0;
alter table public.portfolio_content add column if not exists published_revision bigint not null default 0;
alter table public.portfolio_content add column if not exists updated_by uuid references auth.users(id) on delete set null;
alter table public.portfolio_content add column if not exists published_by uuid references auth.users(id) on delete set null;
alter table public.portfolio_content add column if not exists published_at timestamptz;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'portfolio_content'
      and column_name = 'content_json'
  ) then
    execute $migration$
      update public.portfolio_content
      set draft_json = case
            when draft_json = '{}'::jsonb then content_json
            else draft_json
          end,
          published_json = case
            when published_json = '{}'::jsonb then content_json
            else published_json
          end
      where content_json is not null
    $migration$;
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'portfolio_content'
      and column_name = 'content_json'
  ) then
    execute $seed$
      insert into public.portfolio_content (id, content_json)
      values (1, '{}'::jsonb)
      on conflict (id) do nothing
    $seed$;
  else
    insert into public.portfolio_content (id)
    values (1)
    on conflict (id) do nothing;
  end if;
end
$$;

alter table public.portfolio_content enable row level security;
drop policy if exists "Public can read content" on public.portfolio_content;
drop policy if exists "Authenticated users can upsert content" on public.portfolio_content;
revoke all on table public.portfolio_content from anon, authenticated;

create table if not exists public.portfolio_revisions (
  id uuid primary key default gen_random_uuid(),
  revision bigint not null,
  kind text not null check (kind in ('draft', 'published')),
  content_json jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (kind, revision)
);

create index if not exists portfolio_revisions_created_at_idx
  on public.portfolio_revisions (created_at desc);

alter table public.portfolio_revisions enable row level security;
revoke all on table public.portfolio_revisions from anon, authenticated;
grant select on table public.portfolio_revisions to authenticated;

drop policy if exists "Active admins can read revisions" on public.portfolio_revisions;
create policy "Active admins can read revisions"
on public.portfolio_revisions
for select
to authenticated
using (public.has_admin_role(array['owner', 'publisher', 'editor', 'viewer']));

create table if not exists public.portfolio_activity_log (
  id bigint generated by default as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  resource_type text not null default 'portfolio',
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists portfolio_activity_created_at_idx
  on public.portfolio_activity_log (created_at desc);

alter table public.portfolio_activity_log enable row level security;
revoke all on table public.portfolio_activity_log from anon, authenticated;
grant select on table public.portfolio_activity_log to authenticated;

drop policy if exists "Active admins can read activity" on public.portfolio_activity_log;
create policy "Active admins can read activity"
on public.portfolio_activity_log
for select
to authenticated
using (public.has_admin_role(array['owner', 'publisher', 'editor', 'viewer']));

create table if not exists public.portfolio_publish_events (
  id bigint generated by default as identity primary key,
  published_revision bigint not null,
  created_at timestamptz not null default now()
);

alter table public.portfolio_publish_events enable row level security;
revoke all on table public.portfolio_publish_events from anon, authenticated;
grant select on table public.portfolio_publish_events to anon, authenticated;

drop policy if exists "Anyone can observe publication events" on public.portfolio_publish_events;
create policy "Anyone can observe publication events"
on public.portfolio_publish_events
for select
to anon, authenticated
using (true);

create or replace function public.get_published_portfolio()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select published_json
      from public.portfolio_content
      where id = 1
    ),
    '{}'::jsonb
  );
$$;

revoke all on function public.get_published_portfolio() from public;
grant execute on function public.get_published_portfolio() to anon, authenticated;

create or replace function public.get_portfolio_admin_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    'updated_at', updated_at,
    'published_at', published_at
  )
  into result
  from public.portfolio_content
  where id = 1;

  return coalesce(result, '{}'::jsonb);
end;
$$;

create or replace function public.save_portfolio_draft(
  p_content jsonb,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_revision bigint;
  next_revision bigint;
  changed_at timestamptz := now();
begin
  if not public.has_admin_role(array['owner', 'publisher', 'editor']) then
    raise exception 'Editor access is required'
      using errcode = '42501';
  end if;

  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception 'Portfolio content must be a JSON object'
      using errcode = '22023';
  end if;

  select draft_revision
  into current_revision
  from public.portfolio_content
  where id = 1
  for update;

  if current_revision is distinct from coalesce(p_expected_revision, 0) then
    raise exception 'The draft changed in another session. Reload before saving.'
      using errcode = '40001';
  end if;

  next_revision := current_revision + 1;

  update public.portfolio_content
  set draft_json = p_content,
      draft_revision = next_revision,
      updated_by = (select auth.uid()),
      updated_at = changed_at
  where id = 1;

  insert into public.portfolio_revisions (
    revision, kind, content_json, created_by, created_at
  )
  values (
    next_revision, 'draft', p_content, (select auth.uid()), changed_at
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
    jsonb_build_object('draft_revision', next_revision),
    changed_at
  );

  return jsonb_build_object(
    'draft_revision', next_revision,
    'updated_at', changed_at
  );
end;
$$;

create or replace function public.publish_portfolio(
  p_expected_draft_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_draft_revision bigint;
  next_published_revision bigint;
  draft_content jsonb;
  changed_at timestamptz := now();
begin
  if not public.has_admin_role(array['owner', 'publisher']) then
    raise exception 'Publisher access is required'
      using errcode = '42501';
  end if;

  select draft_json, draft_revision, published_revision + 1
  into draft_content, current_draft_revision, next_published_revision
  from public.portfolio_content
  where id = 1
  for update;

  if current_draft_revision is distinct from coalesce(p_expected_draft_revision, 0) then
    raise exception 'The draft changed in another session. Reload before publishing.'
      using errcode = '40001';
  end if;

  update public.portfolio_content
  set published_json = draft_content,
      published_revision = next_published_revision,
      published_by = (select auth.uid()),
      published_at = changed_at
  where id = 1;

  insert into public.portfolio_revisions (
    revision, kind, content_json, created_by, created_at
  )
  values (
    next_published_revision, 'published', draft_content, (select auth.uid()), changed_at
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
      'published_revision', next_published_revision
    ),
    changed_at
  );

  insert into public.portfolio_publish_events (published_revision, created_at)
  values (next_published_revision, changed_at);

  return jsonb_build_object(
    'published_json', draft_content,
    'published_revision', next_published_revision,
    'published_at', changed_at
  );
end;
$$;

create or replace function public.restore_portfolio_revision(
  p_revision_id uuid,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  restored_content jsonb;
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

  if restored_content is null then
    raise exception 'Revision not found'
      using errcode = 'P0002';
  end if;

  select draft_revision
  into current_revision
  from public.portfolio_content
  where id = 1
  for update;

  if current_revision is distinct from coalesce(p_expected_revision, 0) then
    raise exception 'The draft changed in another session. Reload before restoring.'
      using errcode = '40001';
  end if;

  next_revision := current_revision + 1;

  update public.portfolio_content
  set draft_json = restored_content,
      draft_revision = next_revision,
      updated_by = (select auth.uid()),
      updated_at = changed_at
  where id = 1;

  insert into public.portfolio_revisions (
    revision, kind, content_json, created_by, created_at
  )
  values (
    next_revision, 'draft', restored_content, (select auth.uid()), changed_at
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
    jsonb_build_object('draft_revision', next_revision),
    changed_at
  );

  return jsonb_build_object(
    'draft_json', restored_content,
    'draft_revision', next_revision,
    'updated_at', changed_at
  );
end;
$$;

revoke all on function public.get_portfolio_admin_state() from public;
revoke all on function public.save_portfolio_draft(jsonb, bigint) from public;
revoke all on function public.publish_portfolio(bigint) from public;
revoke all on function public.restore_portfolio_revision(uuid, bigint) from public;
grant execute on function public.get_portfolio_admin_state() to authenticated;
grant execute on function public.save_portfolio_draft(jsonb, bigint) to authenticated;
grant execute on function public.publish_portfolio(bigint) to authenticated;
grant execute on function public.restore_portfolio_revision(uuid, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Upload metadata and Storage
-- ---------------------------------------------------------------------------

create table if not exists public.portfolio_uploads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null default auth.uid(),
  name text not null,
  mime_type text not null,
  size bigint not null default 0 check (size >= 0 and size <= 3145728),
  public_url text not null,
  storage_path text not null unique,
  alt_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.portfolio_uploads add column if not exists owner_id uuid references auth.users(id) on delete set null default auth.uid();
alter table public.portfolio_uploads add column if not exists alt_text text not null default '';
alter table public.portfolio_uploads add column if not exists updated_at timestamptz not null default now();

create or replace function public.log_portfolio_upload_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  upload_row public.portfolio_uploads;
  action_name text;
begin
  if tg_op = 'DELETE' then
    upload_row := old;
  else
    upload_row := new;
  end if;

  action_name := case tg_op
    when 'INSERT' then 'upload.created'
    when 'UPDATE' then 'upload.updated'
    else 'upload.deleted'
  end;

  insert into public.portfolio_activity_log (
    actor_id,
    action,
    resource_type,
    resource_id,
    metadata
  )
  values (
    (select auth.uid()),
    action_name,
    'upload',
    upload_row.id::text,
    jsonb_build_object(
      'name', upload_row.name,
      'mime_type', upload_row.mime_type,
      'size', upload_row.size,
      'storage_path', upload_row.storage_path
    )
  );

  return upload_row;
end;
$$;

revoke all on function public.log_portfolio_upload_activity() from public;

drop trigger if exists portfolio_upload_activity_trigger
on public.portfolio_uploads;

create trigger portfolio_upload_activity_trigger
after insert or update or delete
on public.portfolio_uploads
for each row
execute function public.log_portfolio_upload_activity();

create or replace function public.can_delete_portfolio_upload(
  p_storage_path text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.has_admin_role(array['owner', 'publisher', 'editor'])
    and exists (
      select 1
      from public.portfolio_uploads upload
      cross join public.portfolio_content content
      where upload.storage_path = p_storage_path
        and strpos(content.draft_json::text, upload.public_url) = 0
        and strpos(content.published_json::text, upload.public_url) = 0
    );
$$;

revoke all on function public.can_delete_portfolio_upload(text) from public;
grant execute on function public.can_delete_portfolio_upload(text) to authenticated;

alter table public.portfolio_uploads enable row level security;
drop policy if exists "Public can read uploads" on public.portfolio_uploads;
drop policy if exists "Authenticated users can manage uploads" on public.portfolio_uploads;
revoke all on table public.portfolio_uploads from anon, authenticated;
grant select, insert, update, delete on table public.portfolio_uploads to authenticated;

drop policy if exists "Active admins can read uploads" on public.portfolio_uploads;
create policy "Active admins can read uploads"
on public.portfolio_uploads
for select
to authenticated
using (public.has_admin_role(array['owner', 'publisher', 'editor', 'viewer']));

drop policy if exists "Editors can insert uploads" on public.portfolio_uploads;
create policy "Editors can insert uploads"
on public.portfolio_uploads
for insert
to authenticated
with check (
  owner_id = (select auth.uid())
  and storage_path like ((select auth.uid())::text || '/%')
  and public.has_admin_role(array['owner', 'publisher', 'editor'])
);

drop policy if exists "Editors can update uploads" on public.portfolio_uploads;
create policy "Editors can update uploads"
on public.portfolio_uploads
for update
to authenticated
using (public.has_admin_role(array['owner', 'publisher', 'editor']))
with check (public.has_admin_role(array['owner', 'publisher', 'editor']));

drop policy if exists "Editors can delete uploads" on public.portfolio_uploads;
create policy "Editors can delete uploads"
on public.portfolio_uploads
for delete
to authenticated
using (public.can_delete_portfolio_upload(storage_path));

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
values (
  'portfolio-uploads',
  'portfolio-uploads',
  true,
  3145728,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can view uploads" on storage.objects;
drop policy if exists "Authenticated users can upload" on storage.objects;
drop policy if exists "Authenticated users can delete uploads" on storage.objects;
drop policy if exists "Active admins can view portfolio objects" on storage.objects;
drop policy if exists "Editors can upload portfolio objects" on storage.objects;
drop policy if exists "Editors can update portfolio objects" on storage.objects;
drop policy if exists "Editors can delete portfolio objects" on storage.objects;

create policy "Active admins can view portfolio objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'portfolio-uploads'
  and public.has_admin_role(array['owner', 'publisher', 'editor', 'viewer'])
);

create policy "Editors can upload portfolio objects"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'portfolio-uploads'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.has_admin_role(array['owner', 'publisher', 'editor'])
);

create policy "Editors can update portfolio objects"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'portfolio-uploads'
  and public.has_admin_role(array['owner', 'publisher', 'editor'])
)
with check (
  bucket_id = 'portfolio-uploads'
  and public.has_admin_role(array['owner', 'publisher', 'editor'])
);

create policy "Editors can delete portfolio objects"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'portfolio-uploads'
  and public.can_delete_portfolio_upload(name)
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'portfolio_publish_events'
  ) then
    alter publication supabase_realtime add table public.portfolio_publish_events;
  end if;
exception
  when undefined_object then null;
end
$$;

commit;
