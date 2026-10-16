begin;

-- Repair the missing assignment portion of migration 023 without replaying its
-- older schema metadata, retention functions or unrelated product changes.
alter table public.audit_finding_workflow
  add column if not exists assigned_to uuid null references auth.users(id) on delete set null;

create index if not exists audit_finding_workflow_assignee_due_idx
  on public.audit_finding_workflow (assigned_to, due_at)
  where assigned_to is not null and due_at is not null and status not in ('fixed', 'ignored', 'accepted_risk');

create or replace function public.validate_finding_workflow_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.assigned_to is not null and new.assigned_to <> new.user_id then
    raise exception 'finding workflow can only be assigned to its audit owner';
  end if;
  return new;
end;
$$;

drop trigger if exists audit_finding_workflow_validate_assignment on public.audit_finding_workflow;
create trigger audit_finding_workflow_validate_assignment
before insert or update of assigned_to, user_id on public.audit_finding_workflow
for each row execute function public.validate_finding_workflow_assignment();

revoke all on function public.validate_finding_workflow_assignment() from public, anon, authenticated;

commit;
