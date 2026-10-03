begin;

-- Each bounded probe uses audit_crawl_frontier_pending (audit_id,kind,depth,key).
-- Read only: claims, generation fencing and checkpoints remain in the existing RPCs.
create or replace function public.read_scalable_audit_frontier(p_audit uuid, p_limit integer default 2)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  batch jsonb;
  stage text;
  batch_limit integer := least(2, greatest(0, coalesce(p_limit, 2)));
begin
  if batch_limit = 0 then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(to_jsonb(item) order by item.depth,item.key), '[]'::jsonb) into batch
  from (
    select f.key,f.url,f.kind,f.depth,f.source_url,f.anchor,f.attempts,f.next_attempt_at,f.discovery_offset
    from public.audit_crawl_frontier f
    where f.audit_id=p_audit and f.state='pending' and f.kind='robots'
    order by f.depth,f.key limit batch_limit
  ) item;
  if jsonb_array_length(batch)>0 then
    -- Pending robots gate every other kind, including while backing off a retry.
    return (select coalesce(jsonb_agg(item.value order by item.position), '[]'::jsonb)
      from jsonb_array_elements(batch) with ordinality item(value,position)
      where (item.value->>'next_attempt_at')::timestamptz<=now());
  end if;
  foreach stage in array array['root','sitemap','page'] loop
    select coalesce(jsonb_agg(to_jsonb(item) order by item.depth,item.key), '[]'::jsonb) into batch
    from (
      select f.key,f.url,f.kind,f.depth,f.source_url,f.anchor,f.attempts,f.next_attempt_at,f.discovery_offset
      from public.audit_crawl_frontier f
      where f.audit_id=p_audit and f.state='pending'
        and f.kind=case when stage='root' then 'page' else stage end
        and (stage<>'root' or f.depth=0) and f.next_attempt_at<=now()
      order by f.depth,f.key limit batch_limit
    ) item;
    if jsonb_array_length(batch)>0 then return batch; end if;
  end loop;
  return '[]'::jsonb;
end $$;

revoke all on function public.read_scalable_audit_frontier(uuid,integer) from public,anon,authenticated;
grant execute on function public.read_scalable_audit_frontier(uuid,integer) to service_role;
notify pgrst,'reload schema';
commit;
