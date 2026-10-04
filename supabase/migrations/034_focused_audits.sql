-- Additive scope snapshots. Existing audits remain full-site legacy records.
begin;
create or replace function public.audit_scope_fingerprint(p_scope jsonb) returns text
language sql immutable set search_path=public,pg_temp as $$
  select 'v1:'||coalesce(p_scope->>'coverage','site')||':'||case when coalesce(p_scope->>'focus','full')='full' then 'full' else 'selected' end||':'||string_agg(g,',' order by n)
  from unnest(array['seo','technical','crawlability','links','performance','structured-data','accessibility','security']) with ordinality groups(g,n)
  where p_scope is null or coalesce(p_scope->'checkGroups','[]'::jsonb) ? g
$$;

create or replace function public.valid_audit_scope(p_scope jsonb) returns boolean
language plpgsql immutable set search_path=public,pg_temp as $$
begin
  if p_scope is null then return true; end if;
  if jsonb_typeof(p_scope)<>'object' or coalesce(jsonb_typeof(p_scope->'checkGroups'),'null')<>'array' then return false; end if;
  return coalesce((
    jsonb_typeof(p_scope)='object' and p_scope->>'version'='1'
    and p_scope->>'coverage' in ('page','site')
    and p_scope->>'focus' in ('full','custom','seo','technical','crawlability','links','performance','structured-data','accessibility','security')
    and jsonb_typeof(p_scope->'checkGroups')='array'
    and jsonb_array_length(p_scope->'checkGroups') between 1 and 8
    and not exists(select 1 from jsonb_array_elements_text(p_scope->'checkGroups') g where g not in ('seo','technical','crawlability','links','performance','structured-data','accessibility','security'))
    and (select count(distinct g) from jsonb_array_elements_text(p_scope->'checkGroups') g)=jsonb_array_length(p_scope->'checkGroups')
    and (p_scope->>'focus'='custom'
      or (p_scope->>'focus'='full' and jsonb_array_length(p_scope->'checkGroups')=8)
      or (jsonb_array_length(p_scope->'checkGroups')=1 and p_scope->'checkGroups' ? (p_scope->>'focus')))
  ),false);
end
$$;

alter table public.audits add column if not exists audit_scope jsonb;
alter table public.audits add column if not exists plan_page_limit integer;
alter table public.audits add column if not exists scope_fingerprint text not null default 'v1:site:full:seo,technical,crawlability,links,performance,structured-data,accessibility,security';
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.audits'::regclass and conname='audits_scope_valid') then
    alter table public.audits add constraint audits_scope_valid check(public.valid_audit_scope(audit_scope));
    alter table public.audits add constraint audits_scoped_processing check(audit_scope is null or processing_version=2);
    alter table public.audits add constraint audits_scoped_page_allowance check(audit_scope is null or (plan_page_limit is not null and plan_page_limit>=page_limit and (audit_scope->>'coverage'<>'page' or page_limit=1)));
  end if;
end $$;
alter table public.audit_admissions add column if not exists scope_fingerprint text not null default 'v1:site:full:seo,technical,crawlability,links,performance,structured-data,accessibility,security';
alter table public.audit_scalable_workers add column if not exists scope_version integer not null default 0;
alter table public.audit_scalable_workers add column if not exists scope_commit_id text;
create index if not exists audit_scoped_duplicate on public.audits(user_id,normalized_url,effective_mode,scope_fingerprint,created_at desc) where status in ('queued','running');
create index if not exists admission_scoped_duplicate on public.audit_admissions(normalized_url,audit_mode,scope_fingerprint,created_at desc) where decision='accepted';

create or replace function public.guard_audit_scope() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='INSERT' then
    new.scope_fingerprint=public.audit_scope_fingerprint(new.audit_scope);
  elsif new.audit_scope is distinct from old.audit_scope or new.plan_page_limit is distinct from old.plan_page_limit or new.scope_fingerprint is distinct from old.scope_fingerprint
    or (old.audit_scope is not null and new.page_limit is distinct from old.page_limit) then
    raise exception 'AUDIT_SCOPE_IMMUTABLE';
  end if;
  return new;
