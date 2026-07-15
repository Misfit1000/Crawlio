-- Durable, bounded Vercel blog stages. Historical worker records remain unchanged.
begin;

alter table public.blog_generation_jobs
  add column if not exists execution_target text not null default 'legacy_render',
  add column if not exists workflow_stage text not null default 'queued',
  add column if not exists stage_attempt_count integer not null default 0,
  add column if not exists stage_outputs jsonb not null default '{}'::jsonb,
  add column if not exists stage_progress integer not null default 0,
  add column if not exists status_message text not null default 'Waiting to start',
  add column if not exists next_retry_at timestamptz null,
  add column if not exists last_stage_at timestamptz null,
  add column if not exists last_safe_error_code text not null default '';

-- Existing rows keep the value written by the add-column default. Only future jobs use Vercel.
alter table public.blog_generation_jobs alter column execution_target set default 'vercel';
alter table public.blog_generation_jobs alter column provider set default 'groq';
alter table public.blog_generation_jobs alter column model set default 'openai/gpt-oss-120b';
alter table public.blog_generation_jobs alter column prompt_version set default 'groq-vercel-v1';
alter table public.blog_generation_jobs drop constraint if exists blog_generation_jobs_execution_target_check;
alter table public.blog_generation_jobs add constraint blog_generation_jobs_execution_target_check
  check (execution_target in ('legacy_render', 'vercel'));
alter table public.blog_generation_jobs drop constraint if exists blog_generation_jobs_workflow_stage_check;
alter table public.blog_generation_jobs add constraint blog_generation_jobs_workflow_stage_check check (workflow_stage in (
  'queued','source_collection','source_validation','topic_evaluation','research_organisation',
  'content_gap_analysis','brief_generation','outline_generation','section_drafting','article_assembly',
  'editorial_review','metadata_generation','claim_validation','originality_validation','link_validation',
  'image_processing','quality_gate','ready_for_review','scheduled','publishing','published','failed','cancelled'
));
alter table public.blog_generation_jobs drop constraint if exists blog_generation_jobs_stage_progress_check;
alter table public.blog_generation_jobs add constraint blog_generation_jobs_stage_progress_check check (stage_progress between 0 and 100);
alter table public.blog_generation_jobs drop constraint if exists blog_generation_jobs_stage_attempt_check;
alter table public.blog_generation_jobs add constraint blog_generation_jobs_stage_attempt_check check (stage_attempt_count between 0 and 20);

create index if not exists blog_jobs_vercel_dispatch_idx
  on public.blog_generation_jobs (workflow_stage, next_retry_at, scheduled_for, created_at)
  where execution_target = 'vercel' and workflow_stage not in ('published','failed','cancelled','ready_for_review','scheduled');
create index if not exists blog_jobs_vercel_lease_idx
  on public.blog_generation_jobs (lease_expires_at)
  where execution_target = 'vercel' and lease_expires_at is not null;

-- Migration 013 created this diagnostics table. Recreate it safely when an
-- environment has the blog queue but missed that optional migration section.
create table if not exists public.blog_provider_health (
  id bigint generated always as identity primary key,
  provider text not null,
  model text not null,
  status text not null,
  safe_error_code text not null default '',
  duration_ms integer null check (duration_ms is null or duration_ms >= 0),
  test_kind text not null default 'admin_test',
  actor_id uuid null,
  created_at timestamptz not null default now()
);
create index if not exists blog_provider_health_created_idx
  on public.blog_provider_health (created_at desc);

do $$
begin
  if to_regclass('public.user_profiles') is not null
    and not exists (
      select 1 from pg_constraint
      where conrelid = 'public.blog_provider_health'::regclass
        and contype = 'f'
        and conname = 'blog_provider_health_actor_id_fkey'
    ) then
    alter table public.blog_provider_health
      add constraint blog_provider_health_actor_id_fkey
      foreign key (actor_id) references public.user_profiles(id) on delete set null;
  end if;
end $$;

-- Preserve NVIDIA health history while allowing all future provider checks to record Groq.
alter table public.blog_provider_health drop constraint if exists blog_provider_health_provider_check;
alter table public.blog_provider_health add constraint blog_provider_health_provider_check
  check (provider in ('nvidia_nim', 'groq'));
alter table public.blog_provider_health enable row level security;
drop policy if exists "admins read blog provider health" on public.blog_provider_health;
create policy "admins read blog provider health" on public.blog_provider_health for select to authenticated
  using (public.is_admin_user(auth.uid()));
