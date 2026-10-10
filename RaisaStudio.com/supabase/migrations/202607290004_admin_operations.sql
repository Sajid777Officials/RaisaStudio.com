-- RAISA Studio owner-managed staff roles and enriched activity feed.
-- Apply after 202607290003_secure_media_lifecycle.sql.
-- This migration does not create Auth accounts. Create/password-reset accounts
-- through Supabase Auth, then let an existing owner assign a CMS role by email.

begin;

create or replace function public.list_portfolio_admin_users()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.has_admin_role(array['owner']) then
    raise exception 'Only an active owner can list portfolio staff.'
      using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', staff.user_id,
        'email', coalesce(account.email, ''),
        'role', staff.role,
        'is_active', staff.is_active,
        'created_at', staff.created_at,
        'updated_at', staff.updated_at
      )
      order by
        case staff.role
          when 'owner' then 1
          when 'publisher' then 2
          when 'editor' then 3
          else 4
        end,
        lower(coalesce(account.email, '')),
        staff.created_at
    ),
    '[]'::jsonb
  )
  into result
  from public.admin_users as staff
  left join auth.users as account
    on account.id = staff.user_id;

  return result;
end;
$$;

create or replace function public.add_portfolio_admin_user(
  p_email text,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  normalized_email text := lower(trim(coalesce(p_email, '')));
  normalized_role text := lower(trim(coalesce(p_role, '')));
  target_user auth.users;
  previous_row public.admin_users;
  staff_row public.admin_users;
  other_owner_count integer;
  changed_at timestamptz := now();
begin
  if not public.has_admin_role(array['owner']) then
    raise exception 'Only an active owner can add portfolio staff.'
      using errcode = '42501';
  end if;

  if normalized_email = ''
     or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter the email address of an existing Supabase Auth user.'
      using errcode = '22023';
  end if;

  if normalized_role not in ('owner', 'publisher', 'editor', 'viewer') then
    raise exception 'Unsupported portfolio role.'
      using errcode = '22023';
  end if;

  select account.*
  into target_user
  from auth.users as account
  where lower(account.email) = normalized_email
  limit 1;

  if target_user.id is null then
    raise exception 'No Supabase Auth account exists for that email address.'
      using errcode = '23503';
  end if;

  -- The upsert path can also reactivate or change an existing staff record.
  -- Serialize it with update_portfolio_admin_user so it cannot bypass the
  -- final-active-owner invariant.
  lock table public.admin_users in share row exclusive mode;

  if not public.has_admin_role(array['owner']) then
    raise exception 'Owner access changed while assigning portfolio staff. Retry after signing in again.'
      using errcode = '42501';
  end if;

  select *
  into previous_row
  from public.admin_users
  where user_id = target_user.id
  for update;

  if found
     and previous_row.role = 'owner'
     and previous_row.is_active = true
     and normalized_role <> 'owner' then
    select count(*)
    into other_owner_count
    from public.admin_users
    where role = 'owner'
      and is_active = true
      and user_id <> target_user.id;

    if other_owner_count = 0 then
      raise exception 'The last active owner cannot be demoted or deactivated.'
        using errcode = '23514';
    end if;
  end if;

  insert into public.admin_users (
    user_id,
    role,
    is_active,
    created_at,
    updated_at
  )
  values (
    target_user.id,
    normalized_role,
    true,
    changed_at,
    changed_at
  )
  on conflict (user_id) do update
  set role = excluded.role,
      is_active = true,
      updated_at = excluded.updated_at
  returning *
  into staff_row;

  insert into public.portfolio_activity_log (
    actor_id,
    action,
    resource_type,
    resource_id,
    metadata,
    created_at
  )
  values (
    actor,
    'admin_user.assigned',
    'admin_user',
    staff_row.user_id::text,
    jsonb_build_object(
      'email', normalized_email,
      'role', staff_row.role,
      'is_active', staff_row.is_active
    ),
    changed_at
  );

  return jsonb_build_object(
    'user_id', staff_row.user_id,
    'email', normalized_email,
    'role', staff_row.role,
    'is_active', staff_row.is_active,
    'created_at', staff_row.created_at,
    'updated_at', staff_row.updated_at
  );
end;
$$;

create or replace function public.update_portfolio_admin_user(
  p_user_id uuid,
  p_role text,
  p_is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  normalized_role text := lower(trim(coalesce(p_role, '')));
  previous_row public.admin_users;
  staff_row public.admin_users;
  target_email text;
  other_owner_count integer;
  changed_at timestamptz := now();
begin
  if not public.has_admin_role(array['owner']) then
    raise exception 'Only an active owner can update portfolio staff.'
      using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'A staff user id is required.'
      using errcode = '22023';
  end if;

  if p_is_active is null then
    raise exception 'Staff activation state is required.'
      using errcode = '22023';
  end if;

  if normalized_role not in ('owner', 'publisher', 'editor', 'viewer') then
    raise exception 'Unsupported portfolio role.'
      using errcode = '22023';
  end if;

  -- Serialize owner-count checks with concurrent staff changes.
  lock table public.admin_users in share row exclusive mode;

  if not public.has_admin_role(array['owner']) then
    raise exception 'Owner access changed while updating portfolio staff. Retry after signing in again.'
      using errcode = '42501';
  end if;

  select *
  into previous_row
  from public.admin_users
  where user_id = p_user_id
  for update;

  if previous_row.user_id is null then
    raise exception 'Portfolio staff record not found.'
      using errcode = 'P0002';
  end if;

  if previous_row.role = 'owner'
     and previous_row.is_active = true
     and (normalized_role <> 'owner' or p_is_active = false) then
    select count(*)
    into other_owner_count
    from public.admin_users
    where role = 'owner'
      and is_active = true
      and user_id <> p_user_id;

    if other_owner_count = 0 then
      raise exception 'The last active owner cannot be demoted or deactivated.'
        using errcode = '23514';
    end if;
  end if;

  update public.admin_users
  set role = normalized_role,
      is_active = p_is_active,
      updated_at = changed_at
  where user_id = p_user_id
  returning *
  into staff_row;

  select coalesce(account.email, '')
  into target_email
  from auth.users as account
  where account.id = p_user_id;

  insert into public.portfolio_activity_log (
    actor_id,
    action,
    resource_type,
    resource_id,
    metadata,
    created_at
  )
  values (
    actor,
    case
      when staff_row.is_active then 'admin_user.updated'
      else 'admin_user.deactivated'
    end,
    'admin_user',
    staff_row.user_id::text,
    jsonb_build_object(
      'email', coalesce(target_email, ''),
      'previous_role', previous_row.role,
      'role', staff_row.role,
      'previous_is_active', previous_row.is_active,
      'is_active', staff_row.is_active
    ),
    changed_at
  );

  return jsonb_build_object(
    'user_id', staff_row.user_id,
    'email', coalesce(target_email, ''),
    'role', staff_row.role,
    'is_active', staff_row.is_active,
    'created_at', staff_row.created_at,
    'updated_at', staff_row.updated_at
  );
end;
$$;

create or replace function public.get_portfolio_activity(
  p_offset integer default 0,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
  safe_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  result jsonb;
begin
  if not public.has_admin_role(array['owner', 'publisher', 'editor', 'viewer']) then
    raise exception 'Active portfolio staff access is required.'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'items',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', page.id,
            'action', page.action,
            'resource_type', page.resource_type,
            'resource_id', page.resource_id,
            'metadata', page.metadata,
            'created_at', page.created_at,
            'actor_id', page.actor_id,
            'actor_email', page.actor_email
          )
          order by page.created_at desc, page.id desc
        )
        from (
          select
            activity.id,
            activity.action,
            activity.resource_type,
            activity.resource_id,
            activity.metadata,
            activity.created_at,
            activity.actor_id,
            coalesce(account.email, '') as actor_email
          from public.portfolio_activity_log as activity
          left join auth.users as account
            on account.id = activity.actor_id
          order by activity.created_at desc, activity.id desc
          offset safe_offset
          limit safe_limit
        ) as page
      ),
      '[]'::jsonb
    ),
    'count',
    (select count(*) from public.portfolio_activity_log)
  )
  into result;

  return result;
end;
$$;

revoke all on function public.list_portfolio_admin_users() from public;
revoke all on function public.add_portfolio_admin_user(text, text) from public;
revoke all on function public.update_portfolio_admin_user(uuid, text, boolean) from public;
revoke all on function public.get_portfolio_activity(integer, integer) from public;

grant execute on function public.list_portfolio_admin_users() to authenticated;
grant execute on function public.add_portfolio_admin_user(text, text) to authenticated;
grant execute on function public.update_portfolio_admin_user(uuid, text, boolean) to authenticated;
grant execute on function public.get_portfolio_activity(integer, integer) to authenticated;

commit;
