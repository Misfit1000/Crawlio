-- Crawlio Admin Control Center V2.
-- Admin-only operations remain behind service-role API routes. The audit worker
-- contract is unchanged, so the audit API schema remains version 13.

begin;

alter table public.user_profiles
  add column if not exists disabled_at timestamptz null,
  add column if not exists disabled_by uuid null references auth.users(id) on delete set null,
  add column if not exists disabled_reason text null,
  add column if not exists deletion_requested_at timestamptz null;

create table if not exists public.admin_user_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  admin_user_id uuid null references auth.users(id) on delete set null,
  note text not null check (char_length(note) between 4 and 4000),
  created_at timestamptz not null default now()
);

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  requester_email text null,
  status text not null default 'requested'
    check (status in ('requested', 'processing', 'completed', 'failed', 'cancelled')),
  request_source text not null default 'self_service'
    check (request_source in ('self_service', 'support')),
  failure_code text null,
  failure_message text null,
  requested_at timestamptz not null default now(),
  processing_started_at timestamptz null,
  completed_at timestamptz null,
  processed_by uuid null references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_operation_previews (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null check (operation in ('retention_cleanup')),
  fingerprint text not null check (char_length(fingerprint) = 64),
  preview jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  applied_at timestamptz null,
  apply_result jsonb null,
  reason text null,
  created_at timestamptz not null default now()
);

create index if not exists user_profiles_disabled_idx
  on public.user_profiles (disabled, updated_at desc);
create index if not exists user_profiles_role_disabled_idx
  on public.user_profiles (role, disabled);
create index if not exists admin_user_notes_user_created_idx
  on public.admin_user_notes (user_id, created_at desc);
create index if not exists account_deletion_requests_status_requested_idx
  on public.account_deletion_requests (status, requested_at desc);
create index if not exists account_deletion_requests_user_requested_idx
  on public.account_deletion_requests (user_id, requested_at desc);
create unique index if not exists account_deletion_requests_open_user_idx
  on public.account_deletion_requests (user_id)
  where status in ('requested', 'processing');
create index if not exists admin_operation_previews_admin_created_idx
  on public.admin_operation_previews (admin_user_id, created_at desc);
create index if not exists admin_actions_action_created_idx
  on public.admin_actions (action, created_at desc);
create index if not exists blog_posts_content_health_idx
  on public.blog_posts (status, updated_at desc);
create index if not exists blog_generation_jobs_health_idx
  on public.blog_generation_jobs (state, updated_at desc);

drop trigger if exists account_deletion_requests_set_updated_at on public.account_deletion_requests;
create trigger account_deletion_requests_set_updated_at
before update on public.account_deletion_requests
for each row execute function public.set_updated_at();

create or replace function public.is_active_user(user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles
    where id = user_id
      and disabled = false
  );
$$;

create or replace function public.is_admin_user(user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles
    where id = user_id
      and role = 'admin'
      and disabled = false
  );
$$;

create or replace function public.guard_user_profile_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = old.id then
    new.role = old.role;
    new.plan = old.plan;
    new.subscription_status = old.subscription_status;
    new.audit_quota_used_daily = old.audit_quota_used_daily;
    new.audit_quota_used_monthly = old.audit_quota_used_monthly;
    new.quota_reset_daily_at = old.quota_reset_daily_at;
    new.quota_reset_monthly_at = old.quota_reset_monthly_at;
    new.disabled = old.disabled;
    new.disabled_at = old.disabled_at;
    new.disabled_by = old.disabled_by;
    new.disabled_reason = old.disabled_reason;
    new.deletion_requested_at = old.deletion_requested_at;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.guard_last_active_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_other_admins integer;
  v_removes_admin boolean;
begin
  v_removes_admin := false;
  if old.role = 'admin' and old.disabled = false then
    if tg_op = 'DELETE' then
      v_removes_admin := true;
    else
      v_removes_admin := new.role <> 'admin' or new.disabled = true;
    end if;
  end if;

  if v_removes_admin then
    perform pg_advisory_xact_lock(hashtext('crawlio:last-active-admin'));
    select count(*) into v_other_admins
    from public.user_profiles
    where id <> old.id
      and role = 'admin'
      and disabled = false;
    if v_other_admins = 0 then
      raise exception using
        errcode = 'P0001',
        message = 'LAST_ADMIN_PROTECTION';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_last_active_admin on public.user_profiles;
