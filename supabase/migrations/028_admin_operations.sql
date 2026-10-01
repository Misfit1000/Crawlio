begin;

alter table public.audits add column if not exists retry_of_audit_id uuid references public.audits(id) on delete set null;
alter table public.audits add column if not exists admin_priority_boost integer not null default 0 check (admin_priority_boost in (0,10,20));
alter table public.audits add column if not exists admin_priority_expires_at timestamptz;
alter table public.user_profiles add column if not exists disabled_reason text;
alter table public.user_profiles add column if not exists disabled_at timestamptz;
alter table public.user_profiles add column if not exists disabled_by uuid;
alter table public.admin_actions add column if not exists request_id uuid;
create unique index if not exists admin_actions_request_id on public.admin_actions(request_id) where request_id is not null;
create index if not exists audits_terminal_time on public.audits(completed_at,status) where completed_at is not null;
create index if not exists audits_user_created on public.audits(user_id,created_at desc);
create index if not exists admin_actions_actor_created on public.admin_actions(admin_user_id,created_at desc);
create index if not exists admin_actions_created on public.admin_actions(created_at);
create index if not exists user_profiles_created on public.user_profiles(created_at);
create index if not exists audit_diagnostics_recent on public.audit_diagnostics(created_at desc);
create index if not exists audits_guest_terminal_retention on public.audits(created_at,id) where user_id is null and status not in ('queued','running');
insert into public.data_retention_policies(data_class,retention_days,description,automatic_cleanup)
  values('manual_guest_pruning',14,'Administrator-previewed cleanup of terminal guest audits; never automatic.',false)
  on conflict(data_class) do nothing;

