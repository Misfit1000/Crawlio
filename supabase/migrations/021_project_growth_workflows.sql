begin;

alter table public.projects
  add column if not exists normalized_url text null,
  add column if not exists hostname text null,
  add column if not exists audit_frequency text not null default 'manual',
  add column if not exists audit_mode text not null default 'quick',
  add column if not exists next_audit_at timestamptz null,
  add column if not exists last_audit_at timestamptz null,
  add column if not exists last_audit_id uuid null references public.audits(id) on delete set null,
  add column if not exists change_alerts_enabled boolean not null default true,
  add column if not exists notification_preferences jsonb not null default '{"scoreDrop":true,"newCritical":true,"auditFailed":true}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_audit_frequency_check') then
    alter table public.projects add constraint projects_audit_frequency_check
      check (audit_frequency in ('manual', 'weekly', 'monthly'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_audit_mode_check') then
    alter table public.projects add constraint projects_audit_mode_check
      check (audit_mode in ('quick', 'standard', 'deep'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_url_shape_check') then
    alter table public.projects add constraint projects_url_shape_check
      check (
        (normalized_url is null and hostname is null)
        or (
          normalized_url ~ '^https?://'
          and char_length(normalized_url) <= 2048
          and hostname is not null
          and char_length(hostname) between 1 and 253
        )
      );
  end if;
end $$;

create unique index if not exists projects_owner_hostname_unique_idx
  on public.projects (user_id, hostname);
create index if not exists projects_due_audit_idx
  on public.projects (next_audit_at) where audit_frequency <> 'manual' and next_audit_at is not null;

create or replace function public.protect_project_managed_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if tg_op = 'INSERT' and (
      new.normalized_url is not null
      or new.hostname is not null
      or new.audit_frequency <> 'manual'
      or new.audit_mode <> 'quick'
      or new.next_audit_at is not null
      or new.last_audit_at is not null
      or new.last_audit_id is not null
      or new.change_alerts_enabled is not true
      or new.notification_preferences <> '{"scoreDrop":true,"newCritical":true,"auditFailed":true}'::jsonb
    ) then
      raise exception 'Project audit settings must be created through the server API';
    elsif tg_op = 'UPDATE' and (
      new.normalized_url is distinct from old.normalized_url
      or new.hostname is distinct from old.hostname
      or new.audit_frequency is distinct from old.audit_frequency
      or new.audit_mode is distinct from old.audit_mode
      or new.next_audit_at is distinct from old.next_audit_at
      or new.last_audit_at is distinct from old.last_audit_at
      or new.last_audit_id is distinct from old.last_audit_id
      or new.change_alerts_enabled is distinct from old.change_alerts_enabled
      or new.notification_preferences is distinct from old.notification_preferences
    ) then
      raise exception 'Project audit settings must be changed through the server API';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_project_managed_fields on public.projects;
create trigger protect_project_managed_fields
before insert or update on public.projects
for each row execute function public.protect_project_managed_fields();

create table if not exists public.project_notifications (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('audit_completed', 'audit_failed', 'score_drop', 'new_critical', 'schedule_paused')),
  title text not null check (char_length(title) between 1 and 160),
  message text not null check (char_length(message) between 1 and 600),
  audit_id uuid null references public.audits(id) on delete set null,
  read_at timestamptz null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '180 days')
);

create index if not exists project_notifications_owner_unread_idx
  on public.project_notifications (user_id, created_at desc) where read_at is null;
create index if not exists project_notifications_expiry_idx
  on public.project_notifications (expires_at);
create unique index if not exists project_notifications_audit_kind_unique_idx
  on public.project_notifications (project_id, audit_id, kind) where audit_id is not null;

alter table public.project_notifications enable row level security;
create policy "users can read own project notifications"
on public.project_notifications for select to authenticated
using (user_id = auth.uid());
revoke insert, delete on public.project_notifications from anon, authenticated;
revoke update on public.project_notifications from anon, authenticated;

create table if not exists public.report_shares (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits(id) on delete cascade,
  project_id uuid null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  last_viewed_at timestamptz null,
  view_count integer not null default 0 check (view_count >= 0)
);

create index if not exists report_shares_owner_idx on public.report_shares (user_id, created_at desc);
create index if not exists report_shares_active_idx on public.report_shares (token_hash, expires_at) where revoked_at is null;
alter table public.report_shares enable row level security;
-- No browser policies. Share creation and public projection are controlled by server APIs.
revoke all on public.report_shares from anon, authenticated;

create table if not exists public.search_console_oauth_states (
  state_hash text primary key check (char_length(state_hash) = 64),
  user_id uuid not null references auth.users(id) on delete cascade,
  redirect_path text not null default '/app/search-data' check (char_length(redirect_path) <= 200),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz null
);

create table if not exists public.search_console_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_subject text null,
  account_email text null,
  encrypted_access_token text not null,
  encrypted_refresh_token text null,
  token_expires_at timestamptz null,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider_subject)
);

create table if not exists public.search_console_properties (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.search_console_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  site_url text not null check (char_length(site_url) between 1 and 2048),
  permission_level text null,
  last_synced_at timestamptz null,
  last_sync_status text not null default 'never' check (last_sync_status in ('never', 'syncing', 'ready', 'failed')),
  last_sync_error text null check (last_sync_error is null or char_length(last_sync_error) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, site_url)
);

create table if not exists public.search_console_rows (
  id bigint generated always as identity primary key,
  property_id uuid not null references public.search_console_properties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  period text not null check (period in ('current', 'previous')),
  data_date date not null,
  query text not null default '' check (char_length(query) <= 1000),
  page text not null default '' check (char_length(page) <= 2048),
  device text not null default '' check (char_length(device) <= 32),
  clicks numeric not null default 0,
  impressions numeric not null default 0,
  ctr numeric not null default 0,
  position numeric not null default 0,
  imported_at timestamptz not null default now()
);

create index if not exists search_console_rows_property_period_idx
  on public.search_console_rows (property_id, period, impressions desc);
create index if not exists search_console_rows_owner_date_idx
  on public.search_console_rows (user_id, data_date desc);
create index if not exists search_console_oauth_states_expiry_idx
  on public.search_console_oauth_states (expires_at);

alter table public.search_console_oauth_states enable row level security;
alter table public.search_console_accounts enable row level security;
alter table public.search_console_properties enable row level security;
alter table public.search_console_rows enable row level security;
-- OAuth credentials and imported rows are exposed only through owner-checked server APIs.
revoke all on public.search_console_oauth_states from anon, authenticated;
revoke all on public.search_console_accounts from anon, authenticated;
revoke all on public.search_console_properties from anon, authenticated;
revoke all on public.search_console_rows from anon, authenticated;

commit;
