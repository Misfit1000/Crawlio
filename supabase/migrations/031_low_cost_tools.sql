begin;
-- Bounded facts from the already-fetched page, not full HTML or arbitrary headers.
alter table public.audit_pages add column if not exists tool_evidence jsonb;
alter table public.audit_pages drop constraint if exists audit_pages_tool_evidence_bound;
alter table public.audit_pages add constraint audit_pages_tool_evidence_bound
  check (tool_evidence is null or (jsonb_typeof(tool_evidence) = 'object' and octet_length(tool_evidence::text) <= 4096));
alter table public.audit_export_jobs drop constraint if exists audit_export_jobs_format_check;
alter table public.audit_export_jobs add constraint audit_export_jobs_format_check
  check (format in ('json','pages.csv','issues.csv','sitemap.xml'));
-- Keep the raw robots document out of hot crawl-run responses and heartbeat payloads.
create table if not exists public.audit_tool_documents (
  audit_id uuid primary key references public.audits(id) on delete cascade,
  robots jsonb not null check (jsonb_typeof(robots) = 'object' and octet_length(robots::text) <= 800000),
  updated_at timestamptz not null default now()
);
alter table public.audit_tool_documents enable row level security;
revoke all on public.audit_tool_documents from public, anon, authenticated;
grant all on public.audit_tool_documents to service_role;
create or replace function public.retain_audit_tool_document()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.metadata ? 'robotsEvidence' then
    insert into public.audit_tool_documents(audit_id,robots)
      values(new.audit_id,new.metadata->'robotsEvidence')
      on conflict(audit_id) do update set robots=excluded.robots,updated_at=now();
    new.metadata = new.metadata - 'robotsEvidence';
  end if;
  return new;
end $$;
revoke all on function public.retain_audit_tool_document() from public, anon, authenticated;
grant execute on function public.retain_audit_tool_document() to service_role;
drop trigger if exists retain_audit_tool_document on public.audit_crawl_runs;
create trigger retain_audit_tool_document before insert or update of metadata on public.audit_crawl_runs
  for each row execute function public.retain_audit_tool_document();
comment on column public.audit_pages.tool_evidence is 'Versioned bounded metadata for local tools; unknown on legacy audits. Existing page ownership RLS applies.';
-- Existing page RLS, server-only export jobs, leases and private storage remain unchanged.
notify pgrst, 'reload schema';
commit;
