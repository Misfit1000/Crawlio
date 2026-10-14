begin;

create table if not exists public.domain_evidence_cache (
  domain text primary key check(length(domain) between 1 and 253),
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  fresh_until timestamptz not null,
  stale_until timestamptz not null
);
create index if not exists domain_evidence_cache_expiry on public.domain_evidence_cache(stale_until);

create table if not exists public.site_preview_captures (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,
  target_url text not null check(length(target_url)<=8192),
  final_url text,
  status text not null default 'queued' check(status in ('queued','running','captured','blocked','quota_exhausted','unavailable')),
  generation integer not null default 0,
  attempts integer not null default 0,
  worker_id text,
  lease_until timestamptz,
  reserved_day date,
  desktop_path text,
  mobile_path text,
  desktop_bytes integer not null default 0 check(desktop_bytes between 0 and 409600),
  mobile_bytes integer not null default 0 check(mobile_bytes between 0 and 409600),
  failure_code text,
  captured_at timestamptz,
  fresh_until timestamptz,
  expires_at timestamptz not null default now()+interval '7 days',
  retry_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists site_preview_pending on public.site_preview_captures(retry_at,created_at) where status in ('queued','running');
create index if not exists site_preview_expiry on public.site_preview_captures(expires_at,captured_at);
create table if not exists public.audit_preview_links (
  audit_id uuid primary key references public.audits(id) on delete cascade,
  capture_id uuid not null references public.site_preview_captures(id) on delete cascade
);
create index if not exists audit_preview_capture on public.audit_preview_links(capture_id);
create table if not exists public.preview_daily_usage (
  usage_day date primary key,
  reserved_ms integer not null default 0 check(reserved_ms>=0),
  consumed_ms integer not null default 0 check(consumed_ms>=0)
);

alter table public.domain_evidence_cache enable row level security;
alter table public.site_preview_captures enable row level security;
alter table public.audit_preview_links enable row level security;
alter table public.preview_daily_usage enable row level security;
revoke all on public.domain_evidence_cache,public.site_preview_captures,public.audit_preview_links,public.preview_daily_usage from public,anon,authenticated;
grant all on public.domain_evidence_cache,public.site_preview_captures,public.audit_preview_links,public.preview_daily_usage to service_role;

insert into storage.buckets(id,name,public) values('audit-previews','audit-previews',false) on conflict(id) do update set public=false;

-- This wrapper keeps the established admission policies, but makes the accepted
-- reservation, immutable job, initial event and quota charge one transaction.
create or replace function public.submit_audit_job(
  p_audit_id uuid,p_user_id uuid,p_guest_key_hash text,p_ip_hash text,p_submitted_input text,
  p_normalized_url text,p_hostname text,p_mode text,p_scope jsonb default null,p_project_id uuid default null,
  p_bot_verified boolean default false,p_guest_daily_limit integer default 2,p_domain_daily_limit integer default 2,
  p_global_active_limit integer default 50,p_allow_sleeping boolean default false
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  profile public.user_profiles%rowtype; limits public.plan_limits%rowtype; decision jsonb; job public.audits%rowtype;
  chosen_plan text:='free'; groups text[]; fingerprint text; allowance integer; configured integer; ceiling integer;
  scope_ready boolean; deep_ready boolean; existing_id uuid; current_day timestamptz:=date_trunc('day',now());
begin
  if (p_user_id is null)=(p_guest_key_hash is null) or p_mode not in ('quick','standard','deep')
    or p_audit_id is null or p_normalized_url !~ '^https?://' or length(p_normalized_url)>8192
    or length(p_hostname) not between 1 and 253 or length(p_submitted_input)>8192 then
    raise exception 'INVALID_AUDIT_REQUEST';
  end if;
  if p_scope is not null then
    if coalesce(p_scope->>'version','')<>'1' or coalesce(p_scope->>'coverage','') not in ('page','site')
      or coalesce(p_scope->>'focus','') not in ('full','custom','seo','technical','crawlability','links','performance','structured-data','accessibility','security')
      or coalesce(jsonb_typeof(p_scope->'checkGroups'),'')<>'array' then
      raise exception 'INVALID_AUDIT_SCOPE';
    end if;
    if jsonb_array_length(p_scope->'checkGroups') not between 1 and 8 then raise exception 'INVALID_AUDIT_SCOPE'; end if;
    select array_agg(g order by ord) into groups from unnest(array['seo','technical','crawlability','links','performance','structured-data','accessibility','security']) with ordinality t(g,ord)
      where p_scope->'checkGroups' ? g;
    if coalesce(array_length(groups,1),0)<>jsonb_array_length(p_scope->'checkGroups')
      or (p_scope->>'focus'='full' and array_length(groups,1)<>8)
      or (p_scope->>'focus' not in ('full','custom') and (array_length(groups,1)<>1 or groups[1]<>p_scope->>'focus')) then
      raise exception 'INVALID_AUDIT_SCOPE';
    end if;
    fingerprint='v1:'||(p_scope->>'coverage')||':'||case when p_scope->>'focus'='full' then 'full' else 'selected' end||':'||array_to_string(groups,',');
  else
    fingerprint='v1:site:full:seo,technical,crawlability,links,performance,structured-data,accessibility,security';
  end if;
  if p_user_id is not null then
    select * into profile from public.user_profiles where id=p_user_id for update;
    if not found then return jsonb_build_object('allowed',false,'code','PROFILE_REQUIRED'); end if;
    if profile.disabled then return jsonb_build_object('allowed',false,'code','ACCOUNT_SUSPENDED'); end if;
    chosen_plan=profile.plan;
  end if;
  select * into limits from public.plan_limits where plan=chosen_plan;
  if not found then return jsonb_build_object('allowed',false,'code','PLAN_CONFIGURATION_UNAVAILABLE'); end if;
  configured=case p_mode when 'quick' then limits.max_pages_quick when 'standard' then limits.max_pages_standard else limits.max_pages_deep end;
  if not(limits.allowed_modes ? p_mode) or configured<=0 then return jsonb_build_object('allowed',false,'code','PLAN_MODE_UNAVAILABLE'); end if;
  ceiling=case when chosen_plan='admin' then 5000 else 500 end;
  configured=least(configured,ceiling);
  allowance=case when p_scope->>'coverage'='page' then 1 else configured end;
  if p_project_id is not null and not exists(select 1 from public.projects where id=p_project_id and user_id=p_user_id and lower(hostname)=lower(p_hostname)) then
    return jsonb_build_object('allowed',false,'code','PROJECT_NOT_FOUND');
  end if;
  if not exists(select 1 from public.deployment_versions where component='database' and api_schema_version>=16) then
    return jsonb_build_object('allowed',false,'code','MIGRATION_REQUIRED');
  end if;
  select coalesce(bool_or(scope_version=1 and scope_commit_id=commit_id),false),
    coalesce(bool_or(deep_enabled and (p_scope is null or (scope_version=1 and scope_commit_id=commit_id))),false)
    into scope_ready,deep_ready from public.audit_scalable_workers
    where processing_version=2 and seen_at>=now()-case when p_allow_sleeping then interval '24 hours' else interval '90 seconds' end;
  if (p_scope is not null and not scope_ready) or (p_mode='deep' and not deep_ready)
    or not exists(select 1 from public.audit_scalable_workers where processing_version=2
      and seen_at>=now()-case when p_allow_sleeping then interval '24 hours' else interval '90 seconds' end) then
    return jsonb_build_object('allowed',false,'code','COMPATIBLE_WORKER_UNAVAILABLE');
  end if;
  if exists(select 1 from public.deployment_versions where component='worker' and
    (audit_engine_version<>'2026.09' or scoring_version<>'2.2' or check_registry_version<>'3.1')) then
    return jsonb_build_object('allowed',false,'code','COMPATIBLE_WORKER_UNAVAILABLE');
  end if;
  decision=public.admit_scoped_audit_submission(p_audit_id,p_user_id,p_guest_key_hash,p_ip_hash,p_hostname,p_normalized_url,
    p_mode,chosen_plan,case when p_user_id is null then greatest(1,p_guest_daily_limit) else limits.daily_audits end,
    greatest(1,p_domain_daily_limit),case when chosen_plan='free' then 1 else greatest(1,limits.concurrency) end,
    greatest(1,p_global_active_limit),p_bot_verified,fingerprint);
  if not coalesce((decision->>'allowed')::boolean,false) then return decision; end if;
  if coalesce((decision->>'reusedExistingAudit')::boolean,false) then
    existing_id=(decision->>'auditId')::uuid;
    select * into job from public.audits where id=existing_id;
    return decision||jsonb_build_object('audit',case when found then to_jsonb(job) else null end);
  end if;
  if p_user_id is not null then
    if profile.quota_reset_daily_at is null or profile.quota_reset_daily_at<=now() then profile.audit_quota_used_daily=0; end if;
    if profile.quota_reset_monthly_at is null or profile.quota_reset_monthly_at<=now() then profile.audit_quota_used_monthly=0; end if;
    if chosen_plan<>'admin' and (profile.audit_quota_used_daily>=limits.daily_audits or profile.audit_quota_used_monthly>=limits.monthly_audits) then
      perform public.release_audit_admission(p_audit_id,'QUOTA_REACHED');
      return jsonb_build_object('allowed',false,'code',case when profile.audit_quota_used_daily>=limits.daily_audits then 'DAILY_QUOTA_REACHED' else 'MONTHLY_QUOTA_REACHED' end);
    end if;
  end if;
  insert into public.audits(id,user_id,guest_key_hash,project_id,submitted_input,normalized_url,hostname,mode,
    requested_mode,effective_mode,plan,processing_tier,page_limit,plan_page_limit,queue_priority,processing_version,
    audit_scope,scope_fingerprint,quota_counted,estimated_wait_seconds,status,current_phase)
    values(p_audit_id,p_user_id,p_guest_key_hash,p_project_id,left(p_submitted_input,8192),p_normalized_url,p_hostname,p_mode,
      p_mode,p_mode,chosen_plan,chosen_plan,allowance,configured,limits.priority,2,p_scope,fingerprint,true,null,'queued','Queued') returning * into job;
  insert into public.audit_events(audit_id,type,message,phase,progress)
    values(p_audit_id,'audit_queued','Audit queued for '||p_hostname,'Queued',0);
  if p_user_id is not null then
    update public.user_profiles set audit_quota_used_daily=profile.audit_quota_used_daily+1,
      audit_quota_used_monthly=profile.audit_quota_used_monthly+1,
      quota_reset_daily_at=case when profile.quota_reset_daily_at is null or profile.quota_reset_daily_at<=now() then current_day+interval '1 day' else profile.quota_reset_daily_at end,
      quota_reset_monthly_at=case when profile.quota_reset_monthly_at is null or profile.quota_reset_monthly_at<=now() then date_trunc('month',now())+interval '1 month' else profile.quota_reset_monthly_at end,
      updated_at=now() where id=p_user_id;
    insert into public.audit_usage_events(user_id,audit_id,plan,mode,pages_limit) values(p_user_id,p_audit_id,chosen_plan,p_mode,allowance);
  end if;
  return decision||jsonb_build_object('audit',to_jsonb(job),'quotaRemaining',jsonb_build_object(
    'daily',greatest(0,limits.daily_audits-coalesce(profile.audit_quota_used_daily,0)-1),
    'monthly',greatest(0,limits.monthly_audits-coalesce(profile.audit_quota_used_monthly,0)-1)));
end $$;

create or replace function public.request_audit_preview(p_audit uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare target text; capture public.site_preview_captures%rowtype;
begin
  select normalized_url into target from public.audits where id=p_audit and deleted_at is null;
  if not found then return null; end if;
  perform pg_advisory_xact_lock(hashtext('preview:'||target));
  select * into capture from public.site_preview_captures where cache_key=md5(target||':v1');
  if not found then
    insert into public.site_preview_captures(cache_key,target_url) values(md5(target||':v1'),target) returning * into capture;
  elsif capture.status not in ('queued','running') and coalesce(capture.fresh_until,capture.retry_at)<=now() then
    update public.site_preview_captures set status='queued',retry_at=now(),attempts=0,updated_at=now() where id=capture.id returning * into capture;
  end if;
  insert into public.audit_preview_links(audit_id,capture_id) values(p_audit,capture.id)
    on conflict(audit_id) do update set capture_id=excluded.capture_id;
  return to_jsonb(capture);
end $$;

create or replace function public.claim_site_preview(p_worker text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare capture public.site_preview_captures%rowtype; expired public.site_preview_captures%rowtype; usage public.preview_daily_usage%rowtype;
  today date:=(now() at time zone 'UTC')::date;
begin
  if length(p_worker) not between 1 and 100 then raise exception 'INVALID_PREVIEW_WORKER'; end if;
  perform pg_advisory_xact_lock(hashtext('site-preview-budget'));
  for expired in select * from public.site_preview_captures where status='running' and lease_until<now() for update loop
    -- A crashed browser may have used the entire reservation. Never refund it.
    update public.preview_daily_usage set reserved_ms=greatest(0,reserved_ms-20000),consumed_ms=consumed_ms+20000 where usage_day=expired.reserved_day;
    update public.site_preview_captures set status=case when attempts<2 then 'queued' else 'unavailable' end,
      retry_at=now()+interval '15 minutes',lease_until=null,failure_code='CAPTURE_INTERRUPTED',updated_at=now() where id=expired.id;
  end loop;
  if exists(select 1 from public.site_preview_captures where status='running' and lease_until>now()) then return null; end if;
  -- Leave room for both new images while the previous generation still exists.
  if (select coalesce(sum(desktop_bytes+mobile_bytes),0) from public.site_preview_captures)+819200>104857600 then return null; end if;
  insert into public.preview_daily_usage(usage_day) values(today) on conflict do nothing;
  select * into usage from public.preview_daily_usage where usage_day=today for update;
  select * into capture from public.site_preview_captures where status='queued' and retry_at<=now() order by created_at for update skip locked limit 1;
  if not found then return null; end if;
  if usage.reserved_ms+usage.consumed_ms+20000>480000 then
    update public.site_preview_captures set status='quota_exhausted',failure_code='DAILY_BROWSER_ALLOWANCE',
      retry_at=((today+1)::timestamp at time zone 'UTC'),updated_at=now() where status='queued';
    return null;
  end if;
  update public.preview_daily_usage set reserved_ms=reserved_ms+20000 where usage_day=today;
  update public.site_preview_captures set status='running',generation=generation+1,attempts=attempts+1,
    worker_id=p_worker,reserved_day=today,lease_until=now()+interval '45 seconds',failure_code=null,updated_at=now()
    where id=capture.id returning * into capture;
  return to_jsonb(capture);
end $$;

create or replace function public.complete_site_preview(p_id uuid,p_generation integer,p_result jsonb)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare capture public.site_preview_captures%rowtype; elapsed integer; result_status text:=p_result->>'status'; prefix text;
begin
  perform pg_advisory_xact_lock(hashtext('site-preview-budget'));
  select * into capture from public.site_preview_captures where id=p_id and generation=p_generation and status='running' and lease_until>now() for update;
  if not found then return false; end if;
  if result_status not in ('captured','blocked','quota_exhausted','unavailable') then raise exception 'INVALID_PREVIEW_RESULT'; end if;
  prefix=p_id::text||'/'||p_generation::text||'/';
  if result_status='captured' and (p_result->>'desktopPath' is distinct from prefix||'desktop.webp'
    or p_result->>'mobilePath' is distinct from prefix||'mobile.webp'
    or coalesce((p_result->>'desktopBytes')::int,0) not between 1 and 409600
    or coalesce((p_result->>'mobileBytes')::int,0) not between 1 and 409600) then raise exception 'INVALID_PREVIEW_ARTIFACT'; end if;
  elapsed=greatest(1,least(20000,coalesce((p_result->>'durationMs')::int,20000)));
  update public.preview_daily_usage set reserved_ms=greatest(0,reserved_ms-20000),consumed_ms=consumed_ms+elapsed where usage_day=capture.reserved_day;
  update public.site_preview_captures set status=result_status,lease_until=null,worker_id=null,
    final_url=left(p_result->>'finalUrl',8192),failure_code=left(p_result->>'failureCode',80),
    desktop_path=case when result_status='captured' then p_result->>'desktopPath' else desktop_path end,
    mobile_path=case when result_status='captured' then p_result->>'mobilePath' else mobile_path end,
    desktop_bytes=case when result_status='captured' then (p_result->>'desktopBytes')::int else desktop_bytes end,
    mobile_bytes=case when result_status='captured' then (p_result->>'mobileBytes')::int else mobile_bytes end,
    captured_at=case when result_status='captured' then now() else captured_at end,
    fresh_until=case when result_status='captured' then now()+interval '24 hours' else null end,
    expires_at=case when result_status='captured' then now()+interval '7 days' else coalesce(expires_at,now()+interval '7 days') end,
    retry_at=case when result_status='quota_exhausted' then date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'+interval '1 day'
      when result_status='blocked' then now()+interval '24 hours' else now()+interval '15 minutes' end,
    updated_at=now() where id=p_id;
  return true;
end $$;

-- Return cleanup candidates but retain their paths until object deletion succeeds.
create or replace function public.preview_storage_cleanup()
returns jsonb language sql security definer set search_path=public,pg_temp as $$
  with ranked as(select id,desktop_path,mobile_path,expires_at,
    sum(desktop_bytes+mobile_bytes) over(order by captured_at desc nulls last,id) retained_bytes
    from public.site_preview_captures where status<>'running')
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'desktop_path',desktop_path,'mobile_path',mobile_path)),'[]'::jsonb)
    from (select * from ranked where expires_at<now() or retained_bytes>104038400 order by expires_at nulls last,id limit 100) candidates;
$$;
create or replace function public.finish_preview_cleanup(p_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare removed boolean;
begin
  delete from public.site_preview_captures where id=p_id and status<>'running';
  removed=found;
  delete from public.domain_evidence_cache where domain in (select domain from public.domain_evidence_cache where stale_until<now() limit 100);
  delete from public.preview_daily_usage where usage_day<(now() at time zone 'UTC')::date-8;
  return removed;
end $$;

do $$ declare f record; begin
  for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in
    ('submit_audit_job','request_audit_preview','claim_site_preview','complete_site_preview','preview_storage_cleanup','finish_preview_cleanup') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