create trigger guard_last_active_admin
before update or delete on public.user_profiles
for each row execute function public.guard_last_active_admin();

create or replace function public.admin_operations_timeseries(p_window_hours integer default 24)
returns table (
  bucket timestamptz,
  queued bigint,
  running bigint,
  completed bigint,
  failed bigint,
  average_duration_seconds numeric,
  pages_crawled bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hours integer;
  v_bucket interval;
begin
  v_hours := case when p_window_hours in (24, 168, 720) then p_window_hours else 24 end;
  v_bucket := case when v_hours = 24 then interval '1 hour' else interval '1 day' end;

  return query
  select
    date_bin(v_bucket, a.created_at, timestamptz '2000-01-01 00:00:00+00') as bucket,
    count(*) filter (where a.status = 'queued')::bigint as queued,
    count(*) filter (where a.status = 'running')::bigint as running,
    count(*) filter (where a.status in ('completed', 'completed_with_warnings'))::bigint as completed,
    count(*) filter (where a.status in ('failed', 'abandoned', 'cancelled'))::bigint as failed,
    round(avg(extract(epoch from (coalesce(a.completed_at, a.updated_at) - coalesce(a.started_at, a.created_at))))
      filter (where a.status in ('completed', 'completed_with_warnings', 'failed', 'abandoned', 'cancelled')), 2),
    coalesce(sum(a.pages_crawled), 0)::bigint
  from public.audits a
  where a.created_at >= now() - make_interval(hours => v_hours)
  group by 1
  order by 1;
end;
$$;

create or replace function public.admin_user_plan_distribution()
returns table (
  plan text,
  account_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(user_profiles.plan, 'free')::text, count(*)::bigint
  from public.user_profiles
  where disabled = false
  group by coalesce(user_profiles.plan, 'free')
  order by 1;
$$;

create or replace function public.admin_resource_inventory()
returns table (
  resource_name text,
  approximate_rows bigint,
  total_bytes bigint,
  oldest_record_at timestamptz,
  retention_policy text,
  cleanup_eligible bigint
)
language sql
security definer
set search_path = public
as $$
  with inventory(resource_name, retention_policy, oldest_record_at, cleanup_eligible) as (
    select 'audits', 'Guest failures: 7 days', min(created_at),
      count(*) filter (where user_id is null and status in ('failed', 'abandoned') and created_at < now() - interval '7 days')
    from public.audits
    union all
    select 'audit_events', '30 days', min(created_at),
      count(*) filter (where created_at < now() - interval '30 days')
    from public.audit_events
    union all
    select 'audit_diagnostics', '30 days', min(created_at),
      count(*) filter (where created_at < now() - interval '30 days')
    from public.audit_diagnostics
    union all
    select 'api_error_logs', '30 days', min(created_at),
      count(*) filter (where created_at < now() - interval '30 days')
    from public.api_error_logs
    union all
    select 'admin_actions', 'Retained for accountability', min(created_at), 0::bigint
    from public.admin_actions
    union all
    select 'blog_posts', 'Retained until archived or deleted', min(created_at), 0::bigint
    from public.blog_posts
    union all
    select 'blog_generation_jobs', 'Retained for editorial traceability', min(created_at), 0::bigint
    from public.blog_generation_jobs
  )
  select
    inventory.resource_name,
    greatest(coalesce(classes.reltuples, 0)::bigint, 0) as approximate_rows,
    pg_total_relation_size(format('public.%I', inventory.resource_name)::regclass)::bigint as total_bytes,
    inventory.oldest_record_at,
    inventory.retention_policy,
    inventory.cleanup_eligible::bigint
  from inventory
  left join pg_class classes
    on classes.oid = format('public.%I', inventory.resource_name)::regclass
  order by pg_total_relation_size(format('public.%I', inventory.resource_name)::regclass) desc;
$$;

create or replace function public.admin_bulk_audit_operation(
  p_audit_ids uuid[],
  p_action text,
  p_priority integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested integer;
  v_unique integer;
  v_matched integer;
  v_invalid integer;
  v_updated jsonb;
begin
  v_requested := coalesce(cardinality(p_audit_ids), 0);
  select count(distinct audit_id) into v_unique
  from unnest(coalesce(p_audit_ids, array[]::uuid[])) as selected(audit_id);

  if v_requested < 1 or v_requested > 25 or v_unique <> v_requested then
    raise exception using errcode = 'P0001', message = 'AUDIT_SELECTION_INVALID';
  end if;
  if p_action not in ('cancel', 'retry', 'recover_stale', 'priority') then
    raise exception using errcode = 'P0001', message = 'AUDIT_ACTION_INVALID';
  end if;
  if p_action = 'priority' and (p_priority is null or p_priority < 0 or p_priority > 1000) then
    raise exception using errcode = 'P0001', message = 'AUDIT_PRIORITY_INVALID';
  end if;

  perform id
  from public.audits
  where id = any(p_audit_ids)
  order by id
  for update;

  select count(*) into v_matched
  from public.audits
  where id = any(p_audit_ids);
  if v_matched <> v_requested then
    raise exception using errcode = 'P0001', message = 'AUDIT_NOT_FOUND';
  end if;

  select count(*) into v_invalid
  from public.audits
  where id = any(p_audit_ids)
    and not (
      (p_action = 'cancel' and status in ('queued', 'running'))
      or (p_action = 'retry' and status in ('failed', 'cancelled', 'abandoned'))
      or (p_action = 'recover_stale' and status = 'running' and lease_expires_at is not null and lease_expires_at < now())
      or (p_action = 'priority' and status in ('queued', 'running'))
    );
  if v_invalid > 0 then
    raise exception using errcode = 'P0001', message = 'AUDIT_STATE_CONFLICT';
  end if;

  if p_action = 'cancel' then
    update public.audits
    set status = 'cancelled',
        current_phase = 'Cancelled by administrator',
        cancelled_at = now(),
        locked_by = null,
        locked_at = null,
        lease_expires_at = null,
        updated_at = now()
    where id = any(p_audit_ids);
  elsif p_action = 'priority' then
    update public.audits
    set queue_priority = p_priority,
        updated_at = now()
    where id = any(p_audit_ids);
  else
    update public.audits
    set status = 'queued',
        current_phase = case when p_action = 'retry' then 'Retry queued' else 'Recovered and requeued' end,
        error = null,
        progress = 0,
        locked_by = null,
        locked_at = null,
        lease_expires_at = null,
        completed_at = null,
        cancelled_at = null,
        updated_at = now()
    where id = any(p_audit_ids);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'status', status,
    'queuePriority', queue_priority
  ) order by id), '[]'::jsonb)
  into v_updated
  from public.audits
  where id = any(p_audit_ids);

  return jsonb_build_object('updated', v_updated, 'updatedCount', v_requested);
