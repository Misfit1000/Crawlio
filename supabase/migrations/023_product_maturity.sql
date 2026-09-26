begin;

create or replace function public.guard_last_active_administrator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin'
     and old.disabled = false
     and (new.role <> 'admin' or new.disabled = true) then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('crawlio'), pg_catalog.hashtext('active_administrator'));
    if (select count(*) from public.user_profiles where role = 'admin' and disabled = false) <= 1 then
      raise exception 'The final active administrator cannot be removed.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_last_active_administrator() from public, anon, authenticated;

alter table public.audits
  add column if not exists checkpoint_pages_crawled integer not null default 0 check (checkpoint_pages_crawled >= 0),
  add column if not exists checkpoint_updated_at timestamptz null,
  add column if not exists checkpoint_state jsonb null
    check (checkpoint_state is null or (jsonb_typeof(checkpoint_state) = 'object' and octet_length(checkpoint_state::text) <= 262144));

alter table public.audit_finding_workflow
  add column if not exists assigned_to uuid null references auth.users(id) on delete set null;

create index if not exists audit_finding_workflow_assignee_due_idx
  on public.audit_finding_workflow (assigned_to, due_at)
  where assigned_to is not null and due_at is not null and status not in ('fixed', 'ignored', 'accepted_risk');

create or replace function public.validate_finding_workflow_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.assigned_to is not null and new.assigned_to <> new.user_id then
    raise exception 'finding workflow can only be assigned to its audit owner';
  end if;
  return new;
end;
$$;

drop trigger if exists audit_finding_workflow_validate_assignment on public.audit_finding_workflow;
create trigger audit_finding_workflow_validate_assignment
before insert or update of assigned_to, user_id on public.audit_finding_workflow
for each row execute function public.validate_finding_workflow_assignment();

revoke all on function public.validate_finding_workflow_assignment() from public, anon, authenticated;

create table if not exists public.project_data_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid null references public.projects(id) on delete cascade,
  source_kind text not null check (source_kind in ('search_performance', 'keyword_positions', 'backlink_evidence')),
  file_name text not null check (char_length(file_name) between 1 and 240),
  fingerprint text not null check (char_length(fingerprint) = 64),
  headers text[] not null default '{}',
  row_count integer not null default 0 check (row_count between 0 and 5000),
  imported_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '365 days'),
  unique (user_id, source_kind, fingerprint)
);

