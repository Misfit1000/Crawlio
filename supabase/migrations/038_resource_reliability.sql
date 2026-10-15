begin;

alter table public.audits add column if not exists first_page_at timestamptz;
create or replace function public.observe_first_audit_page() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if old.first_page_at is not null then new.first_page_at=old.first_page_at;
  elsif coalesce(new.pages_crawled,0)>0 and coalesce(old.pages_crawled,0)=0 then new.first_page_at=clock_timestamp();
  end if;
  return new;
end $$;
drop trigger if exists audit_first_page_timing on public.audits;
create trigger audit_first_page_timing before update on public.audits for each row
when (old.first_page_at is not null or (new.pages_crawled>0 and old.pages_crawled=0))
execute function public.observe_first_audit_page();

create table if not exists public.audit_launch_observations (
  audit_id uuid primary key references public.audits(id) on delete cascade,
  auth_ms double precision not null check(auth_ms between 0 and 120000),
  admission_ms double precision not null check(admission_ms between 0 and 120000),
  response_preparation_ms double precision not null check(response_preparation_ms between 0 and 120000),
  observed_at timestamptz not null default now()
);
create index if not exists audit_launch_observed on public.audit_launch_observations(observed_at);
create table if not exists public.domain_evidence_refresh (
  domain text primary key check(length(domain) between 1 and 253),
  owner uuid, lease_until timestamptz, retry_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists domain_refresh_expiry on public.domain_evidence_refresh(updated_at);
create table if not exists public.provider_lookup_budgets (
  period text not null check(period in ('month','minute')),
  window_start timestamptz not null,
  reserved integer not null default 0 check(reserved>=0),
  primary key(period,window_start)
);
create table if not exists public.resource_maintenance (
  name text primary key, last_run_at timestamptz not null, counts jsonb not null default '{}'
);

alter table public.audit_launch_observations enable row level security;
alter table public.domain_evidence_refresh enable row level security;
alter table public.provider_lookup_budgets enable row level security;
alter table public.resource_maintenance enable row level security;
revoke all on public.audit_launch_observations,public.domain_evidence_refresh,public.provider_lookup_budgets,public.resource_maintenance from public,anon,authenticated;
grant all on public.audit_launch_observations,public.domain_evidence_refresh,public.provider_lookup_budgets,public.resource_maintenance to service_role;

create or replace function public.claim_domain_evidence_refresh(p_domain text,p_owner uuid,p_include_opr boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cached public.domain_evidence_cache%rowtype; lease public.domain_evidence_refresh%rowtype;
  opr_fresh boolean; others_fresh boolean; allowed boolean:=false; reason text;
  month_start timestamptz:=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
  minute_start timestamptz:=date_trunc('minute',now()); monthly integer; per_minute integer;
begin
  if p_owner is null or p_domain !~ '^[a-z0-9][a-z0-9.-]{0,251}[a-z0-9]$' then raise exception 'INVALID_EVIDENCE_REQUEST'; end if;
  perform pg_advisory_xact_lock(hashtext('domain-evidence:'||p_domain));
  select * into cached from public.domain_evidence_cache where domain=p_domain;
  opr_fresh=coalesce((cached.payload#>>'{openPageRank,fetchedAt}')::timestamptz>now()-interval '24 hours',false);
  others_fresh=coalesce((cached.payload#>>'{tranco,fetchedAt}')::timestamptz>now()-interval '24 hours',false)
    and coalesce((cached.payload#>>'{majestic,fetchedAt}')::timestamptz>now()-interval '24 hours',false);
  if others_fresh and (not p_include_opr or opr_fresh) then return jsonb_build_object('state','fresh','cache',to_jsonb(cached)); end if;
  select * into lease from public.domain_evidence_refresh where domain=p_domain;
  if lease.lease_until>now() then return jsonb_build_object('state','busy','cache',to_jsonb(cached)); end if;
  if lease.retry_at>now() then return jsonb_build_object('state','cooldown','cache',to_jsonb(cached),'retryAt',lease.retry_at); end if;
  if p_include_opr and not opr_fresh then
    perform pg_advisory_xact_lock(hashtext('openpagerank-budget'));
    insert into public.provider_lookup_budgets(period,window_start) values('month',month_start),('minute',minute_start) on conflict do nothing;
    select reserved into monthly from public.provider_lookup_budgets where period='month' and window_start=month_start;
    select reserved into per_minute from public.provider_lookup_budgets where period='minute' and window_start=minute_start;
    if monthly>=27000 then reason='monthly_budget';
    elsif per_minute>=50 then reason='minute_budget';
    else
      allowed=true;
      update public.provider_lookup_budgets set reserved=reserved+1 where (period='month' and window_start=month_start) or (period='minute' and window_start=minute_start);
    end if;
  end if;
  insert into public.domain_evidence_refresh(domain,owner,lease_until,retry_at,updated_at)
    values(p_domain,p_owner,now()+interval '30 seconds',now(),now())
    on conflict(domain) do update set owner=excluded.owner,lease_until=excluded.lease_until,retry_at=excluded.retry_at,updated_at=excluded.updated_at;
  return jsonb_build_object('state','claimed','openPageRankAllowed',allowed,'reason',reason,'cache',to_jsonb(cached));
end $$;

create or replace function public.finish_domain_evidence_refresh(p_domain text,p_owner uuid,p_row jsonb,p_retry_seconds integer default 0)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtext('domain-evidence:'||p_domain));
  if not exists(select 1 from public.domain_evidence_refresh where domain=p_domain and owner=p_owner and lease_until>=now()) then return false; end if;
  if p_row is not null then
    if p_row->>'domain'<>p_domain or p_row#>>'{payload,version}'<>'1' or octet_length(p_row::text)>600000
      or (p_row->>'stale_until')::timestamptz>(p_row->>'fetched_at')::timestamptz+interval '7 days'
      or (p_row->>'fresh_until')::timestamptz>(p_row->>'fetched_at')::timestamptz+interval '24 hours'
      or (p_row->>'fetched_at')::timestamptz>now()+interval '5 seconds' then raise exception 'INVALID_EVIDENCE_CACHE'; end if;
    insert into public.domain_evidence_cache(domain,payload,fetched_at,fresh_until,stale_until)
      values(p_domain,p_row->'payload',(p_row->>'fetched_at')::timestamptz,(p_row->>'fresh_until')::timestamptz,(p_row->>'stale_until')::timestamptz)
      on conflict(domain) do update set payload=excluded.payload,fetched_at=excluded.fetched_at,fresh_until=excluded.fresh_until,stale_until=excluded.stale_until;
  end if;
  update public.domain_evidence_refresh set owner=null,lease_until=null,retry_at=now()+make_interval(secs=>greatest(0,least(300,p_retry_seconds))),updated_at=now() where domain=p_domain;
  return true;
end $$;

create or replace function public.cleanup_resource_evidence() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare evidence integer; leases integer; observations integer; budgets integer; usage integer; counts jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtext('resource-evidence-maintenance')) then return jsonb_build_object('skipped',true); end if;
  if exists(select 1 from public.resource_maintenance where name='evidence' and last_run_at>now()-interval '15 minutes') then return jsonb_build_object('skipped',true); end if;
  delete from public.domain_evidence_cache where domain in (select domain from public.domain_evidence_cache where stale_until<now() order by stale_until limit 100); get diagnostics evidence=row_count;
  delete from public.domain_evidence_refresh where domain in (select domain from public.domain_evidence_refresh where updated_at<now()-interval '1 day' and coalesce(lease_until,now()-interval '1 second')<now() order by updated_at limit 100); get diagnostics leases=row_count;
  delete from public.audit_launch_observations where audit_id in (select audit_id from public.audit_launch_observations where observed_at<now()-interval '30 days' order by observed_at limit 100); get diagnostics observations=row_count;
  delete from public.provider_lookup_budgets where (period,window_start) in (select period,window_start from public.provider_lookup_budgets where (period='minute' and window_start<now()-interval '1 day') or (period='month' and window_start<now()-interval '2 months') order by window_start limit 100); get diagnostics budgets=row_count;
  delete from public.preview_daily_usage where usage_day in (select usage_day from public.preview_daily_usage where usage_day<(now() at time zone 'UTC')::date-30 order by usage_day limit 10); get diagnostics usage=row_count;
  counts=jsonb_build_object('evidence',evidence,'refreshLeases',leases,'timingSamples',observations,'budgetWindows',budgets,'previewDays',usage);
  insert into public.resource_maintenance(name,last_run_at,counts) values('evidence',now(),counts) on conflict(name) do update set last_run_at=excluded.last_run_at,counts=excluded.counts;
  return counts;
end $$;

create or replace function public.admin_capacity_snapshot(p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare previews jsonb; provider jsonb; timings jsonb; maintenance jsonb;
begin
  if not exists(select 1 from public.user_profiles where id=p_actor and plan='admin' and not disabled) then raise exception 'ADMIN_REQUIRED'; end if;
  select jsonb_build_object('dailyBudgetMs',480000,'consumedMs',coalesce(u.consumed_ms,0),'reservedMs',coalesce(u.reserved_ms,0),
    'remainingMs',greatest(0,480000-coalesce(u.consumed_ms,0)-coalesce(u.reserved_ms,0)),
    'resetAt',((now() at time zone 'UTC')::date+1)::timestamp at time zone 'UTC',
    'queued',(select count(*) from public.site_preview_captures where status='queued'),
    'running',(select count(*) from public.site_preview_captures where status='running'),
    'storageBytes',(select coalesce(sum(desktop_bytes::bigint+mobile_bytes),0) from public.site_preview_captures),
    'storageLimitBytes',104857600,'retentionDays',7,'reuseHours',24)
    into previews from (select 1) seed left join public.preview_daily_usage u on u.usage_day=(now() at time zone 'UTC')::date;
  select jsonb_build_object('applicationMonthlyLimit',27000,'providerFreeMonthlyLimit',30000,'applicationMinuteLimit',50,
    'monthlyReserved',coalesce((select reserved from public.provider_lookup_budgets where period='month' and window_start=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'),0),
    'minuteReserved',coalesce((select reserved from public.provider_lookup_budgets where period='minute' and window_start=date_trunc('minute',now())),0),
    'resetAt',(date_trunc('month',now() at time zone 'UTC')+interval '1 month') at time zone 'UTC',
    'activeRefreshes',(select count(*) from public.domain_evidence_refresh where lease_until>now())) into provider;
  with recent as (select id,status,created_at,started_at,first_page_at,completed_at from public.audits where created_at>now()-interval '7 days' and deleted_at is null order by created_at desc limit 5000),
  observations as (select l.* from public.audit_launch_observations l join recent a on a.id=l.audit_id)
  select jsonb_build_object('windowDays',7,'auditSampleCount',(select count(*) from recent),'maxSamples',5000,
    'admission', (select jsonb_build_object('samples',count(*),'p50Ms',percentile_cont(0.5) within group(order by admission_ms),'p95Ms',percentile_cont(0.95) within group(order by admission_ms)) from observations),
    'serverPreparation',(select jsonb_build_object('samples',count(*),'p50Ms',percentile_cont(0.5) within group(order by response_preparation_ms),'p95Ms',percentile_cont(0.95) within group(order by response_preparation_ms)) from observations),
    'queue',(select jsonb_build_object('samples',count(*),'p50Ms',percentile_cont(0.5) within group(order by extract(epoch from(started_at-created_at))*1000),'p95Ms',percentile_cont(0.95) within group(order by extract(epoch from(started_at-created_at))*1000)) from recent where started_at>=created_at),
    'firstPage',(select jsonb_build_object('samples',count(*),'p50Ms',percentile_cont(0.5) within group(order by extract(epoch from(first_page_at-started_at))*1000),'p95Ms',percentile_cont(0.95) within group(order by extract(epoch from(first_page_at-started_at))*1000)) from recent where first_page_at>=started_at),
    'completion',(select jsonb_build_object('samples',count(*),'p50Ms',percentile_cont(0.5) within group(order by extract(epoch from(completed_at-created_at))*1000),'p95Ms',percentile_cont(0.95) within group(order by extract(epoch from(completed_at-created_at))*1000)) from recent where status in ('completed','completed_with_warnings') and completed_at>=created_at)) into timings;
  select jsonb_build_object('lastRunAt',last_run_at,'counts',counts) into maintenance from public.resource_maintenance where name='evidence';
  return jsonb_build_object('observedAt',now(),'previews',previews,'openPageRank',provider,'timings',timings,'maintenance',maintenance);
end $$;

do $$ declare f record; begin
  for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in
    ('observe_first_audit_page','claim_domain_evidence_refresh','finish_domain_evidence_refresh','cleanup_resource_evidence','admin_capacity_snapshot') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