end;
$$;

alter table public.admin_user_notes enable row level security;
alter table public.account_deletion_requests enable row level security;
alter table public.admin_operation_previews enable row level security;
-- No browser policies are created for these tables. Server-side service-role
-- routes perform authorization and return redacted, bounded response shapes.

drop policy if exists "users and admins can read profiles" on public.user_profiles;
drop policy if exists "active users can read own profile" on public.user_profiles;
drop policy if exists "users can create own basic profile" on public.user_profiles;
drop policy if exists "users can update own safe profile fields" on public.user_profiles;
drop policy if exists "owners and admins can read audits" on public.audits;
drop policy if exists "active users can read own audits" on public.audits;
drop policy if exists "browser clients can enqueue own audits only" on public.audits;
drop policy if exists "admins can update audits" on public.audits;
drop policy if exists "owners and admins can read audit events" on public.audit_events;
drop policy if exists "active users can read own audit events" on public.audit_events;
drop policy if exists "owners and admins can read audit pages" on public.audit_pages;
drop policy if exists "active users can read own audit pages" on public.audit_pages;
drop policy if exists "owners and admins can read audit issues" on public.audit_issues;
drop policy if exists "active users can read own audit issues" on public.audit_issues;
drop policy if exists "owners and admins can read audit reports" on public.audit_reports;
drop policy if exists "active users can read own audit reports" on public.audit_reports;
drop policy if exists "users can manage own projects" on public.projects;
drop policy if exists "users can manage own keywords" on public.keywords;
drop policy if exists "users can manage own competitors" on public.competitors;

create policy "active users can read own profile"
on public.user_profiles for select
to authenticated
using (auth.uid() = id and public.is_active_user(auth.uid()));

create policy "users can create own basic profile"
on public.user_profiles for insert
to authenticated
with check (
  auth.uid() = id
  and role = 'user'
  and plan = 'free'
  and subscription_status = 'inactive'
  and disabled = false
);

