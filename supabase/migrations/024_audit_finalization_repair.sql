begin;

-- Idempotent prerequisite repair for workers deployed before migration 023.
alter table public.audits
  add column if not exists checkpoint_pages_crawled integer not null default 0 check (checkpoint_pages_crawled >= 0),
  add column if not exists checkpoint_updated_at timestamptz null,
  add column if not exists checkpoint_state jsonb null
    check (checkpoint_state is null or (jsonb_typeof(checkpoint_state) = 'object' and octet_length(checkpoint_state::text) <= 262144));

-- Only repair failed finalizations proven by both a stored report and the exact diagnostic.
-- Preserve genuine website failures, active jobs, cancellations, and their diagnostics.
update public.audits a
set status = case when a.warning_count > 0 then 'completed_with_warnings' else 'completed' end,
    progress = 100,
    current_phase = case when a.warning_count > 0 then 'Report ready with warnings' else 'Report ready' end,
    current_url = null,
    current_check = null,
    error = null,
    completed_at = coalesce(a.completed_at, r.generated_at),
    page_limit = (r.scores #>> '{coverage,pageLimit}')::integer,
    checks_total = greatest(a.checks_total, a.checks_completed),
    checkpoint_pages_crawled = a.pages_crawled,
    checkpoint_updated_at = now(),
    checkpoint_state = null,
    locked_by = null,
    locked_at = null,
    lease_expires_at = null,
    updated_at = now()
from public.audit_reports r
where r.audit_id = a.id
  and a.status = 'failed'
  and a.pages_crawled > 0
  and jsonb_typeof(r.scores -> 'overall') = 'number'
  and (r.scores #>> '{coverage,pageLimit}') ~ '^[1-9][0-9]{0,3}$'
  and exists (
    select 1 from public.audit_diagnostics d
    where d.audit_id = a.id and d.phase = 'audit'
      and d.internal_details like '%Update worker-owned audit:%'
      and d.internal_details like '%checkpoint_pages_crawled%'
      and d.internal_details like '%schema cache%'
  );

notify pgrst, 'reload schema';
commit;
