begin;

-- Built-in hashing works regardless of the schema hosting pgcrypto.
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
    values(new.id,encode(sha256(convert_to('page:'||new.normalized_url,'UTF8')),'hex'),new.normalized_url,'page',0);
    update public.audit_crawl_runs set discovered=1 where audit_id=new.id;
  end if;
  return new;
end $$;

commit;
