-- Owner-scoped audit history and deterministic comparison query support.
-- Comparison remains computed by the API so no public cross-owner view is exposed.

create index if not exists audits_user_created_at_idx
  on public.audits (user_id, created_at desc)
  where user_id is not null;

create index if not exists audits_user_hostname_created_at_idx
  on public.audits (user_id, hostname, created_at desc)
  where user_id is not null;

create index if not exists audits_user_status_created_at_idx
  on public.audits (user_id, status, created_at desc)
  where user_id is not null;

create index if not exists audit_issues_comparison_key_idx
  on public.audit_issues (audit_id, category, title, affected_url);

comment on index public.audits_user_created_at_idx is
  'Supports authenticated audit history ordered by newest run.';

comment on index public.audit_issues_comparison_key_idx is
  'Supports API-side new, resolved, and persistent issue comparison.';