drop policy if exists "admins insert blog provider health" on public.blog_provider_health;
create policy "admins insert blog provider health" on public.blog_provider_health for insert to authenticated
  with check (public.is_admin_user(auth.uid()));
grant select, insert on public.blog_provider_health to authenticated;

do $$
declare identity_sequence text;
begin
  identity_sequence := pg_get_serial_sequence('public.blog_provider_health', 'id');
  if identity_sequence is not null then
    execute format('grant usage, select on sequence %s to authenticated', identity_sequence);
  end if;
end $$;

create table if not exists public.blog_dispatcher_state (
  id text primary key default 'vercel',
  last_dispatch_at timestamptz null,
  last_successful_stage_at timestamptz null,
  last_recovery_at timestamptz null,
  dispatched_stages bigint not null default 0,
  recovered_jobs bigint not null default 0,
  consecutive_rate_limits integer not null default 0,
  provider_pause_until timestamptz null,
  last_safe_error_code text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.blog_dispatcher_state (id) values ('vercel') on conflict (id) do nothing;
alter table public.blog_dispatcher_state enable row level security;
drop policy if exists "admins read blog dispatcher state" on public.blog_dispatcher_state;
create policy "admins read blog dispatcher state" on public.blog_dispatcher_state for select to authenticated
  using (public.is_admin_user(auth.uid()));

create or replace function public.claim_vercel_blog_stage(
  execution_id text,
  lease_seconds integer default 240,
  requested_job_id uuid default null
)
returns setof public.blog_generation_jobs
language plpgsql security definer set search_path = public as $$
declare claimed public.blog_generation_jobs;
begin
  if execution_id is null or length(execution_id) < 8 or execution_id !~ '^vercel-blog:' then return; end if;
  if not pg_try_advisory_xact_lock(hashtext('seointel:vercel-blog:max-concurrency-1')) then return; end if;
  if exists (select 1 from public.blog_dispatcher_state where id = 'vercel' and provider_pause_until > now()) then return; end if;

  -- Keep the conservative initial capacity limit: one active Vercel blog workflow.
  if exists (
    select 1 from public.blog_generation_jobs
    where execution_target = 'vercel' and locked_by is not null and lease_expires_at > now()
      and (requested_job_id is null or id <> requested_job_id)
  ) then return; end if;

  select * into claimed from public.blog_generation_jobs
  where execution_target = 'vercel'
    and (requested_job_id is null or id = requested_job_id)
    and workflow_stage not in ('published','failed','cancelled','ready_for_review','scheduled')
    and state not in ('published','failed','cancelled','skipped')
    and (scheduled_for is null or scheduled_for <= now())
    and (next_retry_at is null or next_retry_at <= now())
    and (locked_by is null or lease_expires_at is null or lease_expires_at < now())
    and stage_attempt_count < max_attempts
  order by case when requested_job_id is not null then 0 else 1 end, created_at asc
  for update skip locked limit 1;
  if claimed.id is null then return; end if;

  update public.blog_generation_jobs set
    locked_by = left(execution_id, 160), locked_at = now(), lease_expires_at = now() + make_interval(secs => greatest(30, least(600, lease_seconds))),
    stage_attempt_count = stage_attempt_count + 1,
    last_stage_at = now(), status_message = 'Processing ' || replace(workflow_stage, '_', ' '), updated_at = now()
  where id = claimed.id returning * into claimed;
  update public.blog_dispatcher_state set last_dispatch_at = now(), updated_at = now() where id = 'vercel';
  return next claimed;
end;
$$;

create or replace function public.complete_vercel_blog_stage(
  job_id uuid,
  execution_id text,
  expected_stage text,
  next_stage text,
  next_state text,
  output_patch jsonb default '{}'::jsonb,
  progress_value integer default 0,
  message_value text default ''
)
returns setof public.blog_generation_jobs
language plpgsql security definer set search_path = public as $$
declare completed public.blog_generation_jobs;
begin
  update public.blog_generation_jobs set
    workflow_stage = next_stage,
    state = next_state,
    stage_outputs = stage_outputs || coalesce(output_patch, '{}'::jsonb),
    stage_progress = greatest(0, least(100, progress_value)),
    status_message = left(coalesce(nullif(message_value, ''), replace(next_stage, '_', ' ')), 240),
    stage_attempt_count = 0, locked_by = null, locked_at = null, lease_expires_at = null,
    next_retry_at = null, last_safe_error_code = '', error = '', last_stage_at = now(), updated_at = now(),
    completed_at = case when next_stage in ('published','failed','cancelled','ready_for_review','scheduled') then now() else completed_at end
  where id = job_id and execution_target = 'vercel' and workflow_stage = expected_stage
    and locked_by = execution_id and lease_expires_at > now()
  returning * into completed;
  if completed.id is null then return; end if;
  update public.blog_dispatcher_state set last_successful_stage_at = now(), dispatched_stages = dispatched_stages + 1, last_safe_error_code = '', updated_at = now() where id = 'vercel';
  return next completed;
end;
$$;

create or replace function public.defer_vercel_blog_stage(
  job_id uuid, execution_id text, expected_stage text, safe_error_code text,
  safe_message text, retry_at timestamptz, terminal boolean default false
)
returns setof public.blog_generation_jobs
language plpgsql security definer set search_path = public as $$
declare deferred public.blog_generation_jobs;
begin
  update public.blog_generation_jobs set
    workflow_stage = workflow_stage,
    state = case when terminal then 'failed' else 'queued' end,
    last_safe_error_code = left(coalesce(safe_error_code, 'BLOG_STAGE_FAILED'), 100),
    error = left(coalesce(safe_message, 'Blog stage could not complete.'), 500),
    status_message = left(coalesce(safe_message, 'Waiting to retry'), 240),
    next_retry_at = case when terminal then null else retry_at end,
    locked_by = null, locked_at = null, lease_expires_at = null, updated_at = now(),
    completed_at = case when terminal then now() else null end
  where id = job_id and execution_target = 'vercel' and workflow_stage = expected_stage and locked_by = execution_id
  returning * into deferred;
  if deferred.id is null then return; end if;
  update public.blog_dispatcher_state set
    last_safe_error_code = deferred.last_safe_error_code,
    consecutive_rate_limits = case when deferred.last_safe_error_code = 'GROQ_RATE_LIMITED' then consecutive_rate_limits + 1 else 0 end,
    provider_pause_until = case when deferred.last_safe_error_code = 'GROQ_RATE_LIMITED' and consecutive_rate_limits + 1 >= 3 then now() + interval '15 minutes' else provider_pause_until end,
    updated_at = now()
  where id = 'vercel';
  return next deferred;
end;
$$;

create or replace function public.recover_vercel_blog_jobs(recovery_limit integer default 10)
returns integer language plpgsql security definer set search_path = public as $$
declare recovered integer;
begin
  with candidates as (
    select id from public.blog_generation_jobs
    where execution_target = 'vercel' and lease_expires_at < now()
      and workflow_stage not in ('published','failed','cancelled','ready_for_review','scheduled')
    order by lease_expires_at asc for update skip locked limit greatest(1, least(50, recovery_limit))
  )
  update public.blog_generation_jobs j set locked_by = null, locked_at = null, lease_expires_at = null,
    next_retry_at = now(), status_message = 'Recovered after an interrupted stage', updated_at = now()
  from candidates where j.id = candidates.id;
  get diagnostics recovered = row_count;
  update public.blog_dispatcher_state set last_recovery_at = now(), recovered_jobs = recovered_jobs + recovered, updated_at = now() where id = 'vercel';
  return recovered;
end;
$$;

revoke all on function public.claim_blog_generation_job(text, integer) from public, anon, authenticated;
revoke all on function public.claim_vercel_blog_stage(text, integer, uuid) from public, anon, authenticated;
revoke all on function public.complete_vercel_blog_stage(uuid, text, text, text, text, jsonb, integer, text) from public, anon, authenticated;
revoke all on function public.defer_vercel_blog_stage(uuid, text, text, text, text, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.recover_vercel_blog_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_vercel_blog_stage(text, integer, uuid) to service_role;
grant execute on function public.complete_vercel_blog_stage(uuid, text, text, text, text, jsonb, integer, text) to service_role;
grant execute on function public.defer_vercel_blog_stage(uuid, text, text, text, text, timestamptz, boolean) to service_role;
grant execute on function public.recover_vercel_blog_jobs(integer) to service_role;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='blog_generation_jobs') then
    alter publication supabase_realtime add table public.blog_generation_jobs;
  end if;
exception when undefined_object then null;
end $$;

-- Verify after application:
-- select execution_target, count(*) from public.blog_generation_jobs group by execution_target;
-- select proname from pg_proc where proname like '%vercel_blog%';
-- select tablename, rowsecurity from pg_tables where tablename = 'blog_dispatcher_state';
-- Rollback: disable dispatch first. Export stage_outputs, then drop these RPCs/table/columns.
commit;