create table if not exists public.project_data_rows (
  id bigint generated always as identity primary key,
  import_id uuid not null references public.project_data_imports(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid null references public.projects(id) on delete cascade,
  source_kind text not null check (source_kind in ('search_performance', 'keyword_positions', 'backlink_evidence')),
  row_number integer not null check (row_number between 1 and 5000),
  values_json jsonb not null check (jsonb_typeof(values_json) = 'object' and octet_length(values_json::text) <= 16384),
  created_at timestamptz not null default now(),
  unique (import_id, row_number)
);

create index if not exists project_data_imports_owner_recent_idx
  on public.project_data_imports (user_id, imported_at desc);
create index if not exists project_data_imports_project_recent_idx
  on public.project_data_imports (project_id, imported_at desc) where project_id is not null;
create index if not exists project_data_imports_expiry_idx
  on public.project_data_imports (expires_at);
create index if not exists project_data_rows_import_order_idx
  on public.project_data_rows (import_id, row_number);

alter table public.project_data_imports enable row level security;
alter table public.project_data_rows enable row level security;
-- Imports are owner-checked and bounded by server APIs. Browser table access is intentionally unavailable.
revoke all on public.project_data_imports from anon, authenticated;
revoke all on public.project_data_rows from anon, authenticated;

create or replace function public.audit_history_summaries(
  p_user_id uuid,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  audit_id uuid,
  project_id uuid,
  normalized_url text,
  hostname text,
  status text,
  effective_mode text,
  pages_crawled integer,
  page_limit integer,
  issues_found integer,
  critical_count integer,
  created_at timestamptz,
  completed_at timestamptz,
  overall_score numeric,
  report_generated_at timestamptz,
  total_count bigint
)
language sql
security definer
set search_path = ''
as $$
  select
    a.id,
    a.project_id,
    a.normalized_url,
    a.hostname,
    a.status,
    a.effective_mode,
    a.pages_crawled,
    a.page_limit,
    a.issues_found,
    a.critical_count,
    a.created_at,
    a.completed_at,
    case when (r.scores ->> 'overall') ~ '^[0-9]+(\.[0-9]+)?$' then (r.scores ->> 'overall')::numeric else null end,
    r.generated_at,
    count(*) over()
  from public.audits a
  left join public.audit_reports r on r.audit_id = a.id
  where a.user_id = p_user_id and a.deleted_at is null
  order by a.created_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.audit_history_summaries(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.audit_history_summaries(uuid, integer, integer) to service_role;

create or replace function public.project_audit_summaries(p_user_id uuid)
returns table (
  id uuid,
  project_id uuid,
  normalized_url text,
  hostname text,
  status text,
  pages_crawled integer,
  issues_found integer,
  critical_count integer,
  high_count integer,
  completed_at timestamptz,
  created_at timestamptz,
  scores jsonb,
  top_issues jsonb
)
language sql
security definer
set search_path = ''
as $$
  with ranked as (
    select a.*,
      row_number() over (partition by lower(a.hostname) order by a.created_at desc) as site_rank
    from public.audits a
    where a.user_id = p_user_id and a.archived_at is null and a.deleted_at is null
  )
  select
    ranked.id,
    ranked.project_id,
    ranked.normalized_url,
    ranked.hostname,
    ranked.status,
    ranked.pages_crawled,
    ranked.issues_found,
    ranked.critical_count,
    ranked.high_count,
    ranked.completed_at,
    ranked.created_at,
    report.scores,
    report.top_issues
  from ranked
  left join public.audit_reports report on report.audit_id = ranked.id
  where ranked.site_rank <= 2
  order by ranked.created_at desc
  limit 200;
$$;

revoke all on function public.project_audit_summaries(uuid) from public, anon, authenticated;
grant execute on function public.project_audit_summaries(uuid) to service_role;

insert into public.data_retention_policies (data_class, retention_days, description, automatic_cleanup)
values ('project_data_imports', 365, 'Project-scoped user CSV imports and normalized rows.', true)
on conflict (data_class) do update set
  retention_days = excluded.retention_days,
  description = excluded.description,
  automatic_cleanup = excluded.automatic_cleanup,
  updated_at = now();

create or replace function public.run_data_retention_cleanup(p_apply boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_events integer;
  v_diagnostics integer;
  v_guest_audits integer;
  v_admissions integer;
  v_rate_windows integer;
  v_api_errors integer;
  v_project_imports integer;
begin
  select count(*) into v_events from public.audit_events where created_at < now() - interval '30 days';
  select count(*) into v_diagnostics from public.audit_diagnostics where created_at < now() - interval '30 days';
  select count(*) into v_guest_audits from public.audits where user_id is null and status in ('failed', 'abandoned') and created_at < now() - interval '7 days';
  select count(*) into v_admissions from public.audit_admissions where (decision = 'released' or created_at < now() - interval '30 days') and created_at < now() - interval '7 days';
  select count(*) into v_rate_windows from public.api_rate_limit_windows where updated_at < now() - interval '2 days';
  select count(*) into v_api_errors from public.api_error_logs where created_at < now() - interval '30 days';
  select count(*) into v_project_imports from public.project_data_imports where expires_at < now();
  if p_apply then
    delete from public.audit_events where created_at < now() - interval '30 days';
    delete from public.audit_diagnostics where created_at < now() - interval '30 days';
    delete from public.audits where user_id is null and status in ('failed', 'abandoned') and created_at < now() - interval '7 days';
    delete from public.audit_admissions where (decision = 'released' or created_at < now() - interval '30 days') and created_at < now() - interval '7 days';
    delete from public.api_rate_limit_windows where updated_at < now() - interval '2 days';
    delete from public.api_error_logs where created_at < now() - interval '30 days';
    delete from public.project_data_imports where expires_at < now();
  end if;
  return jsonb_build_object(
    'applied', p_apply,
    'activityEvents', v_events,
    'diagnostics', v_diagnostics,
    'failedGuestAudits', v_guest_audits,
    'admissions', v_admissions,
    'rateWindows', v_rate_windows,
    'apiErrors', v_api_errors,
    'projectDataImports', v_project_imports
  );
end;
$$;

revoke all on function public.run_data_retention_cleanup(boolean) from public, anon, authenticated;
grant execute on function public.run_data_retention_cleanup(boolean) to service_role;

update public.deployment_versions
set api_schema_version = 14,
    audit_engine_version = '2026.09',
    scoring_version = '2.1',
    check_registry_version = '3.0',
    updated_at = now()
where component = 'database';

commit;

-- Verification:
-- select tablename, rowsecurity from pg_tables where schemaname = 'public'
--   and tablename in ('project_data_imports', 'project_data_rows');
-- select component, api_schema_version, audit_engine_version, scoring_version, check_registry_version
--   from public.deployment_versions where component = 'database';
-- select proname, proconfig from pg_proc where proname in ('guard_last_active_administrator', 'validate_finding_workflow_assignment');
