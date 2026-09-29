begin;

alter table public.audits add column if not exists processing_version integer not null default 1 check (processing_version in (1,2));

create table if not exists public.audit_crawl_runs (
  audit_id uuid primary key references public.audits(id) on delete cascade,
  state text not null default 'waiting' check (state in ('waiting','running','finished')),
  owner text,
  generation bigint not null default 0,
  lease_until timestamptz,
  last_served_at timestamptz not null default now(),
  slice_started_at timestamptz,
  active_ms bigint not null default 0,
  budget_ms bigint not null,
  candidate_limit integer not null check (candidate_limit between 1 and 20000),
  discovered integer not null default 0,
  attempted integer not null default 0,
  analysed integer not null default 0,
  failed integer not null default 0,
  blocked integer not null default 0,
  page_count integer not null default 0,
  error_pages integer not null default 0,
  redirect_pages integer not null default 0,
  slow_pages integer not null default 0,
  large_pages integer not null default 0,
  check_count integer not null default 0,
  unavailable_count integer not null default 0,
  failure_count integer not null default 0,
  discovery_documents integer not null default 0,
  metadata jsonb not null default '{}',
  retry_at timestamptz not null default now(),
  last_score_pages integer not null default 0,
  last_score_at timestamptz,
  last_error text,
  peak_rss_bytes bigint not null default 0
);

create table if not exists public.audit_crawl_frontier (
  audit_id uuid not null references public.audits(id) on delete cascade,
  key text not null,
  url text not null check (octet_length(url) <= 2048),
  kind text not null check (kind in ('robots','sitemap','page')),
  depth integer not null default 0 check (depth between 0 and 100),
  source_url text,
  anchor text,
  state text not null default 'pending' check (state in ('pending','done','skipped')),
  attempts integer not null default 0,
  discovery_offset integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  primary key (audit_id,key)
);
create index if not exists audit_crawl_frontier_pending on public.audit_crawl_frontier(audit_id,kind,depth,key) where state='pending';
create index if not exists audit_crawl_runs_waiting on public.audit_crawl_runs(state,retry_at,last_served_at);

create table if not exists public.audit_score_groups (
  audit_id uuid not null references public.audits(id) on delete cascade,
  key text not null,
  category text not null,
  title text not null,
  severity text not null,
  severity_rank integer not null,
  affected_pages integer not null default 0,
  primary key(audit_id,key)
);
create table if not exists public.audit_scalable_workers (
  worker_id text primary key,
  seen_at timestamptz not null default now(),
  commit_id text not null,
  processing_version integer not null default 2,
  deep_enabled boolean not null default false
);

create table if not exists public.audit_export_jobs (
  id uuid primary key default gen_random_uuid(),
  -- Retain the private artifact manifest until cleanup even if its audit is deleted.
  audit_id uuid references public.audits(id) on delete set null,
  format text not null check(format in ('json','pages.csv','issues.csv')),
  state text not null default 'queued' check(state in ('queued','running','ready','failed')),
  owner text,
  lease_until timestamptz,
  cursor text,
  section text not null default 'pages',
  part integer not null default 0,
  object_prefix text not null default gen_random_uuid()::text,
  error text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '24 hours'),
  unique(audit_id,format)
);
create index if not exists audit_export_jobs_queue on public.audit_export_jobs(state,created_at);
create index if not exists audit_pages_cursor on public.audit_pages(audit_id,id);
create index if not exists audit_issues_cursor on public.audit_issues(audit_id,id);
create index if not exists audit_events_cursor on public.audit_events(audit_id,id);

-- Version-1 workers inspect the audits table directly. A separate lease owns v2
-- jobs; these sentinel locks keep even an old binary from claiming them.
create or replace function public.guard_scalable_audit() returns trigger language plpgsql set search_path=public as $$
begin
  if new.processing_version=2 and new.status in ('queued','running') then
    new.locked_by='scalable-v2';
    new.lease_expires_at=greatest(new.expires_at,now()+interval '1 day');
  end if;
  return new;
end $$;
drop trigger if exists guard_scalable_audit on public.audits;
create trigger guard_scalable_audit before insert or update on public.audits for each row execute function public.guard_scalable_audit();

