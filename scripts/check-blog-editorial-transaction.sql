-- Run after migration 032. Every fixture write is rolled back; nothing is published.
begin;
do $$
declare
  fixture_id uuid=gen_random_uuid();
  saved_version timestamptz;
  newer_version timestamptz;
  source_rows jsonb='[{"url":"https://example.com/source","title":"Source","publisher":"Example"},{"url":"https://example.com/source","title":"Source","publisher":"Example"}]';
  link_rows jsonb='[{"href":"/blog/fixture","anchor_text":"Fixture","link_type":"internal"},{"href":"/blog/fixture","anchor_text":"Fixture","link_type":"related"}]';
  accepted boolean;
begin
  insert into public.blog_posts(id,slug,title,status,fixture_test,robots_directive,updated_at)
  values(fixture_id,'editorial-transaction-'||fixture_id,'Private editorial transaction fixture','draft',true,'noindex,nofollow',now()-interval '1 second')
  returning updated_at into saved_version;

  accepted=public.sync_blog_editorial_records(fixture_id,saved_version,null,'',source_rows,link_rows);
  if not accepted or (select count(*) from public.blog_sources where article_id=fixture_id)<>1 then
    raise exception 'Source deduplication failed';
  end if;
  if (select count(*) from public.blog_links where article_id=fixture_id)<>1
     or not exists(select 1 from public.blog_links where article_id=fixture_id and link_type='related') then
    raise exception 'Link deduplication or related-link priority failed';
  end if;
  accepted=public.sync_blog_editorial_records(fixture_id,saved_version,null,'',source_rows,link_rows);
  if accepted or (select count(*) from public.blog_revisions where article_id=fixture_id)<>1
     or (select count(*) from public.blog_quality_results where article_id=fixture_id)<>1
     or (select count(*) from public.blog_publication_events where article_id=fixture_id)<>1 then
    raise exception 'Replay duplicated editorial history';
  end if;

  update public.blog_posts set title='Newer private fixture version' where id=fixture_id
  returning updated_at into newer_version;
  begin
    perform public.sync_blog_editorial_records(fixture_id,newer_version,null,'draft',
      '[{"url":"https://example.com/replacement","title":"Replacement","publisher":"Example"}]',
      '[{"href":"/invalid","anchor_text":"Invalid","link_type":"invalid"}]');
    raise exception 'An invalid link was accepted';
  exception when check_violation then null;
  end;
  if not exists(select 1 from public.blog_sources where article_id=fixture_id and url='https://example.com/source')
     or not exists(select 1 from public.blog_links where article_id=fixture_id and href='/blog/fixture')
     or (select count(*) from public.blog_revisions where article_id=fixture_id)<>1 then
    raise exception 'A failed replacement removed prior evidence or added history';
  end if;
  begin
    perform public.sync_blog_editorial_records(fixture_id,saved_version,null,'draft',source_rows,link_rows);
    raise exception 'A stale article version was accepted';
  exception when raise_exception then
    if sqlerrm<>'BLOG_POST_EDIT_CONFLICT' then raise; end if;
  end;
  if has_function_privilege('anon','public.sync_blog_editorial_records(uuid,timestamptz,uuid,text,jsonb,jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.sync_blog_editorial_records(uuid,timestamptz,uuid,text,jsonb,jsonb)','EXECUTE')
     or not has_function_privilege('service_role','public.sync_blog_editorial_records(uuid,timestamptz,uuid,text,jsonb,jsonb)','EXECUTE') then
    raise exception 'Editorial synchronization privilege boundary failed';
  end if;
end $$;
rollback;