create policy "users can update own safe profile fields"
on public.user_profiles for update
to authenticated
using (auth.uid() = id and public.is_active_user(auth.uid()))
with check (auth.uid() = id and public.is_active_user(auth.uid()));

create policy "active users can read own audits"
on public.audits for select
to authenticated
using (user_id = auth.uid() and public.is_active_user(auth.uid()));

-- Migration 016 intentionally removed all browser audit writes. Do not recreate
-- enqueue or administrator-update policies here; the API service role remains
-- the only audit mutation path.

create policy "active users can read own audit events"
on public.audit_events for select
to authenticated
using (
  exists (
    select 1 from public.audits a
    where a.id = audit_events.audit_id
      and a.user_id = auth.uid()
      and public.is_active_user(auth.uid())
  )
);

create policy "active users can read own audit pages"
on public.audit_pages for select
to authenticated
using (
  exists (
    select 1 from public.audits a
    where a.id = audit_pages.audit_id
      and a.user_id = auth.uid()
      and public.is_active_user(auth.uid())
  )
);

create policy "active users can read own audit issues"
on public.audit_issues for select
to authenticated
using (
  exists (
    select 1 from public.audits a
    where a.id = audit_issues.audit_id
      and a.user_id = auth.uid()
      and public.is_active_user(auth.uid())
  )
);

create policy "active users can read own audit reports"
on public.audit_reports for select
to authenticated
using (
  exists (
    select 1 from public.audits a
    where a.id = audit_reports.audit_id
      and a.user_id = auth.uid()
      and public.is_active_user(auth.uid())
  )
);

create policy "active users can manage own projects"
on public.projects for all
to authenticated
using (auth.uid() = user_id and public.is_active_user(auth.uid()))
with check (auth.uid() = user_id and public.is_active_user(auth.uid()));

create policy "active users can manage own keywords"
on public.keywords for all
to authenticated
using (auth.uid() = user_id and public.is_active_user(auth.uid()))
with check (auth.uid() = user_id and public.is_active_user(auth.uid()));

create policy "active users can manage own competitors"
on public.competitors for all
to authenticated
using (auth.uid() = user_id and public.is_active_user(auth.uid()))
with check (auth.uid() = user_id and public.is_active_user(auth.uid()));

drop policy if exists "active accounts can use audit workflow" on public.audit_finding_workflow;
create policy "active accounts can use audit workflow"
on public.audit_finding_workflow
as restrictive
for all
to authenticated
using (public.is_active_user(auth.uid()))
with check (public.is_active_user(auth.uid()));

drop policy if exists "active accounts can read audit usage" on public.audit_usage_events;
create policy "active accounts can read audit usage"
on public.audit_usage_events
as restrictive
for all
to authenticated
using (public.is_active_user(auth.uid()))
with check (public.is_active_user(auth.uid()));

revoke all on table public.admin_user_notes from public, anon, authenticated;
revoke all on table public.account_deletion_requests from public, anon, authenticated;
revoke all on table public.admin_operation_previews from public, anon, authenticated;
grant all on table public.admin_user_notes to service_role;
grant all on table public.account_deletion_requests to service_role;
grant all on table public.admin_operation_previews to service_role;

revoke all on function public.is_active_user(uuid) from public, anon, authenticated;
revoke all on function public.admin_operations_timeseries(integer) from public, anon, authenticated;
revoke all on function public.admin_user_plan_distribution() from public, anon, authenticated;
revoke all on function public.admin_resource_inventory() from public, anon, authenticated;
revoke all on function public.admin_bulk_audit_operation(uuid[], text, integer) from public, anon, authenticated;
grant execute on function public.is_active_user(uuid) to authenticated, service_role;
grant execute on function public.admin_operations_timeseries(integer) to service_role;
grant execute on function public.admin_user_plan_distribution() to service_role;
grant execute on function public.admin_resource_inventory() to service_role;
grant execute on function public.admin_bulk_audit_operation(uuid[], text, integer) to service_role;

update public.deployment_versions
set api_schema_version = 13,
    updated_at = now()
where component = 'database';

commit;

-- Verification:
-- select public.is_admin_user(auth.uid()), public.is_active_user(auth.uid());
-- select * from public.admin_resource_inventory();
-- select * from public.admin_operations_timeseries(24);
-- select component, api_schema_version from public.deployment_versions where component = 'database';