create or replace function public.initialize_scalable_audit() returns trigger language plpgsql set search_path=public as $$
begin
  if new.processing_version=2 then
    if new.page_limit<1 or new.page_limit>(case when new.plan='admin' then 5000 else 500 end) then
      raise exception 'Unsupported scalable page allowance';
    end if;
    insert into public.audit_crawl_runs(audit_id,budget_ms,candidate_limit)
    values(new.id,case when new.plan='admin' then 43200000 else 7200000 end,
      least(20000,new.page_limit*case when new.effective_mode='quick' then 2 else 4 end));
    insert into public.audit_crawl_frontier(audit_id,key,url,kind,depth)
    values(new.id,encode(digest('page:'||new.normalized_url,'sha256'),'hex'),new.normalized_url,'page',0);
    update public.audit_crawl_runs set discovered=1 where audit_id=new.id;
  end if;
  return new;
end $$;
drop trigger if exists initialize_scalable_audit on public.audits;
create trigger initialize_scalable_audit after insert on public.audits for each row execute function public.initialize_scalable_audit();

create or replace function public.claim_scalable_audit(p_worker text,p_deep boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.audit_crawl_runs; a public.audits;
begin
  -- Serialize claims across workers to enforce one active audit per target host.
  perform pg_advisory_xact_lock(hashtext('crawlio-scalable-claims'));
  select c.* into r from public.audit_crawl_runs c join public.audits j on j.id=c.audit_id
    where j.status in ('queued','running') and c.state<>'finished' and c.retry_at<=now()
      and (p_deep or j.effective_mode<>'deep') and (c.lease_until is null or c.lease_until<now())
      and not exists(select 1 from public.audit_crawl_runs other join public.audits target on target.id=other.audit_id
        where other.audit_id<>c.audit_id and other.lease_until>now() and target.status in ('queued','running')
          and regexp_replace(target.hostname,'^www\.','')=regexp_replace(j.hostname,'^www\.',''))
    order by c.last_served_at - least(j.queue_priority,1000)*interval '60 milliseconds',j.created_at
    limit 1 for update of c skip locked;
  if not found then return null; end if;
  update public.audit_crawl_runs set state='running',owner=p_worker,generation=generation+1,
    active_ms=active_ms+case when slice_started_at is null then 0 else least(120000,greatest(0,extract(epoch from (coalesce(lease_until,now())-slice_started_at))*1000))::bigint end,
    lease_until=now()+interval '120 seconds',slice_started_at=now(),last_served_at=now()
    where audit_id=r.audit_id returning * into r;
  update public.audits set status='running',started_at=coalesce(started_at,now()),current_phase='Checking pages',worker_runtime='scalable-v2'
    where id=r.audit_id returning * into a;
  return jsonb_build_object('run',to_jsonb(r),'audit',to_jsonb(a));
end $$;

create or replace function public.scalable_audit_commit(p_audit uuid,p_worker text,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.audit_crawl_runs; a public.audits; item jsonb; child jsonb; grp jsonb;
  f public.audit_crawl_frontier; page_row public.audit_pages; issue_row public.audit_issues;
  inserted_count integer; issue_count integer; severity_counts jsonb; current_key text;
begin
  select * into r from public.audit_crawl_runs where audit_id=p_audit for update;
  select * into a from public.audits where id=p_audit for update;
  if r.owner is distinct from p_worker or r.generation is distinct from p_generation or r.lease_until<=now()
     or a.status not in ('queued','running') then raise exception 'AUDIT_OWNERSHIP_LOST'; end if;
  if octet_length(p_payload::text)>4194304 or jsonb_array_length(coalesce(p_payload->'items','[]'))>5 then raise exception 'Batch too large'; end if;
  for item in select value from jsonb_array_elements(coalesce(p_payload->'items','[]')) loop
    current_key=item->>'key';
    select * into f from public.audit_crawl_frontier where audit_id=p_audit and key=current_key for update;
    if not found or f.state<>'pending' then continue; end if;
    if item ? 'retryAt' then
      update public.audit_crawl_frontier set attempts=attempts+1,next_attempt_at=least(now()+interval '15 minutes',greatest(now(),(item->>'retryAt')::timestamptz)) where audit_id=p_audit and key=current_key;
      continue;
    end if;
    if not coalesce((item->>'discoveryOnly')::boolean,false) then
    if f.kind='page' then
      if r.analysed>=a.page_limit then exit; end if;
      r.attempted=r.attempted+1;
      page_row=jsonb_populate_record(null::public.audit_pages,item->'page');
      page_row.audit_id=p_audit;
      insert into public.audit_pages select page_row.* on conflict do nothing;
      get diagnostics inserted_count=row_count;
      if inserted_count>0 then
        r.page_count=r.page_count+1;
        r.analysed=r.analysed+case when page_row.fetch_status='success' then 1 else 0 end;
        r.failed=r.failed+case when page_row.fetch_status='failed' then 1 else 0 end;
        r.blocked=r.blocked+case when page_row.fetch_status='blocked' then 1 else 0 end;
        r.error_pages=r.error_pages+case when page_row.status_code<=0 or page_row.status_code>=400 then 1 else 0 end;
        r.redirect_pages=r.redirect_pages+case when page_row.status_code between 300 and 399 then 1 else 0 end;
        r.slow_pages=r.slow_pages+case when page_row.response_time_ms>1500 then 1 else 0 end;
        r.large_pages=r.large_pages+case when page_row.page_size_bytes>1000000 then 1 else 0 end;
        r.check_count=r.check_count+coalesce((item->>'checks')::integer,0);
        r.unavailable_count=r.unavailable_count+coalesce((item->>'unavailable')::integer,0);
        r.failure_count=r.failure_count+case when page_row.fetch_status<>'success' then 1 else 0 end+coalesce((item->>'unavailable')::integer,0);
        for child in select value from jsonb_array_elements(coalesce(item->'issues','[]')) loop
          issue_row=jsonb_populate_record(null::public.audit_issues,child);
          issue_row.audit_id=p_audit;
          insert into public.audit_issues select issue_row.* on conflict(id) do nothing;
          get diagnostics issue_count=row_count;
          if issue_count>0 then
            a.issues_found=a.issues_found+1;
            a.critical_count=a.critical_count+case when issue_row.severity='critical' then 1 else 0 end;
            a.high_count=a.high_count+case when issue_row.severity='high' then 1 else 0 end;
            a.medium_count=a.medium_count+case when issue_row.severity='medium' then 1 else 0 end;
            a.low_count=a.low_count+case when issue_row.severity='low' then 1 else 0 end;
          end if;
        end loop;
        for grp in select value from jsonb_array_elements(coalesce(item->'groups','[]')) loop
          insert into public.audit_score_groups(audit_id,key,category,title,severity,severity_rank,affected_pages)
            values(p_audit,grp->>'key',grp->>'category',grp->>'title',grp->>'severity',(grp->>'rank')::integer,1)
          on conflict(audit_id,key) do update set affected_pages=audit_score_groups.affected_pages+1,
            severity=case when excluded.severity_rank>audit_score_groups.severity_rank then excluded.severity else audit_score_groups.severity end,
            severity_rank=greatest(audit_score_groups.severity_rank,excluded.severity_rank);
        end loop;
        if a.final_url is null and page_row.fetch_status='success' then a.final_url=page_row.url; end if;
      end if;
    else
      r.discovery_documents=r.discovery_documents+1;
    end if;
    update public.audit_crawl_frontier set state='done',attempts=attempts+1 where audit_id=p_audit and key=current_key;
    end if;
    for child in select value from jsonb_array_elements(coalesce(item->'children','[]')) loop
      if child->>'kind'='page' and r.discovered>=r.candidate_limit then continue; end if;
      if child->>'kind'<>'page' and (select count(*) from public.audit_crawl_frontier where audit_id=p_audit and kind<>'page')>=128 then continue; end if;
      insert into public.audit_crawl_frontier(audit_id,key,url,kind,depth,source_url,anchor)
        values(p_audit,child->>'key',child->>'url',child->>'kind',least(100,greatest(0,(child->>'depth')::integer)),child->>'source_url',child->>'anchor') on conflict do nothing;
      get diagnostics inserted_count=row_count;
      if child->>'kind'='page' then r.discovered=r.discovered+inserted_count; end if;
    end loop;
    if item ? 'discoveryOffset' then
      update public.audit_crawl_frontier set discovery_offset=greatest(discovery_offset,(item->>'discoveryOffset')::integer)
        where audit_id=p_audit and key=current_key;
    end if;
  end loop;
  for child in select value from jsonb_array_elements(coalesce(p_payload->'seed','[]')) loop
    if child->>'kind'='page' or (select count(*) from public.audit_crawl_frontier where audit_id=p_audit and kind<>'page')>=128 then continue; end if;
    insert into public.audit_crawl_frontier(audit_id,key,url,kind,depth)
      values(p_audit,child->>'key',child->>'url',child->>'kind',0) on conflict do nothing;
  end loop;
  if p_payload ? 'score' then
    insert into public.audit_events(id,audit_id,type,message,data)
      values('v2-score-'||p_audit::text||'-'||r.analysed::text,p_audit,'score_updated','Preliminary score updated',p_payload->'score') on conflict do nothing;
    r.last_score_pages=r.analysed;
    r.last_score_at=now();
    delete from public.audit_events where audit_id=p_audit and id in
      (select id from public.audit_events where audit_id=p_audit order by created_at desc,id desc offset 300);
  end if;
  r.metadata=r.metadata||coalesce(p_payload->'metadata','{}');
  update public.audit_crawl_runs set discovered=r.discovered,attempted=r.attempted,analysed=r.analysed,
    failed=r.failed,blocked=r.blocked,page_count=r.page_count,error_pages=r.error_pages,redirect_pages=r.redirect_pages,
    slow_pages=r.slow_pages,large_pages=r.large_pages,check_count=r.check_count,unavailable_count=r.unavailable_count,
    failure_count=r.failure_count,discovery_documents=r.discovery_documents,metadata=r.metadata,last_score_pages=r.last_score_pages,last_score_at=r.last_score_at,lease_until=now()+interval '120 seconds',
    peak_rss_bytes=greatest(peak_rss_bytes,coalesce((p_payload->>'rss')::bigint,0)) where audit_id=p_audit;
  update public.audits set pages_discovered=r.discovered,pages_crawled=r.analysed,checks_completed=r.check_count,
    checks_total=greatest(r.check_count,r.discovered),issues_found=a.issues_found,critical_count=a.critical_count,
    high_count=a.high_count,medium_count=a.medium_count,low_count=a.low_count,final_url=a.final_url,warning_count=r.failure_count,
    progress=greatest(progress,least(90,10+(80*r.analysed/greatest(1,page_limit)))),
    current_url=coalesce(p_payload->>'currentUrl',current_url),current_phase=coalesce(p_payload->>'phase','Checking pages'),updated_at=now()
    where id=p_audit;
  return to_jsonb(r);
end $$;

create or replace function public.scalable_audit_finish_slice(p_audit uuid,p_worker text,p_generation bigint,p_report jsonb default null,p_reason text default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare r public.audit_crawl_runs; a public.audits; result_status text;
begin
  select * into r from public.audit_crawl_runs where audit_id=p_audit for update;
  select * into a from public.audits where id=p_audit for update;
  if r.owner is distinct from p_worker or r.generation is distinct from p_generation or r.lease_until<=now() or a.status not in ('queued','running') then return false; end if;
  if p_report is not null then
    if octet_length(p_report::text)>1048576 then raise exception 'Report summary too large'; end if;
    insert into public.audit_reports(audit_id,scores,summary,top_issues,pages,exports,generated_at)
      values(p_audit,p_report->'scores',p_report->'summary',p_report->'top_issues',p_report->'pages',p_report->'exports',now())
      on conflict(audit_id) do update set scores=excluded.scores,summary=excluded.summary,top_issues=excluded.top_issues,pages=excluded.pages,exports=excluded.exports,generated_at=excluded.generated_at;
    result_status=case when r.analysed=0 then 'failed' when r.failure_count>0 or p_reason in ('audit_deadline_reached','resource_limit') then 'completed_with_warnings' else 'completed' end;
    if r.analysed>0 then
      insert into public.audit_events(id,audit_id,type,message,data)
      values('v2-final-score-'||p_audit::text,p_audit,'score_updated','Final report score ready',jsonb_build_object(
        'overallScore',p_report->'scores'->'overall','scoreState','final','pagesAnalysed',r.analysed,
        'pagesDiscovered',r.discovered,'pageLimit',a.page_limit,'unavailableCount',r.unavailable_count,'updatedAt',now(),
        'categoryScores',jsonb_build_object('onPage',p_report->'scores'->'seo','technical',p_report->'scores'->'technical',
          'crawlability',p_report->'scores'->'crawlability','internalLinks',p_report->'scores'->'internalLinks',
          'performance',p_report->'scores'->'performance','mobile',p_report->'scores'->'mobile',
          'security',p_report->'scores'->'security','structuredData',p_report->'scores'->'structuredData',
          'accessibility',p_report->'scores'->'accessibility'))) on conflict do nothing;
    end if;
    update public.audits set status=result_status,progress=100,current_phase=case when r.analysed=0 then 'No usable pages found' else 'Report ready' end,
      error=case when r.analysed=0 then 'No discovered page returned usable evidence. Open page findings for the recorded reasons.' else null end,
      current_url=null,current_check=null,completed_at=now(),locked_by=null,lease_expires_at=null where id=p_audit;
  else
    update public.audits set current_phase=coalesce(p_reason,'Waiting for next crawl batch'),current_url=null where id=p_audit;
  end if;
  update public.audit_crawl_runs set state=case when p_report is null then 'waiting' else 'finished' end,
    active_ms=active_ms+greatest(0,extract(epoch from (now()-slice_started_at))*1000)::bigint,
    slice_started_at=null,owner=null,lease_until=null,last_served_at=now(),last_error=p_reason,
    retry_at=case when p_reason is not null and p_report is null then now()+interval '30 seconds'
      when p_report is null then greatest(now(), coalesce(
        (select min(next_attempt_at) from public.audit_crawl_frontier where audit_id=p_audit and state='pending' and kind='robots'),
        (select min(next_attempt_at) from public.audit_crawl_frontier where audit_id=p_audit and state='pending'),now()))
      else now() end
    where audit_id=p_audit;
  return true;
end $$;

create or replace function public.scalable_comparison_counts(p_current uuid,p_baseline uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  with keys as (
    select audit_id, lower(regexp_replace(trim(category||'|'||title||'|'||
      coalesce(substring(affected_url from '^https?://(\[[^]]+\]|[^/:?#]+)') ||
        coalesce(nullif(regexp_replace(substring(affected_url from '^https?://[^/]+(/[^?#]*)'),'/$',''),''),'/'),affected_url)), '\s+', ' ', 'g')) as key
    from audit_issues where audit_id in (p_current,p_baseline)
  ), current_keys as (select distinct key from keys where audit_id=p_current),
  baseline_keys as (select distinct key from keys where audit_id=p_baseline)
  select jsonb_build_object(
    'new',count(*) filter(where b.key is null),
    'resolved',count(*) filter(where c.key is null),
    'persistent',count(*) filter(where c.key is not null and b.key is not null))
  from current_keys c full join baseline_keys b using(key);
$$;

do $$ declare t text; f record; begin
  foreach t in array array['audit_crawl_runs','audit_crawl_frontier','audit_score_groups','audit_scalable_workers','audit_export_jobs'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace
    and proname in ('claim_scalable_audit','scalable_audit_commit','scalable_audit_finish_slice','guard_scalable_audit','initialize_scalable_audit','scalable_comparison_counts') loop
    execute format('revoke all on function %s from public, anon, authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;

insert into storage.buckets(id,name,public) values('audit-exports','audit-exports',false) on conflict(id) do nothing;
update public.plan_limits set max_pages_quick=case when allowed_modes ? 'quick' then 1000 else max_pages_quick end,
  max_pages_standard=case when allowed_modes ? 'standard' then 1000 else max_pages_standard end,
  max_pages_deep=case when allowed_modes ? 'deep' then 1000 else max_pages_deep end where plan='admin';
notify pgrst,'reload schema';
commit;