create table if not exists public.admin_retention_previews (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  fingerprint text not null unique,
  audit_ids uuid[] not null,
  row_count integer not null,
  expires_at timestamptz not null default now()+interval '10 minutes',
  applied_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists admin_retention_previews_expiry on public.admin_retention_previews(expires_at);
alter table public.admin_retention_previews enable row level security;
revoke all on public.admin_retention_previews from anon,authenticated;
grant all on public.admin_retention_previews to service_role;

create or replace function public.assert_operations_admin(p_actor uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not exists(select 1 from public.user_profiles where id=p_actor and role='admin' and not disabled) then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;
end $$;

create or replace function public.admin_operations_snapshot(p_actor uuid,p_days integer default 7)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; cutoff timestamptz; q jsonb; m jsonb; t jsonb; w jsonb; f jsonb; a jsonb;
begin
  perform public.assert_operations_admin(p_actor);
  if p_days not in (1,7,30) then raise exception 'INVALID_RANGE'; end if;
  cutoff=now()-make_interval(days=>p_days);
  select jsonb_build_object('audits',(select count(*) from public.audits where created_at>=cutoff),
    'completed',count(*) filter(where status='completed'),'warnings',count(*) filter(where status='completed_with_warnings'),
    'failed',count(*) filter(where status='failed'),'abandoned',count(*) filter(where status='abandoned'),
    'successRate',100.0*count(*) filter(where status in ('completed','completed_with_warnings'))/nullif(count(*) filter(where status in ('completed','completed_with_warnings','failed','abandoned')),0),
    'medianDurationSeconds',percentile_cont(0.5) within group(order by extract(epoch from completed_at-started_at)) filter(where status in ('completed','completed_with_warnings') and started_at is not null and completed_at>=started_at))
    into m from public.audits where completed_at>=cutoff;
  select jsonb_build_object('queued',count(*) filter(where a.status='queued'),
    'running',count(*) filter(where a.status='running'),
    'oldestQueuedSeconds',max(extract(epoch from now()-a.created_at)) filter(where a.status='queued'),
    'staleLeases',count(*) filter(where a.status='running' and case when a.processing_version=2 then c.lease_until<=now() and c.state='running' else a.lease_expires_at<=now() end),
    'medianWaitSeconds',(select percentile_cont(0.5) within group(order by extract(epoch from started_at-created_at)) from public.audits where started_at>=cutoff and started_at>=created_at),
    'byMode',(select coalesce(jsonb_object_agg(k,n),'{}') from (select effective_mode k,count(*) n from public.audits where status in ('queued','running') group by effective_mode) x),
    'byPlan',(select coalesce(jsonb_object_agg(k,n),'{}') from (select plan k,count(*) n from public.audits where status in ('queued','running') group by plan) x))
    into q from public.audits a left join public.audit_crawl_runs c on c.audit_id=a.id where a.status in ('queued','running');
  select coalesce(jsonb_agg(to_jsonb(x) order by x.day),'[]') into t from (
    select to_char(d,'YYYY-MM-DD') "day",count(a.id) audits,count(a.id) filter(where status='completed') completed,
      count(a.id) filter(where status='completed_with_warnings') warnings,count(a.id) filter(where status in ('failed','abandoned')) failed,
      percentile_cont(0.5) within group(order by extract(epoch from a.completed_at-a.started_at)) filter(where status in ('completed','completed_with_warnings') and a.completed_at>=a.started_at) "medianDurationSeconds"
    from generate_series(date_trunc('day',cutoff),date_trunc('day',now()),interval '1 day') d
    left join public.audits a on a.created_at>=d and a.created_at<d+interval '1 day' group by d) x;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into w from (select id,value,updated_at from public.platform_settings where key like 'audit_worker:%' order by updated_at desc limit 20) x;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into f from (select a.id,a.hostname domain,a.status,a.error,a.created_at,
    (select failure_code from public.audit_diagnostics d where d.audit_id=a.id order by created_at desc limit 1) failure_code
    from public.audits a where status in ('failed','abandoned') and completed_at>=cutoff order by completed_at desc limit 10) x;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into a from (select id,action,target_type,target_id,request_id,created_at,metadata from public.admin_actions order by created_at desc limit 10) x;
  result=jsonb_build_object('observedAt',now(),'metrics',m,'queue',q,'trend',t,'workers',w,'recentFailures',f,'recentActions',a,
    'database',(select to_jsonb(d) from public.deployment_versions d where component='database'),
    'workerDeployment',(select to_jsonb(d) from public.deployment_versions d where component='worker'));
  return result;
end $$;

create or replace function public.admin_user_detail(p_actor uuid,p_user uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.user_profiles; limits public.plan_limits; usage jsonb;
begin
  perform public.assert_operations_admin(p_actor);
  select * into p from public.user_profiles where id=p_user;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  select * into limits from public.plan_limits where plan=p.plan;
  select jsonb_build_object('dailyUsed',p.audit_quota_used_daily,'monthlyUsed',p.audit_quota_used_monthly,
    'dailyLimit',limits.daily_audits,'monthlyLimit',limits.monthly_audits,'totalAudits',count(*),
    'queued',count(*) filter(where status='queued'),'running',count(*) filter(where status='running'),
    'completed',count(*) filter(where status='completed'),'warnings',count(*) filter(where status='completed_with_warnings'),
    'failed',count(*) filter(where status in ('failed','abandoned'))) into usage from public.audits where user_id=p_user;
  return jsonb_build_object('profile',jsonb_build_object('id',p.id,'email',p.email,'displayName',p.display_name,'role',p.role,'plan',p.plan,'subscriptionStatus',p.subscription_status,'disabled',p.disabled,'createdAt',p.created_at,'disabledReason',p.disabled_reason),
    'usage',usage,'latestAudit',(select jsonb_build_object('id',a.id,'domain',a.hostname,'status',a.status,'mode',a.effective_mode,'completedAt',a.completed_at,'score',r.scores->'overall') from public.audits a left join public.audit_reports r on r.audit_id=a.id where a.user_id=p_user order by a.created_at desc limit 1));
end $$;

create or replace function public.admin_audit_operation(p_actor uuid,p_audit uuid,p_action text,p_reason text,p_request uuid,p_level text default 'normal')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.audits; c public.audit_crawl_runs; original jsonb; result jsonb; previous public.admin_actions; owner_profile public.user_profiles; limits public.plan_limits; n public.audits; settings jsonb;
begin
  perform public.assert_operations_admin(p_actor);
  if coalesce(length(trim(p_reason)),0) not between 4 and 500 or p_request is null then raise exception 'ADMIN_REASON_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtext('admin-operation:'||p_request::text));
  select * into previous from public.admin_actions where request_id=p_request;
  if found then
    if previous.admin_user_id is distinct from p_actor or previous.action is distinct from 'audit_'||p_action
      or previous.target_type is distinct from 'audit' or previous.target_id is distinct from p_audit::text
      or jsonb_typeof(previous.metadata->'result') is distinct from 'object'
      or (p_action='priority' and previous.metadata->'result'->>'priorityLevel' is distinct from p_level) then
      raise exception 'ADMIN_REQUEST_CONFLICT';
    end if;
    return previous.metadata->'result';
  end if;
  select * into a from public.audits where id=p_audit for update;
  if not found then raise exception 'AUDIT_NOT_FOUND'; end if;
  original=jsonb_build_object('status',a.status,'priority',a.queue_priority,'boost',a.admin_priority_boost);
  if p_action='cancel' then
    if a.status not in ('queued','running') then raise exception 'AUDIT_NOT_CANCELLABLE'; end if;
    if a.processing_version=2 then
      update public.audit_crawl_runs set generation=generation+1,state='finished',owner=null,lease_until=null where audit_id=a.id;
    end if;
    update public.audits set status='cancelled',cancelled_at=now(),completed_at=now(),current_phase='Cancelled by administrator',locked_by=null,lease_expires_at=null where id=a.id;
    result=jsonb_build_object('auditId',a.id,'action',p_action,'outcome','cancelled','status','cancelled');
  elsif p_action='requeue' then
    if a.status<>'running' then raise exception 'AUDIT_NOT_STALE'; end if;
    if a.processing_version=2 then
      select * into c from public.audit_crawl_runs where audit_id=a.id for update;
      if not found or c.state<>'running' or c.lease_until is null or c.lease_until>now() then raise exception 'AUDIT_NOT_STALE'; end if;
      update public.audit_crawl_runs set generation=generation+1,state='waiting',owner=null,lease_until=null,retry_at=now(),last_error='Administrator requested stale recovery' where audit_id=a.id;
    elsif a.lease_expires_at is null or a.lease_expires_at>now() then raise exception 'AUDIT_NOT_STALE'; end if;
    -- Legacy workers retain the expired lease and perform their canonical retry cleanup after claiming it.
    update public.audits set current_phase='Recovery requested; waiting for audit engine' where id=a.id;
    result=jsonb_build_object('auditId',a.id,'action',p_action,'outcome','recovery_requested','status','running');
  elsif p_action='priority' then
    if a.status not in ('queued','running') or coalesce(p_level,'') not in ('normal','elevated','urgent') then raise exception 'INVALID_QUEUE_PRIORITY'; end if;
    if a.processing_version<>2 then raise exception 'LEGACY_PRIORITY_UNSUPPORTED'; end if;
    update public.audits set admin_priority_boost=case p_level when 'elevated' then 10 when 'urgent' then 20 else 0 end,
      admin_priority_expires_at=case when p_level='normal' then null else now()+interval '15 minutes' end where id=a.id;
    result=jsonb_build_object('auditId',a.id,'action',p_action,'outcome','priority_updated','priorityLevel',p_level,'expiresAt',case when p_level='normal' then null else now()+interval '15 minutes' end);
  elsif p_action='retry' then
    if a.status not in ('failed','abandoned') then raise exception 'AUDIT_NOT_RETRYABLE'; end if;
    perform pg_advisory_xact_lock(hashtext('seointel-audit-admission'));
    select coalesce(value,'{}') into settings from public.platform_settings where id='settings' or key='settings' order by updated_at desc limit 1;
    if coalesce((settings->>'maintenanceMode')::boolean,false) or (settings->'disabledAuditModes') ? a.effective_mode then raise exception 'AUDIT_MODE_DISABLED'; end if;
    if exists(select 1 from public.audits where retry_of_audit_id=a.id and status in ('queued','running')) then raise exception 'ACTIVE_RETRY_EXISTS'; end if;
    if (select count(*) from public.audits where status in ('queued','running'))>=coalesce(nullif((settings->>'hardQueueLimit')::integer,0),50) then raise exception 'QUEUE_FULL'; end if;
    if a.user_id is not null then
      select * into owner_profile from public.user_profiles where id=a.user_id for update;
      if not found or owner_profile.disabled then raise exception 'ACCOUNT_DISABLED'; end if;
      a.plan=owner_profile.plan;
    end if;
    select * into limits from public.plan_limits where plan=a.plan;
    if not found or not (limits.allowed_modes ? a.effective_mode) then raise exception 'AUDIT_MODE_DISABLED'; end if;
    if exists(select 1 from public.audits where status in ('queued','running') and ((a.user_id is not null and user_id=a.user_id) or (a.user_id is null and guest_key_hash=a.guest_key_hash))) then raise exception 'ACTIVE_AUDIT_EXISTS'; end if;
    if not exists(select 1 from public.audit_scalable_workers where seen_at>now()-interval '90 seconds' and (a.effective_mode<>'deep' or deep_enabled)) then raise exception 'SCALABLE_AUDIT_UNAVAILABLE'; end if;
    n=jsonb_populate_record(a,jsonb_build_object('id',gen_random_uuid(),'processing_version',2,'status','queued','progress',0,'current_phase','Administrator retry queued','current_url',null,'current_check',null,
      'page_limit',case a.effective_mode when 'quick' then limits.max_pages_quick when 'standard' then limits.max_pages_standard else limits.max_pages_deep end,
      'queue_priority',limits.priority,'processing_tier',a.plan,'pages_discovered',0,'pages_crawled',0,'checks_total',0,'checks_completed',0,'issues_found',0,'critical_count',0,'high_count',0,'medium_count',0,'low_count',0,
      'created_at',now(),'updated_at',now(),'started_at',null,'completed_at',null,'cancelled_at',null,'expires_at',now()+interval '30 days','locked_by',null,'locked_at',null,'lease_expires_at',null,'error',null,
      'failure_counts','{}'::jsonb,'warning_count',0,'final_url',null,'used_http_fallback',false,'recovery_attempts',0,'last_recovered_at',null,'checkpoint_state',null,'checkpoint_pages_crawled',0,'checkpoint_updated_at',null,
      'presentation_summary',null,'retry_of_audit_id',a.id,'admin_priority_boost',0,'admin_priority_expires_at',null,'quota_counted',true,'archived_at',null,'deleted_at',null));
    insert into public.audits select n.*;
    result=jsonb_build_object('auditId',n.id,'originalAuditId',a.id,'action',p_action,'outcome','retry_queued','status','queued','quotaExempt',true);
  else raise exception 'UNSUPPORTED_ADMIN_ACTION'; end if;
  insert into public.admin_actions(admin_user_id,action,target_type,target_id,request_id,metadata)
    values(p_actor,'audit_'||p_action,'audit',a.id::text,p_request,jsonb_build_object('reason',trim(p_reason),'before',original,'after',result,'result',result,'outcome',result->>'outcome'));
  return result;
end $$;

create or replace function public.admin_update_account(p_actor uuid,p_user uuid,p_patch jsonb,p_reason text,p_request uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.user_profiles; result jsonb; before_value jsonb; previous public.admin_actions;
begin
  perform public.assert_operations_admin(p_actor);
  if coalesce(length(trim(p_reason)),0) not between 4 and 500 or p_request is null then raise exception 'ADMIN_REASON_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtext('admin-operation:'||p_request::text));
  select * into previous from public.admin_actions where request_id=p_request;
  if found then
    if previous.admin_user_id is distinct from p_actor or previous.action is distinct from 'update_user_access'
      or previous.target_type is distinct from 'user' or previous.target_id is distinct from p_user::text
      or previous.metadata->'after' is distinct from p_patch
      or jsonb_typeof(previous.metadata->'result') is distinct from 'object' then
      raise exception 'ADMIN_REQUEST_CONFLICT';
    end if;
    return previous.metadata->'result';
  end if;
  if jsonb_typeof(p_patch) is distinct from 'object' or p_patch='{}'::jsonb or p_patch-ARRAY['role','plan','subscription_status','disabled','resetQuotas']::text[]<>'{}'::jsonb then raise exception 'INVALID_ADMIN_UPDATE'; end if;
  if (p_patch ? 'disabled' and jsonb_typeof(p_patch->'disabled') is distinct from 'boolean') or (p_patch ? 'resetQuotas' and jsonb_typeof(p_patch->'resetQuotas') is distinct from 'boolean') then raise exception 'INVALID_ADMIN_UPDATE'; end if;
  select * into p from public.user_profiles where id=p_user for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  if p_patch ? 'role' and p_patch->>'role' not in ('user','support','admin') then raise exception 'INVALID_ADMIN_UPDATE'; end if;
  if p_patch ? 'plan' and p_patch->>'plan' not in ('free','paid','agency','admin') then raise exception 'INVALID_ADMIN_UPDATE'; end if;
  if p_patch ? 'subscription_status' and p_patch->>'subscription_status' not in ('inactive','trialing','active','past_due','cancelled') then raise exception 'INVALID_ADMIN_UPDATE'; end if;
  if p_actor=p_user and ((p_patch ? 'role' and p_patch->>'role'<>p.role) or coalesce((p_patch->>'disabled')::boolean,false)) then raise exception 'SELF_ROLE_CHANGE_FORBIDDEN'; end if;
  if p.role='admin' and not p.disabled and (coalesce(p_patch->>'role',p.role)<>'admin' or coalesce((p_patch->>'disabled')::boolean,false)) then
    perform pg_advisory_xact_lock(hashtext('crawlio'),hashtext('active_administrator'));
    if (select count(*) from public.user_profiles where role='admin' and not disabled)<=1 then raise exception 'LAST_ADMIN_PROTECTED'; end if;
  end if;
  before_value=jsonb_build_object('role',p.role,'plan',p.plan,'subscription_status',p.subscription_status,'disabled',p.disabled,'daily',p.audit_quota_used_daily,'monthly',p.audit_quota_used_monthly);
  update public.user_profiles set role=coalesce(p_patch->>'role',role),plan=coalesce(p_patch->>'plan',plan),subscription_status=coalesce(p_patch->>'subscription_status',subscription_status),
    disabled=coalesce((p_patch->>'disabled')::boolean,disabled),
    disabled_reason=case when p_patch ? 'disabled' then case when (p_patch->>'disabled')::boolean then trim(p_reason) else null end else disabled_reason end,
    disabled_at=case when p_patch ? 'disabled' then case when (p_patch->>'disabled')::boolean then now() else null end else disabled_at end,
    disabled_by=case when p_patch ? 'disabled' then case when (p_patch->>'disabled')::boolean then p_actor else null end else disabled_by end,
    audit_quota_used_daily=case when coalesce((p_patch->>'resetQuotas')::boolean,false) then 0 else audit_quota_used_daily end,
    audit_quota_used_monthly=case when coalesce((p_patch->>'resetQuotas')::boolean,false) then 0 else audit_quota_used_monthly end where id=p_user;
  result=jsonb_build_object('userId',p_user,'before',before_value,'after',p_patch,'outcome','account_updated');
  insert into public.admin_actions(admin_user_id,action,target_type,target_id,request_id,metadata)
    values(p_actor,'update_user_access','user',p_user::text,p_request,jsonb_build_object('reason',trim(p_reason),'before',before_value,'after',p_patch,'result',result,'outcome','account_updated'));
  return result;
end $$;

create or replace function public.admin_update_configuration(p_actor uuid,p_kind text,p_key text,p_patch jsonb,p_reason text,p_request uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; before_value jsonb; plan_row public.plan_limits; setting_row public.platform_settings; merged jsonb; mode text; field text; previous public.admin_actions;
begin
  perform public.assert_operations_admin(p_actor);
  if coalesce(length(trim(p_reason)),0) not between 4 and 500 or p_request is null then raise exception 'ADMIN_REASON_REQUIRED'; end if;
  if jsonb_typeof(p_patch) is distinct from 'object' or p_patch='{}'::jsonb then raise exception 'INVALID_ADMIN_UPDATE'; end if;
  perform pg_advisory_xact_lock(hashtext('admin-operation:'||p_request::text));
  select * into previous from public.admin_actions where request_id=p_request;
  if found then
    if previous.admin_user_id is distinct from p_actor or previous.action is distinct from 'update_'||p_kind
      or previous.target_type is distinct from 'configuration' or previous.target_id is distinct from p_key
      or previous.metadata->'after' is distinct from p_patch
      or jsonb_typeof(previous.metadata->'result') is distinct from 'object' then
      raise exception 'ADMIN_REQUEST_CONFLICT';
    end if;
    return previous.metadata->'result';
  end if;
  if p_kind='plan' then
    if p_patch-ARRAY['daily_audits','monthly_audits','max_pages_quick','max_pages_standard','max_pages_deep','allowed_modes','audit_timeout_seconds','concurrency','max_events_per_audit','max_issues_per_audit','priority','exports_enabled','pdf_enabled','scheduled_audits_enabled']::text[]<>'{}'::jsonb then raise exception 'INVALID_ADMIN_UPDATE'; end if;
    select * into plan_row from public.plan_limits where plan=p_key for update;
    if not found then raise exception 'PLAN_NOT_FOUND'; end if;
    before_value=to_jsonb(plan_row);
    merged=before_value||p_patch;
    if jsonb_array_length(merged->'allowed_modes')<1 then raise exception 'AUDIT_MODE_DISABLED'; end if;
    for mode in select jsonb_array_elements_text(merged->'allowed_modes') loop
      field=case mode when 'quick' then 'max_pages_quick' when 'standard' then 'max_pages_standard' when 'deep' then 'max_pages_deep' end;
      if field is null or (merged->>field)::integer not between 1 and (case when p_key='admin' then 5000 else 500 end) then raise exception 'INVALID_ADMIN_UPDATE'; end if;
    end loop;
    plan_row=jsonb_populate_record(plan_row,p_patch||jsonb_build_object('updated_at',now()));
    update public.plan_limits set daily_audits=plan_row.daily_audits,monthly_audits=plan_row.monthly_audits,
      max_pages_quick=plan_row.max_pages_quick,max_pages_standard=plan_row.max_pages_standard,max_pages_deep=plan_row.max_pages_deep,
      allowed_modes=plan_row.allowed_modes,audit_timeout_seconds=plan_row.audit_timeout_seconds,concurrency=plan_row.concurrency,
      max_events_per_audit=plan_row.max_events_per_audit,max_issues_per_audit=plan_row.max_issues_per_audit,priority=plan_row.priority,
      exports_enabled=plan_row.exports_enabled,pdf_enabled=plan_row.pdf_enabled,scheduled_audits_enabled=plan_row.scheduled_audits_enabled,updated_at=now() where plan=p_key;
  elsif p_kind='platform' and p_key='settings' then
    if p_patch-ARRAY['platform_name','support_email','require_email_verification','public_registration','value']::text[]<>'{}'::jsonb
      or coalesce(p_patch->'value','{}')-ARRAY['queueFairnessPaidBurst','guestAuditEnabled','maintenanceMode','pauseFreeSubmissions','captchaRequired','softQueueWarning','hardQueueLimit','disabledAuditModes']::text[]<>'{}'::jsonb then raise exception 'INVALID_ADMIN_UPDATE'; end if;
    perform pg_advisory_xact_lock(hashtext('crawlio-platform-settings'));
    select * into setting_row from public.platform_settings where id='settings' for update;
    if not found then raise exception 'CONFIGURATION_NOT_FOUND'; end if;
    before_value=jsonb_build_object('platform_name',setting_row.platform_name,'support_email',setting_row.support_email,'require_email_verification',setting_row.require_email_verification,'public_registration',setting_row.public_registration,
      'value',coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(setting_row.value,'{}')) where key in ('queueFairnessPaidBurst','guestAuditEnabled','maintenanceMode','pauseFreeSubmissions','captchaRequired','softQueueWarning','hardQueueLimit','disabledAuditModes')),'{}'));
    update public.platform_settings set platform_name=coalesce(p_patch->>'platform_name',platform_name),support_email=coalesce(p_patch->>'support_email',support_email),
      require_email_verification=coalesce((p_patch->>'require_email_verification')::boolean,require_email_verification),public_registration=coalesce((p_patch->>'public_registration')::boolean,public_registration),
      value=coalesce(value,'{}')||coalesce(p_patch->'value','{}'),updated_at=now() where id='settings';
  else raise exception 'INVALID_ADMIN_UPDATE'; end if;
  result=jsonb_build_object('outcome','configuration_updated','kind',p_kind,'key',p_key,'after',p_patch);
  insert into public.admin_actions(admin_user_id,action,target_type,target_id,request_id,metadata)
    values(p_actor,'update_'||p_kind,'configuration',p_key,p_request,jsonb_build_object('reason',trim(p_reason),'before',before_value,'after',p_patch,'outcome','configuration_updated','result',result));
  return result;
end $$;

create or replace function public.admin_resource_inventory(p_actor uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare items jsonb;
begin
  perform public.assert_operations_admin(p_actor);
  select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'bytes',pg_total_relation_size(c.oid),'approximateRows',case when c.reltuples<0 then null else c.reltuples::bigint end,
    'oldestAt',case c.relname when 'audits' then (select created_at from public.audits order by created_at limit 1)
      when 'admin_actions' then (select created_at from public.admin_actions order by created_at limit 1)
      when 'user_profiles' then (select created_at from public.user_profiles order by created_at limit 1) else null end,
    'retentionDays',p.retention_days,'retentionDescription',coalesce(p.description,'No automatic cleanup policy; retained with the audit.'),'automaticCleanup',coalesce(p.automatic_cleanup,false))), '[]') into items
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    left join public.data_retention_policies p on p.data_class=case c.relname when 'audit_pages' then 'completed_page_evidence' when 'audit_events' then 'verbose_activity_events' when 'admin_actions' then 'admin_action_logs' when 'audit_reports' then 'customer_reports' when 'audits' then 'customer_reports' end
    where n.nspname='public' and c.relkind='r' and c.relname in ('audits','audit_pages','audit_issues','audit_reports','audit_events','audit_crawl_frontier','audit_crawl_runs','audit_score_groups','audit_export_jobs','admin_actions','user_profiles');
  return jsonb_build_object('observedAt',now(),'relations',items,'quotaAvailability','provider-dashboard-only');
