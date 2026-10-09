begin;

-- Additive entry points: old workers keep their original claim/commit contracts.
create or replace function public.claim_efficient_scoped_audit(p_worker text,p_deep boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; v_audit uuid; groups jsonb;
begin
  result=public.claim_scoped_audit(p_worker,p_deep);
  if result is null then return null; end if;
  v_audit=(result->'run'->>'audit_id')::uuid;
  select coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) into groups from (
    select key,category,title,severity,affected_pages from public.audit_score_groups
    where audit_id=v_audit order by key limit 1000
  ) g;
  if jsonb_array_length(groups)>=1000 then raise exception 'Scoring group bound reached'; end if;
  return result||jsonb_build_object('scoreGroups',groups,'pending',exists(
    select 1 from public.audit_crawl_frontier where audit_id=v_audit and state='pending'));
end $$;

create or replace function public.scalable_audit_commit_efficient(p_audit uuid,p_worker text,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; groups jsonb;
begin
  result=public.scalable_audit_commit(p_audit,p_worker,p_generation,p_payload);
  -- Read authoritative rows, including unchanged rows after an idempotent retry.
  select coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) into groups from (
    select key,category,title,severity,affected_pages from public.audit_score_groups
    where audit_id=p_audit and key in (
      select grp->>'key' from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) item
      cross join lateral jsonb_array_elements(coalesce(item->'groups','[]'::jsonb)) grp
    ) order by key
  ) g;
  return jsonb_build_object('run',result,'scoreGroups',groups,'pending',exists(
    select 1 from public.audit_crawl_frontier where audit_id=p_audit and state='pending'));
end $$;

create or replace function public.renew_scalable_audit_lease(p_audit uuid,p_worker text,p_generation bigint,p_rss bigint default 0)
returns boolean language plpgsql security definer set search_path=public as $$
declare r public.audit_crawl_runs; a public.audits;
begin
  select * into r from public.audit_crawl_runs where audit_id=p_audit for update;
  select * into a from public.audits where id=p_audit for update;
  if r.owner is distinct from p_worker or r.generation is distinct from p_generation
    or r.lease_until is null or r.lease_until<=now() or a.status not in ('queued','running') then raise exception 'AUDIT_OWNERSHIP_LOST'; end if;
  update public.audit_crawl_runs set lease_until=now()+interval '120 seconds',
    peak_rss_bytes=greatest(peak_rss_bytes,greatest(0,p_rss)) where audit_id=p_audit;
  return true;
end $$;

revoke all on function public.claim_efficient_scoped_audit(text,boolean),
  public.scalable_audit_commit_efficient(uuid,text,bigint,jsonb),
  public.renew_scalable_audit_lease(uuid,text,bigint,bigint) from public,anon,authenticated;
grant execute on function public.claim_efficient_scoped_audit(text,boolean),
  public.scalable_audit_commit_efficient(uuid,text,bigint,jsonb),
  public.renew_scalable_audit_lease(uuid,text,bigint,bigint) to service_role;

notify pgrst,'reload schema';
commit;
