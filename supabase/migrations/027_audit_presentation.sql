begin;

alter table public.audits add column if not exists presentation_summary jsonb;
alter table public.audit_reports add column if not exists presentation_summary jsonb;
alter table public.audit_crawl_runs add column if not exists presentation_summary jsonb;
-- Set the default separately: existing runs remain NULL and explicitly sample-only.
alter table public.audit_crawl_runs alter column presentation_summary set default jsonb_build_object(
  'version',1,'scope','complete','analysedPages',0,'attemptedPages',0,
  'responseOutcomes',jsonb_build_object('success',0,'redirect',0,'clientError',0,'serverError',0,'unavailable',0),
  'delivery',jsonb_build_object('count',0,'totalResponseMs',0,'totalBytes',0,'averageResponseMs',null,'averagePageBytes',null),
  'pagesWithFindings',0,'depthCounts','{}'::jsonb,'findingsBySection','{}'::jsonb,
  'topRecommendations','[]'::jsonb,'updatedAt',now());

-- Match classifyReportSection exactly, including precedence and description text.
create or replace function public.classify_audit_report_section(p_category text,p_title text,p_description text)
returns text language sql immutable parallel safe as $$
  select case
    when text ~ 'accessibility|accessible name|assistive|aria|tabindex|main landmark|page zoom' then 'accessibility'
    when text ~ 'security|https|tls|certificate|header|cookie|csp|hsts|cors|mixed content|x-frame|referrer-policy|permissions-policy' then 'security'
    when text ~ 'internal link|broken link|orphan|anchor text|crawl depth' then 'internal-links'
    when text ~ 'performance|response time|slow|page size|payload|compression|cache|resource|latency' then 'performance'
    when text ~ 'mobile|viewport|tap target|responsive|usability' then 'mobile'
    when text ~ 'schema|structured data|json-ld|open graph|twitter card|social preview' then 'structured-data'
    when text ~ 'robots|sitemap|index|canonical|preferred page url|crawlable|crawlability|noindex' then 'crawlability'
    when text ~ 'status code|redirect|http error|doctype|charset|content-type|server error' then 'technical'
    else 'on-page' end
  from (select lower(coalesce(p_category,'')||' '||coalesce(p_title,'')||' '||coalesce(p_description,'')) as text) classified;
$$;

-- A service-only PostgREST computed field, inlined into the indexed expression.
create or replace function public.audit_report_section(public.audit_issues)
returns text language sql immutable parallel safe as $$
  select public.classify_audit_report_section(($1).category,($1).title,($1).description);
$$;
create index if not exists audit_issues_section_cursor on public.audit_issues
  (audit_id,public.classify_audit_report_section(category,title,description),id);
create index if not exists audit_issues_affected_url_cursor on public.audit_issues(audit_id,affected_url,id);

