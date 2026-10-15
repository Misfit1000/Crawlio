begin;
alter table public.site_preview_captures add column if not exists visible_requested_at timestamptz;

create or replace function public.request_visible_audit_preview(p_audit uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare capture jsonb;
begin
  capture=public.request_audit_preview(p_audit);
  if capture->>'status'='queued' then
    update public.site_preview_captures set visible_requested_at=now()
      where id=(capture->>'id')::uuid and (visible_requested_at is null or visible_requested_at<now()-interval '10 minutes');
  end if;
  return capture;
end $$;

-- Retain the original claim RPC for rollback. Both paths share its global lease and budget lock.
create or replace function public.claim_site_preview_prioritized(p_worker text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare capture public.site_preview_captures%rowtype; expired public.site_preview_captures%rowtype; usage public.preview_daily_usage%rowtype;
  today date:=(now() at time zone 'UTC')::date;
begin
  if p_worker is null or length(p_worker) not between 1 and 100 then raise exception 'INVALID_PREVIEW_WORKER'; end if;
  perform pg_advisory_xact_lock(hashtext('site-preview-budget'));
  for expired in select * from public.site_preview_captures where status='running' and lease_until<now() for update loop
    update public.preview_daily_usage set reserved_ms=greatest(0,reserved_ms-20000),consumed_ms=consumed_ms+20000 where usage_day=expired.reserved_day;
    update public.site_preview_captures set status=case when attempts<2 then 'queued' else 'unavailable' end,
      retry_at=now()+interval '15 minutes',lease_until=null,failure_code='CAPTURE_INTERRUPTED',updated_at=now() where id=expired.id;
  end loop;
  if exists(select 1 from public.site_preview_captures where status='running' and lease_until>now()) then return null; end if;
  if (select coalesce(sum(desktop_bytes+mobile_bytes),0) from public.site_preview_captures)+819200>104857600 then return null; end if;
  select * into capture from public.site_preview_captures where status='queued' and retry_at<=now()
    order by retry_at-case when visible_requested_at>now()-interval '30 minutes' then interval '10 minutes' else interval '0' end,created_at,id
    for update skip locked limit 1;
  if not found then return null; end if;
  insert into public.preview_daily_usage(usage_day) values(today) on conflict do nothing;
  select * into usage from public.preview_daily_usage where usage_day=today for update;
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

revoke all on function public.request_visible_audit_preview(uuid),public.claim_site_preview_prioritized(text) from public,anon,authenticated;
grant execute on function public.request_visible_audit_preview(uuid),public.claim_site_preview_prioritized(text) to service_role;
notify pgrst,'reload schema';
commit;
