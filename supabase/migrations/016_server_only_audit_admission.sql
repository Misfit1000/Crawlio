-- Make the durable Vercel admission RPC/API the only way to create audit jobs.
-- Direct browser inserts bypass quotas, idempotency, queue limits, and bot controls.

begin;

drop policy if exists "browser clients can enqueue audits only" on public.audits;
drop policy if exists "browser clients can enqueue own audits only" on public.audits;
drop policy if exists "admins can update audits" on public.audits;

revoke insert, update, delete on public.audits from anon, authenticated;

update public.deployment_versions
set api_schema_version = 12,
    updated_at = now()
where component = 'database';

commit;

-- Verification:
-- select policyname, cmd, roles from pg_policies where schemaname = 'public' and tablename = 'audits';
-- select component, api_schema_version from public.deployment_versions where component = 'database';
