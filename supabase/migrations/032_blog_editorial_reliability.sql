begin;

create index if not exists blog_revisions_sync_version_idx
  on public.blog_revisions (article_id, (snapshot->>'editorialSyncVersion'))
  where snapshot ? 'editorialSyncVersion';

-- One transaction replaces derived evidence and records its exact content version.
-- A failed insert rolls back all replacements; replaying a version adds no history.
create or replace function public.sync_blog_editorial_records(
  p_article uuid, p_expected_updated_at timestamptz, p_actor uuid,
  p_previous_status text, p_sources jsonb, p_links jsonb
) returns boolean language plpgsql security definer set search_path=public as $$
declare
  article public.blog_posts%rowtype;
  version_key text;
begin
  if jsonb_typeof(p_sources) is distinct from 'array' or jsonb_typeof(p_links) is distinct from 'array'
     or jsonb_array_length(p_sources)>30 or jsonb_array_length(p_links)>1000
     or octet_length(p_sources::text)+octet_length(p_links::text)>500000 then
    raise exception 'BLOG_EDITORIAL_EVIDENCE_INVALID';
  end if;
  select * into article from public.blog_posts where id=p_article for update;
  if not found then raise exception 'BLOG_POST_NOT_FOUND'; end if;
  if p_expected_updated_at is null or article.updated_at<>p_expected_updated_at then
    raise exception 'BLOG_POST_EDIT_CONFLICT';
  end if;
  version_key=to_char(p_expected_updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US');
  if exists(select 1 from public.blog_revisions where article_id=p_article
      and snapshot ? 'editorialSyncVersion' and snapshot->>'editorialSyncVersion'=version_key) then
    return false;
  end if;

  delete from public.blog_sources where article_id=p_article;
  insert into public.blog_sources(article_id,url,title,publisher,author,published_at,updated_at_source,
    accessed_at,source_type,supported_claims,primary_source,reliability,citation_status)
  select distinct on (url) p_article,url,title,publisher,coalesce(author,''),published_at,updated_at_source,
    coalesce(accessed_at,article.updated_at),coalesce(source_type,'reference'),coalesce(supported_claims,'[]'::jsonb),
    coalesce(primary_source,false),coalesce(reliability,'unverified'),coalesce(citation_status,'needs_review')
  from jsonb_to_recordset(p_sources) as source(url text,title text,publisher text,author text,
    published_at timestamptz,updated_at_source timestamptz,accessed_at timestamptz,source_type text,
    supported_claims jsonb,primary_source boolean,reliability text,citation_status text)
  order by url;

  delete from public.blog_links where article_id=p_article;
  insert into public.blog_links(article_id,link_type,href,anchor_text,canonical,validation_status)
  select distinct on (href,anchor_text) p_article,link_type,href,anchor_text,true,'passed'
  from jsonb_to_recordset(p_links) as link(link_type text,href text,anchor_text text)
  order by href,anchor_text,case when link_type='related' then 0 else 1 end;

  if jsonb_typeof(article.quality_results)='object' then
    insert into public.blog_quality_results(article_id,generation_job_id,gate_type,status,checks,blocked_reasons,checked_at)
    values(p_article,article.generation_job_id,'content',
      case when article.quality_results->>'status' in ('passed','blocked') then article.quality_results->>'status' else 'needs_review' end,
      coalesce(article.quality_results->'checks','[]'::jsonb),coalesce(article.quality_results->'blockedReasons','[]'::jsonb),
      coalesce((article.quality_results->>'checkedAt')::timestamptz,article.updated_at));
  end if;
  insert into public.blog_revisions(article_id,actor_id,origin,previous_state,new_state,reason,snapshot)
  values(p_article,p_actor,article.origin,coalesce(p_previous_status,''),article.status,
    case when p_previous_status=article.status then 'Content or metadata updated.' else 'Editorial state changed.' end,
    jsonb_build_object('editorialSyncVersion',version_key,'title',article.title,'slug',article.slug,
      'qualityStatus',article.quality_status,'sourceStatus',article.source_status,
      'originalityStatus',article.originality_status,'prerenderStatus',article.prerender_status,'imageStatus',article.image_status));
  if coalesce(p_previous_status,'')<>article.status then
    insert into public.blog_publication_events(article_id,generation_job_id,actor_id,event_type,previous_state,new_state,reason,scheduled_for)
    values(p_article,article.generation_job_id,p_actor,'state_change',coalesce(p_previous_status,''),article.status,
      coalesce(article.publication_reason,''),article.scheduled_at);
  end if;
  return true;
end $$;

revoke all on function public.sync_blog_editorial_records(uuid,timestamptz,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.sync_blog_editorial_records(uuid,timestamptz,uuid,text,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