end $$;

-- Count exactly the rows deleted by audit foreign-key cascades. Export manifests
-- and usage/admission records are retained under their existing cleanup rules.
create or replace function public.admin_retention_row_count(p_ids uuid[])
returns bigint language sql stable security definer set search_path=public,pg_temp as $$
  select (select count(*) from public.audit_pages where audit_id=any(p_ids))
    +(select count(*) from public.audit_issues where audit_id=any(p_ids))
    +(select count(*) from public.audit_events where audit_id=any(p_ids))
    +(select count(*) from public.audit_crawl_frontier where audit_id=any(p_ids))
    +(select count(*) from public.audit_reports where audit_id=any(p_ids))
    +(select count(*) from public.audit_score_groups where audit_id=any(p_ids))
    +(select count(*) from public.audit_diagnostics where audit_id=any(p_ids))
    +(select count(*) from public.audit_crawl_runs where audit_id=any(p_ids))
    +(select count(*) from public.audit_finding_workflow where audit_id=any(p_ids))
    +(select count(*) from public.report_shares where audit_id=any(p_ids))
$$;

create or replace function public.admin_retention_preview(p_actor uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare ids uuid[]='{}'; rows_count integer=0; x record; child_count integer; token text; expiry timestamptz=now()+interval '10 minutes'; eligible bigint;
begin
  perform public.assert_operations_admin(p_actor);
  delete from public.admin_retention_previews where expires_at<now()-interval '1 day';
  select count(*) into eligible from public.audits where user_id is null and status not in ('queued','running') and created_at<now()-interval '14 days';
  for x in select id from public.audits where user_id is null and status not in ('queued','running') and created_at<now()-interval '14 days' order by created_at,id limit 25 loop
    select public.admin_retention_row_count(ARRAY[x.id]) into child_count;
    if rows_count+child_count>10000 then exit; end if;
    ids=array_append(ids,x.id);rows_count=rows_count+child_count;
  end loop;
  token=encode(sha256(convert_to(p_actor::text||array_to_string(ids,',')||rows_count::text||gen_random_uuid()::text,'UTF8')),'hex');
  insert into public.admin_retention_previews(actor_id,fingerprint,audit_ids,row_count,expires_at) values(p_actor,token,ids,rows_count,expiry);
  return jsonb_build_object('fingerprint',token,'expiresAt',expiry,'audits',cardinality(ids),'associatedRows',rows_count,'totalEligible',eligible);
end $$;

-- Replace the old signature to avoid ambiguous four-argument calls through the default.
drop function if exists public.admin_retention_apply(uuid,text,text,text);
create or replace function public.admin_retention_apply(p_actor uuid,p_fingerprint text,p_reason text,p_confirmation text,p_request uuid default gen_random_uuid())
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.admin_retention_previews; deleted integer; current_rows bigint; result jsonb; previous public.admin_actions;
begin
  perform public.assert_operations_admin(p_actor);
  if p_request is null then raise exception 'ADMIN_REASON_REQUIRED'; end if;
  if coalesce(length(trim(p_reason)),0) not between 4 and 500 or coalesce(p_confirmation,'')<>'APPLY RETENTION' then raise exception 'CONFIRMATION_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtext('admin-operation:'||p_request::text));
  select * into previous from public.admin_actions where request_id=p_request;
  if found then
    if previous.admin_user_id is distinct from p_actor or previous.action is distinct from 'apply_retention'
      or previous.target_type is distinct from 'retention' or previous.target_id is distinct from p_fingerprint
      or jsonb_typeof(previous.metadata->'result') is distinct from 'object' then
      raise exception 'ADMIN_REQUEST_CONFLICT';
    end if;
    return previous.metadata->'result';
  end if;
  select * into p from public.admin_retention_previews where actor_id=p_actor and fingerprint=p_fingerprint for update;
  if not found or p.expires_at<=now() or p.applied_at is not null then raise exception 'PREVIEW_EXPIRED'; end if;
  perform 1 from public.audits where id=any(p.audit_ids) for update;
  if (select count(*) from public.audits where id=any(p.audit_ids) and user_id is null and status not in ('queued','running') and created_at<now()-interval '14 days')<>cardinality(p.audit_ids) then raise exception 'PREVIEW_CHANGED'; end if;
  select public.admin_retention_row_count(p.audit_ids) into current_rows;
  if current_rows<>p.row_count or current_rows>10000 then raise exception 'PREVIEW_CHANGED'; end if;
  delete from public.audits where id=any(p.audit_ids);
  get diagnostics deleted=row_count;
  update public.admin_retention_previews set applied_at=now() where id=p.id;
  result=jsonb_build_object('auditsDeleted',deleted,'associatedRows',current_rows,'outcome','applied','requestId',p_request);
  insert into public.admin_actions(admin_user_id,action,target_type,target_id,request_id,metadata)
    values(p_actor,'apply_retention','retention',p_fingerprint,p_request,jsonb_build_object('reason',trim(p_reason),'previewId',p.id,'before',jsonb_build_object('audits',deleted,'associatedRows',current_rows),'after',jsonb_build_object('audits',0),'outcome','applied','result',result));
  return result;
end $$;

create or replace function public.claim_scalable_audit(p_worker text,p_deep boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.audit_crawl_runs; a public.audits;
begin
  perform pg_advisory_xact_lock(hashtext('crawlio-scalable-claims'));
  select c.* into r from public.audit_crawl_runs c join public.audits j on j.id=c.audit_id
    where j.status in ('queued','running') and c.state<>'finished' and c.retry_at<=now()
      and (p_deep or j.effective_mode<>'deep') and (c.lease_until is null or c.lease_until<now())
      and not exists(select 1 from public.audit_crawl_runs other join public.audits target on target.id=other.audit_id where other.audit_id<>c.audit_id and other.lease_until>now() and target.status in ('queued','running') and regexp_replace(target.hostname,'^www\.','')=regexp_replace(j.hostname,'^www\.',''))
    order by c.last_served_at-(least(j.queue_priority,1000)+case when j.admin_priority_expires_at>now() then j.admin_priority_boost else 0 end)*interval '60 milliseconds',j.created_at
    limit 1 for update of c skip locked;
  if not found then return null; end if;
  update public.audit_crawl_runs set state='running',owner=p_worker,generation=generation+1,
    active_ms=active_ms+case when slice_started_at is null then 0 else least(120000,greatest(0,extract(epoch from (coalesce(lease_until,now())-slice_started_at))*1000))::bigint end,
    lease_until=now()+interval '120 seconds',slice_started_at=now(),last_served_at=now() where audit_id=r.audit_id returning * into r;
  update public.audits set status='running',started_at=coalesce(started_at,now()),current_phase='Checking pages',worker_runtime='scalable-v2' where id=r.audit_id returning * into a;
  return jsonb_build_object('run',to_jsonb(r),'audit',to_jsonb(a));
end $$;

-- Restrictive policies supplement ownership rules, including on old authenticated sessions.
create or replace function public.operations_account_active() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.user_profiles where id=auth.uid() and not disabled)
$$;
do $$ declare t text; begin
  foreach t in array ARRAY['audits','audit_pages','audit_issues','audit_events','audit_reports','projects','audit_finding_workflow','keywords','competitors','project_data_imports','project_data_rows','project_notifications','search_console_rows'] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop policy if exists operations_active_account on public.%I',t);
      execute format('create policy operations_active_account on public.%I as restrictive for all to authenticated using (public.operations_account_active()) with check (public.operations_account_active())',t);
    end if;
  end loop;
end $$;
revoke all on function public.operations_account_active() from public,anon;
grant execute on function public.operations_account_active() to authenticated,service_role;
do $$ declare f record; begin
  for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('assert_operations_admin','admin_operations_snapshot','admin_user_detail','admin_audit_operation','admin_update_account','admin_update_configuration','admin_resource_inventory','admin_retention_preview','admin_retention_apply','admin_retention_row_count') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
update public.deployment_versions set commit_identifier='migration-028',updated_at=now() where component='database';
notify pgrst, 'reload schema';
commit;