create or replace function public.audit_presentation_add_page(p_summary jsonb,p_page public.audit_pages)
returns jsonb language plpgsql immutable strict set search_path=public as $$
declare outcome text; depth text; delivered integer; delivery_count bigint; response_ms numeric; bytes numeric;
begin
  outcome=case when p_page.status_code between 200 and 299 then 'success'
    when p_page.status_code between 300 and 399 then 'redirect'
    when p_page.status_code between 400 and 499 then 'clientError'
    when p_page.status_code between 500 and 599 then 'serverError' else 'unavailable' end;
  depth=least(100,greatest(0,coalesce(p_page.crawl_depth,0)))::text;
  -- Failure placeholders have no measured delivery; do not average their zeroes.
  delivered=case when p_page.fetch_status='success' then 1 else 0 end;
  delivery_count=(p_summary#>>'{delivery,count}')::bigint+delivered;
  response_ms=(p_summary#>>'{delivery,totalResponseMs}')::numeric
    +case when delivered=1 then greatest(0,coalesce(p_page.response_time_ms,0)) else 0 end;
  bytes=(p_summary#>>'{delivery,totalBytes}')::numeric
    +case when delivered=1 then greatest(0,coalesce(p_page.page_size_bytes,0)) else 0 end;
  p_summary=jsonb_set(p_summary,array['responseOutcomes',outcome],to_jsonb(coalesce((p_summary#>>array['responseOutcomes',outcome])::bigint,0)+1));
  p_summary=jsonb_set(p_summary,array['depthCounts',depth],to_jsonb(coalesce((p_summary#>>array['depthCounts',depth])::bigint,0)+1));
  return p_summary||jsonb_build_object(
    'attemptedPages',(p_summary->>'attemptedPages')::bigint+1,
    'analysedPages',(p_summary->>'analysedPages')::bigint+delivered,
    'delivery',jsonb_build_object('count',delivery_count,'totalResponseMs',response_ms,'totalBytes',bytes,
      'averageResponseMs',case when delivery_count>0 then response_ms/delivery_count else null end,
      'averagePageBytes',case when delivery_count>0 then bytes/delivery_count else null end));
end $$;

create or replace function public.scalable_audit_top_recommendations(p_audit uuid)
returns jsonb language sql stable set search_path=public as $$
  with classified as materialized (
    select id,title,category,severity,recommendation,affected_url,
      lower(btrim(public.audit_report_section(i)||'|'||category||'|'||title)) as key,
      case severity when 'critical' then 5 when 'high' then 4 when 'medium' then 3 when 'low' then 2 else 1 end as rank
    from public.audit_issues i where audit_id=p_audit
  ), grouped as (
    select key,count(distinct nullif(btrim(affected_url),'')) as affected_pages,max(rank) as rank
    from classified group by key
  ), representatives as (
    select distinct on (key) key,title,category,severity,recommendation
    from classified order by key,rank desc,id
  ), top_groups as (
    select g.key,r.title,r.category,r.severity,g.affected_pages,r.recommendation,g.rank
    from grouped g join representatives r using(key)
    order by g.rank desc,g.affected_pages desc,r.title,g.key limit 10
  )
  select coalesce(jsonb_agg(jsonb_build_object('key',key,'title',title,'category',category,'severity',severity,
    'affectedPages',affected_pages,'recommendation',recommendation)
    order by rank desc,affected_pages desc,title,key),'[]'::jsonb) from top_groups;
$$;

-- Same signature, fencing, scoring counters and bounded writes as migration 025.
create or replace function public.scalable_audit_commit(p_audit uuid,p_worker text,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.audit_crawl_runs; a public.audits; item jsonb; child jsonb; grp jsonb;
  f public.audit_crawl_frontier; page_row public.audit_pages; issue_row public.audit_issues;
  inserted_count integer; issue_count integer; severity_counts jsonb; current_key text;
  page_findings integer; section text;
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
        r.presentation_summary=public.audit_presentation_add_page(r.presentation_summary,page_row);
        page_findings=0;
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
            page_findings=page_findings+1;
            if r.presentation_summary is not null then
              section=public.audit_report_section(issue_row);
              r.presentation_summary=jsonb_set(r.presentation_summary,array['findingsBySection',section],
                to_jsonb(coalesce((r.presentation_summary#>>array['findingsBySection',section])::bigint,0)+1));
            end if;
          end if;
        end loop;
        if r.presentation_summary is not null then
          r.presentation_summary=r.presentation_summary||jsonb_build_object('updatedAt',now(),
            'pagesWithFindings',(r.presentation_summary->>'pagesWithFindings')::bigint+case when page_findings>0 then 1 else 0 end);
        end if;
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
    presentation_summary=r.presentation_summary,
    peak_rss_bytes=greatest(peak_rss_bytes,coalesce((p_payload->>'rss')::bigint,0)) where audit_id=p_audit;
  update public.audits set pages_discovered=r.discovered,pages_crawled=r.analysed,checks_completed=r.check_count,
    checks_total=greatest(r.check_count,r.discovered),issues_found=a.issues_found,critical_count=a.critical_count,
    high_count=a.high_count,medium_count=a.medium_count,low_count=a.low_count,final_url=a.final_url,warning_count=r.failure_count,
    presentation_summary=r.presentation_summary,
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
    if r.presentation_summary is not null then
      r.presentation_summary=r.presentation_summary||jsonb_build_object(
        'topRecommendations',public.scalable_audit_top_recommendations(p_audit),'updatedAt',now());
    end if;
    insert into public.audit_reports(audit_id,scores,summary,top_issues,pages,exports,generated_at,presentation_summary)
      values(p_audit,p_report->'scores',p_report->'summary',p_report->'top_issues',p_report->'pages',p_report->'exports',now(),r.presentation_summary)
      on conflict(audit_id) do update set scores=excluded.scores,summary=excluded.summary,top_issues=excluded.top_issues,pages=excluded.pages,exports=excluded.exports,generated_at=excluded.generated_at,presentation_summary=excluded.presentation_summary;
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
      presentation_summary=r.presentation_summary,
      current_url=null,current_check=null,completed_at=now(),locked_by=null,lease_expires_at=null where id=p_audit;
  else
    update public.audits set current_phase=coalesce(p_reason,'Waiting for next crawl batch'),current_url=null where id=p_audit;
  end if;
  update public.audit_crawl_runs set state=case when p_report is null then 'waiting' else 'finished' end,
    active_ms=active_ms+greatest(0,extract(epoch from (now()-slice_started_at))*1000)::bigint,
    presentation_summary=r.presentation_summary,
    slice_started_at=null,owner=null,lease_until=null,last_served_at=now(),last_error=p_reason,
    retry_at=case when p_reason is not null and p_report is null then now()+interval '30 seconds'
      when p_report is null then greatest(now(), coalesce(
        (select min(next_attempt_at) from public.audit_crawl_frontier where audit_id=p_audit and state='pending' and kind='robots'),
        (select min(next_attempt_at) from public.audit_crawl_frontier where audit_id=p_audit and state='pending'),now()))
      else now() end
    where audit_id=p_audit;
  return true;
end $$;

revoke all on function public.classify_audit_report_section(text,text,text),public.audit_report_section(public.audit_issues),
  public.audit_presentation_add_page(jsonb,public.audit_pages),public.scalable_audit_top_recommendations(uuid),
  public.scalable_audit_commit(uuid,text,bigint,jsonb),public.scalable_audit_finish_slice(uuid,text,bigint,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.classify_audit_report_section(text,text,text),public.audit_report_section(public.audit_issues),
  public.audit_presentation_add_page(jsonb,public.audit_pages),public.scalable_audit_top_recommendations(uuid),
  public.scalable_audit_commit(uuid,text,bigint,jsonb),public.scalable_audit_finish_slice(uuid,text,bigint,jsonb,text)
  to service_role;

notify pgrst,'reload schema';
commit;