end $$;
drop trigger if exists guard_audit_scope on public.audits;
create trigger guard_audit_scope before insert or update on public.audits for each row execute function public.guard_audit_scope();

-- One implementation preserves fair scheduling. The legacy entry point cannot
-- claim a scoped job even when its binary knows nothing about this migration.
create or replace function public.claim_audit_work(p_worker text,p_deep boolean,p_scoped boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.audit_crawl_runs; a public.audits;
begin
  perform pg_advisory_xact_lock(hashtext('crawlio-scalable-claims'));
  select c.* into r from public.audit_crawl_runs c join public.audits j on j.id=c.audit_id
    where j.status in ('queued','running') and c.state<>'finished' and c.retry_at<=now()
      and (p_scoped or j.audit_scope is null)
      and (p_deep or j.effective_mode<>'deep') and (c.lease_until is null or c.lease_until<now())
      and not exists(select 1 from public.audit_crawl_runs other join public.audits target on target.id=other.audit_id where other.audit_id<>c.audit_id and other.lease_until>now() and target.status in ('queued','running') and regexp_replace(target.hostname,'^www\.','')=regexp_replace(j.hostname,'^www\.',''))
    order by c.last_served_at-(least(j.queue_priority,1000)+case when j.admin_priority_expires_at>now() then j.admin_priority_boost else 0 end)*interval '60 milliseconds',j.created_at
    limit 1 for update of c skip locked;
  if not found then return null; end if;
  update public.audit_crawl_runs set state='running',owner=p_worker,generation=generation+1,
    active_ms=active_ms+case when slice_started_at is null then 0 else least(120000,greatest(0,extract(epoch from (coalesce(lease_until,now())-slice_started_at))*1000))::bigint end,
    lease_until=now()+interval '120 seconds',slice_started_at=now(),last_served_at=now() where audit_id=r.audit_id returning * into r;
  update public.audits set status='running',started_at=coalesce(started_at,now()),current_phase='Checking selected signals',worker_runtime='scalable-v2' where id=r.audit_id returning * into a;
  return jsonb_build_object('run',to_jsonb(r),'audit',to_jsonb(a));
end $$;
create or replace function public.claim_scalable_audit(p_worker text,p_deep boolean default false)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select public.claim_audit_work(p_worker,p_deep,false)
$$;
create or replace function public.claim_scoped_audit(p_worker text,p_deep boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not exists(select 1 from public.audit_scalable_workers where worker_id=p_worker and scope_version=1 and scope_commit_id=commit_id and seen_at>now()-interval '90 seconds') then
    raise exception 'SCOPED_WORKER_UNAVAILABLE';
  end if;
  return public.claim_audit_work(p_worker,p_deep,true);
end $$;

-- Single-page crawlability inspects bounded sitemap documents before its page.
-- Other audits retain the fast robots/root/discovery ordering from migration 033.
create or replace function public.read_scoped_audit_frontier(p_audit uuid,p_limit integer default 2)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare batch jsonb;
begin
  if exists(select 1 from public.audit_crawl_frontier where audit_id=p_audit and state='pending' and kind='robots') then
    return public.read_scalable_audit_frontier(p_audit,p_limit);
  end if;
  if exists(select 1 from public.audits where id=p_audit and audit_scope->>'coverage'='page' and audit_scope->'checkGroups' ? 'crawlability')
    and exists(select 1 from public.audit_crawl_frontier where audit_id=p_audit and state='pending' and kind='sitemap') then
    select coalesce(jsonb_agg(to_jsonb(item)),'[]'::jsonb) into batch from (
      select key,url,kind,depth,source_url,anchor,attempts,next_attempt_at,discovery_offset from public.audit_crawl_frontier
      where audit_id=p_audit and state='pending' and kind='sitemap' and next_attempt_at<=now()
      order by depth,key limit least(2,greatest(0,p_limit))
    ) item;
    return batch;
  end if;
  return public.read_scalable_audit_frontier(p_audit,p_limit);
end $$;

create or replace function public.admit_scoped_audit_submission(
  p_audit_id uuid,p_user_id uuid,p_guest_key_hash text,p_ip_hash text,p_normalized_domain text,p_normalized_url text,
  p_audit_mode text,p_plan text,p_daily_limit integer,p_domain_daily_limit integer,p_active_limit integer,p_global_active_limit integer,
  p_bot_verified boolean default false,p_scope_fingerprint text default 'v1:site:full:seo,technical,crawlability,links,performance,structured-data,accessibility,security'
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_settings jsonb:='{}'; v_existing_id uuid; v_daily_count integer:=0; v_network_daily_count integer:=0;
  v_domain_count integer:=0; v_global_active integer:=0; v_hard_limit integer; v_soft_limit integer; v_owner_active integer:=0;
begin
  if (p_user_id is null)=(p_guest_key_hash is null) then raise exception 'exactly one owner identifier is required'; end if;
  if p_audit_mode not in ('quick','standard','deep') then raise exception 'unsupported audit mode'; end if;
  if p_scope_fingerprint !~ '^v1:(page|site):(full|selected):[a-z,-]+$' or length(p_scope_fingerprint)>160 then raise exception 'invalid audit scope fingerprint'; end if;
  perform pg_advisory_xact_lock(hashtext('seointel-audit-admission'));
  select coalesce(value,'{}') into v_settings from public.platform_settings where id='settings' or key='settings' order by updated_at desc limit 1;
  if coalesce((v_settings->>'maintenanceMode')::boolean,false) then return jsonb_build_object('allowed',false,'code','MAINTENANCE','auditId',p_audit_id,'reusedExistingAudit',false,'retryAfterSeconds',300); end if;
  if p_plan='free' and coalesce((v_settings->>'pauseFreeSubmissions')::boolean,false) then return jsonb_build_object('allowed',false,'code','FREE_SUBMISSIONS_PAUSED','auditId',p_audit_id,'reusedExistingAudit',false,'retryAfterSeconds',300); end if;
  if p_user_id is null and not coalesce((v_settings->>'guestAuditEnabled')::boolean,true) then return jsonb_build_object('allowed',false,'code','GUEST_AUDITS_DISABLED','auditId',p_audit_id,'reusedExistingAudit',false,'retryAfterSeconds',300); end if;
  if coalesce(v_settings->'disabledAuditModes','[]'::jsonb) ? p_audit_mode then return jsonb_build_object('allowed',false,'code','AUDIT_MODE_DISABLED','auditId',p_audit_id,'reusedExistingAudit',false,'retryAfterSeconds',300); end if;
  if p_user_id is null and coalesce((v_settings->>'captchaRequired')::boolean,false) and not p_bot_verified then return jsonb_build_object('allowed',false,'code','BOT_VERIFICATION_REQUIRED','auditId',p_audit_id,'reusedExistingAudit',false,'retryAfterSeconds',60); end if;

  select a.id into v_existing_id from public.audits a where a.normalized_url=p_normalized_url and a.effective_mode=p_audit_mode and a.scope_fingerprint=p_scope_fingerprint
    and a.status in ('queued','running') and a.created_at>=now()-interval '10 minutes'
    and ((p_user_id is not null and a.user_id=p_user_id) or (p_user_id is null and a.user_id is null and a.guest_key_hash=p_guest_key_hash)) order by a.created_at desc limit 1;
  if v_existing_id is not null then return jsonb_build_object('allowed',true,'code','DUPLICATE_REUSED','auditId',v_existing_id,'reusedExistingAudit',true,'retryAfterSeconds',0); end if;
  -- An admission reservation is reusable only until its terminal audit exists.
  select aa.audit_id into v_existing_id from public.audit_admissions aa left join public.audits a on a.id=aa.audit_id
    where aa.normalized_url=p_normalized_url and aa.audit_mode=p_audit_mode and aa.scope_fingerprint=p_scope_fingerprint and aa.decision='accepted'
      and aa.created_at>=now()-interval '10 minutes' and (a.id is null or a.status in ('queued','running'))
      and ((p_user_id is not null and aa.user_id=p_user_id) or (p_user_id is null and aa.user_id is null and aa.guest_key_hash=p_guest_key_hash)) order by aa.created_at desc limit 1;
  if v_existing_id is not null then return jsonb_build_object('allowed',true,'code','DUPLICATE_REUSED','auditId',v_existing_id,'reusedExistingAudit',true,'retryAfterSeconds',0); end if;
  select count(*) into v_owner_active from public.audits a where a.status in ('queued','running') and ((p_user_id is not null and a.user_id=p_user_id) or (p_user_id is null and a.user_id is null and a.guest_key_hash=p_guest_key_hash));
  v_owner_active=v_owner_active+(select count(*) from public.audit_admissions aa where aa.decision='accepted' and aa.created_at>now()-interval '30 seconds' and not exists(select 1 from public.audits a where a.id=aa.audit_id)
    and ((p_user_id is not null and aa.user_id=p_user_id) or (p_user_id is null and aa.user_id is null and aa.guest_key_hash=p_guest_key_hash)));
  if v_owner_active>=greatest(1,p_active_limit) then
    select a.id into v_existing_id from public.audits a where a.status in ('queued','running') and ((p_user_id is not null and a.user_id=p_user_id) or (p_user_id is null and a.user_id is null and a.guest_key_hash=p_guest_key_hash)) order by a.created_at desc limit 1;
    return jsonb_build_object('allowed',false,'code','ACTIVE_AUDIT_EXISTS','auditId',coalesce(v_existing_id,p_audit_id),'reusedExistingAudit',false,'retryAfterSeconds',60);
  end if;
  select count(*) into v_daily_count from public.audit_admissions aa where aa.decision='accepted' and aa.created_at>=date_trunc('day',now()) and ((p_user_id is not null and aa.user_id=p_user_id) or (p_user_id is null and aa.user_id is null and aa.guest_key_hash=p_guest_key_hash));
  if v_daily_count>=greatest(1,p_daily_limit) then return jsonb_build_object('allowed',false,'code','DAILY_QUOTA_REACHED','auditId',p_audit_id,'reusedExistingAudit',false,'retryAfterSeconds',greatest(1,extract(epoch from (date_trunc('day',now())+interval '1 day'-now()))::integer)); end if;
  if p_user_id is null then
    select count(*) into v_network_daily_count from public.audit_admissions aa where aa.decision='accepted' and aa.created_at>=date_trunc('day',now()) and aa.ip_hash=p_ip_hash;
    if v_network_daily_count>=greatest(1,p_daily_limit) then return jsonb_build_object('allowed',false,'code','DAILY_QUOTA_REACHED','auditId',p_audit_id,'reusedExistingAudit',false,'retryAfterSeconds',greatest(1,extract(epoch from (date_trunc('day',now())+interval '1 day'-now()))::integer)); end if;
  end if;
  select count(*) into v_domain_count from public.audit_admissions aa where aa.decision='accepted' and aa.created_at>=date_trunc('day',now()) and aa.normalized_domain=p_normalized_domain and (aa.ip_hash=p_ip_hash or (p_user_id is not null and aa.user_id=p_user_id) or (p_user_id is null and aa.guest_key_hash=p_guest_key_hash));
  if v_domain_count>=greatest(1,p_domain_daily_limit) then return jsonb_build_object('allowed',false,'code','DOMAIN_DAILY_LIMIT','auditId',p_audit_id,'reusedExistingAudit',false,'retryAfterSeconds',3600); end if;
  select count(*) into v_global_active from public.audits where status in ('queued','running');
  v_hard_limit=coalesce(nullif((v_settings->>'hardQueueLimit')::integer,0),greatest(1,p_global_active_limit));
  v_soft_limit=coalesce(nullif((v_settings->>'softQueueWarning')::integer,0),greatest(1,floor(v_hard_limit*0.8)::integer));
  if v_global_active>=v_hard_limit then return jsonb_build_object('allowed',false,'code','QUEUE_FULL','auditId',p_audit_id,'reusedExistingAudit',false,'retryAfterSeconds',300,'queueDepth',v_global_active); end if;
  insert into public.audit_admissions(audit_id,user_id,guest_key_hash,ip_hash,normalized_domain,normalized_url,audit_mode,scope_fingerprint,decision,decision_code)
    values(p_audit_id,p_user_id,p_guest_key_hash,left(p_ip_hash,128),lower(p_normalized_domain),p_normalized_url,p_audit_mode,p_scope_fingerprint,'accepted','ACCEPTED');
  return jsonb_build_object('allowed',true,'code','ACCEPTED','auditId',p_audit_id,'reusedExistingAudit',false,'retryAfterSeconds',0,'queueDepth',v_global_active+1,'softQueueWarning',v_global_active+1>=v_soft_limit);
end $$;

-- Preserve the old URL and RPC contract while fixing its depth-aware reuse.
create or replace function public.admit_audit_submission(
  p_audit_id uuid,p_user_id uuid,p_guest_key_hash text,p_ip_hash text,p_normalized_domain text,p_normalized_url text,
  p_audit_mode text,p_plan text,p_daily_limit integer,p_domain_daily_limit integer,p_active_limit integer,p_global_active_limit integer,p_bot_verified boolean default false
) returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select public.admit_scoped_audit_submission(p_audit_id,p_user_id,p_guest_key_hash,p_ip_hash,p_normalized_domain,p_normalized_url,p_audit_mode,p_plan,p_daily_limit,p_domain_daily_limit,p_active_limit,p_global_active_limit,p_bot_verified)
$$;

-- Preserve the existing guarded administrator retry, including its logging and
-- quotas, while carrying the immutable selection into the new audit record.
do $$ declare definition text; original text; begin
  select pg_get_functiondef(oid) into definition from pg_proc where pronamespace='public'::regnamespace and proname='admin_audit_operation' limit 1;
  if definition is not null and position('plan_page_limit' in definition)=0 then
    original=definition;
    definition=replace(definition,
      '''page_limit'',case a.effective_mode when ''quick'' then limits.max_pages_quick when ''standard'' then limits.max_pages_standard else limits.max_pages_deep end,',
      '''page_limit'',case when a.audit_scope->>''coverage''=''page'' then 1 else case a.effective_mode when ''quick'' then limits.max_pages_quick when ''standard'' then limits.max_pages_standard else limits.max_pages_deep end end,
      ''plan_page_limit'',case a.effective_mode when ''quick'' then limits.max_pages_quick when ''standard'' then limits.max_pages_standard else limits.max_pages_deep end,');
    definition=replace(definition,'and (a.effective_mode<>''deep'' or deep_enabled))','and (a.effective_mode<>''deep'' or deep_enabled) and (a.audit_scope is null or (scope_version=1 and scope_commit_id=commit_id)))');
    if definition=original or position('plan_page_limit' in definition)=0 then raise exception 'ADMIN_RETRY_SCOPE_UPGRADE_FAILED'; end if;
    execute definition;
  end if;
end $$;

revoke all on function public.claim_audit_work(text,boolean,boolean) from public,anon,authenticated,service_role;
do $$ declare f record; begin
  for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('claim_scoped_audit','claim_scalable_audit','read_scoped_audit_frontier','admit_scoped_audit_submission','admit_audit_submission') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
revoke all on function public.guard_audit_scope() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
