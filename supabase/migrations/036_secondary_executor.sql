begin;

-- No schema downgrade: the secondary executor speaks schema 16 / processing 2.
alter table public.audits add column if not exists executor_type text;
alter table public.audits add column if not exists executor_instance_id text;
alter table public.audits add column if not exists executor_preference text not null default 'auto';
alter table public.audits add column if not exists audit_engine_version text;
alter table public.audits add column if not exists check_registry_version text;
alter table public.audits add column if not exists scoring_version text;
alter table public.audits add column if not exists evidence_version text;
alter table public.audit_crawl_runs add column if not exists executor_type text;
alter table public.audit_crawl_runs add column if not exists executor_instance_id text;
alter table public.audit_scalable_workers add column if not exists executor_type text not null default 'render';

create table if not exists public.audit_executor_health (
  worker_id text primary key check(length(worker_id)<=100),
  executor_type text not null check(executor_type in ('render','cloudflare')),
  commit_id text not null,
  api_schema_version integer not null,
  processing_version integer not null,
  scope_version integer not null,
  engine_version text not null,
  scoring_version text not null,
  checks_version text not null,
  status text not null check(status in ('idle','running','error','disabled')),
  current_audit_id uuid references public.audits(id) on delete set null,
  seen_at timestamptz not null default now(),
  completed_slices bigint not null default 0,
  last_error_code text
);
alter table public.audit_executor_health enable row level security;
revoke all on public.audit_executor_health from public,anon,authenticated;
grant all on public.audit_executor_health to service_role;

create or replace function public.track_audit_executor_owner()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.owner is not null then
    new.executor_type=case when new.owner like 'cloudflare:%' then 'cloudflare' else 'render' end;
    new.executor_instance_id=new.owner;
    update public.audits set executor_type=new.executor_type,executor_instance_id=new.owner where id=new.audit_id;
  end if;
  return new;
end $$;
drop trigger if exists track_audit_executor_owner on public.audit_crawl_runs;
create trigger track_audit_executor_owner before update of owner on public.audit_crawl_runs
  for each row when(new.owner is not null) execute function public.track_audit_executor_owner();
revoke all on function public.track_audit_executor_owner() from public,anon,authenticated;

create or replace function public.claim_secondary_audit(p_worker text,p_commit text,p_schema integer,p_engine text,p_scoring text,p_checks text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; job_id uuid;
begin
  if p_worker is null or p_commit is null or p_schema is null or p_engine is null or p_scoring is null or p_checks is null
    or p_worker !~ '^cloudflare:[a-zA-Z0-9_-]{1,70}$' or length(p_commit) not between 1 and 40
    or p_schema<>16 or p_engine<>'2026.09' or p_scoring<>'2.2' or p_checks<>'3.1' then
    raise exception 'SECONDARY_EXECUTOR_INCOMPATIBLE';
  end if;
  if not exists(select 1 from public.deployment_versions where component='api'
    and api_schema_version=p_schema and audit_engine_version=p_engine and scoring_version=p_scoring and check_registry_version=p_checks) then
    raise exception 'SECONDARY_EXECUTOR_INCOMPATIBLE';
  end if;
  insert into public.audit_scalable_workers(worker_id,seen_at,processing_version,commit_id,deep_enabled,scope_version,scope_commit_id,executor_type)
    values(p_worker,now(),2,p_commit,true,1,p_commit,'cloudflare') on conflict(worker_id) do update
    set seen_at=now(),processing_version=2,commit_id=p_commit,deep_enabled=true,scope_version=1,scope_commit_id=p_commit,executor_type='cloudflare';
  -- The same fair, host-exclusive claim path used by Render owns the crawl run.
  -- It increments the durable generation, not merely the public audit row.
  result=public.claim_efficient_scoped_audit(p_worker,true);
  job_id=(result->'audit'->>'id')::uuid;
  if job_id is not null then
    update public.audits set executor_type='cloudflare',executor_instance_id=p_worker,
      worker_runtime='cloudflare-durable-v2',audit_engine_version=p_engine,
      scoring_version=p_scoring,check_registry_version=p_checks,evidence_version='1' where id=job_id;
    update public.audit_crawl_runs set executor_type='cloudflare',executor_instance_id=p_worker where audit_id=job_id;
  end if;
  insert into public.audit_executor_health(worker_id,executor_type,commit_id,api_schema_version,processing_version,scope_version,engine_version,scoring_version,checks_version,status,current_audit_id)
    values(p_worker,'cloudflare',p_commit,p_schema,2,1,p_engine,p_scoring,p_checks,case when job_id is null then 'idle' else 'running' end,job_id)
    on conflict(worker_id) do update set commit_id=p_commit,seen_at=now(),status=excluded.status,current_audit_id=job_id,last_error_code=null;
  return result;
end $$;

create or replace function public.secondary_executor_slice_finished(p_worker text,p_error_code text default null)
returns void language sql security definer set search_path=public,pg_temp as $$
  update public.audit_executor_health set seen_at=now(),status=case when p_error_code is null then 'idle' else 'error' end,
    current_audit_id=null,completed_slices=completed_slices+case when p_error_code is null then 1 else 0 end,
    last_error_code=left(p_error_code,80) where worker_id=p_worker and executor_type='cloudflare';
$$;

-- Remove the prototype claim-only RPC if it was installed manually.
do $$ declare f record; begin
  for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname='claim_audit_for_executor' loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  end loop;
end $$;
revoke all on function public.claim_secondary_audit(text,text,integer,text,text,text),public.secondary_executor_slice_finished(text,text) from public,anon,authenticated;
grant execute on function public.claim_secondary_audit(text,text,integer,text,text,text),public.secondary_executor_slice_finished(text,text) to service_role;
notify pgrst,'reload schema';
commit;
