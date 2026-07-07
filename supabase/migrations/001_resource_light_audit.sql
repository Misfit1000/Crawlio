create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.audits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null,
  project_id uuid null,
  submitted_input text not null,
  normalized_url text not null,
  final_url text null,
  hostname text not null,
  mode text not null default 'quick' check (mode in ('quick', 'standard', 'deep')),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  current_phase text not null default 'Queued',
  current_url text null,
  current_check text null,
  page_limit integer not null default 10,
  pages_discovered integer not null default 0,
  pages_crawled integer not null default 0,
  checks_total integer not null default 0,
  checks_completed integer not null default 0,
  issues_found integer not null default 0,
  critical_count integer not null default 0,
  high_count integer not null default 0,
  medium_count integer not null default 0,
  low_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  expires_at timestamptz not null default (now() + interval '30 days'),
  cancelled_at timestamptz null,
  error text null,
  locked_by text null,
  locked_at timestamptz null,
  lease_expires_at timestamptz null,
  used_http_fallback boolean not null default false
);

create table if not exists public.audit_events (
  id text primary key default gen_random_uuid()::text,
  audit_id uuid not null references public.audits(id) on delete cascade,
  type text not null,
  created_at timestamptz not null default now(),
  message text not null default '',
  phase text null,
  current_url text null,
  affected_url text null,
  category text null,
  check_id text null,
  check_title text null,
  severity text null check (severity is null or severity in ('critical', 'high', 'medium', 'low', 'info')),
  progress integer null check (progress is null or (progress >= 0 and progress <= 100)),
  data jsonb null
);

create table if not exists public.audit_pages (
  id text primary key default gen_random_uuid()::text,
  audit_id uuid not null references public.audits(id) on delete cascade,
  url text not null,
  status_code integer not null default 0,
  response_time_ms integer not null default 0,
  page_size_bytes integer not null default 0,
  title text not null default '',
  meta_description text not null default '',
  h1 text not null default '',
  word_count integer not null default 0,
  crawl_depth integer not null default 0,
  issue_count integer not null default 0,
  crawled_at timestamptz not null default now(),
  unique (audit_id, url)
);

create table if not exists public.audit_issues (
  id text primary key default gen_random_uuid()::text,
  audit_id uuid not null references public.audits(id) on delete cascade,
  severity text not null check (severity in ('critical', 'high', 'medium', 'low', 'info')),
  category text not null,
  title text not null,
  description text not null,
  affected_url text not null,
  evidence text not null default '',
  recommendation text not null default '',
  detected_at timestamptz not null default now()
);

create table if not exists public.audit_reports (
  id text primary key default gen_random_uuid()::text,
  audit_id uuid not null unique references public.audits(id) on delete cascade,
  scores jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  top_issues jsonb not null default '[]'::jsonb,
  pages jsonb not null default '[]'::jsonb,
  exports jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now()
);

create index if not exists audits_status_created_at_idx on public.audits (status, created_at);
create index if not exists audits_lease_expires_at_idx on public.audits (lease_expires_at) where status = 'running';
create index if not exists audits_expires_at_idx on public.audits (expires_at);
create index if not exists audit_events_audit_created_at_idx on public.audit_events (audit_id, created_at desc);
create index if not exists audit_pages_audit_crawled_at_idx on public.audit_pages (audit_id, crawled_at desc);
create index if not exists audit_issues_audit_detected_at_idx on public.audit_issues (audit_id, detected_at desc);
create index if not exists audit_issues_audit_severity_idx on public.audit_issues (audit_id, severity);

drop trigger if exists audits_set_updated_at on public.audits;
create trigger audits_set_updated_at
before update on public.audits
for each row execute function public.set_updated_at();

alter table public.audits replica identity full;
alter table public.audit_events replica identity full;
alter table public.audit_pages replica identity full;
alter table public.audit_issues replica identity full;
alter table public.audit_reports replica identity full;

alter publication supabase_realtime add table public.audits;
alter publication supabase_realtime add table public.audit_events;
alter publication supabase_realtime add table public.audit_pages;
alter publication supabase_realtime add table public.audit_issues;
alter publication supabase_realtime add table public.audit_reports;

alter table public.audits enable row level security;
alter table public.audit_events enable row level security;
alter table public.audit_pages enable row level security;
alter table public.audit_issues enable row level security;
alter table public.audit_reports enable row level security;

create policy "audit rows are readable by browser clients"
on public.audits for select
to anon, authenticated
using (true);

create policy "browser clients can enqueue audits only"
on public.audits for insert
to anon, authenticated
with check (
  status = 'queued'
  and progress = 0
  and locked_by is null
  and locked_at is null
  and lease_expires_at is null
);

create policy "audit events are readable by browser clients"
on public.audit_events for select
to anon, authenticated
using (true);

create policy "audit pages are readable by browser clients"
on public.audit_pages for select
to anon, authenticated
using (true);

create policy "audit issues are readable by browser clients"
on public.audit_issues for select
to anon, authenticated
using (true);

create policy "audit reports are readable by browser clients"
on public.audit_reports for select
to anon, authenticated
using (true);

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text null,
  username text null,
  display_name text null,
  full_name text null,
  bio text null,
  photo_url text null,
  plan text not null default 'free',
  role text not null default 'member' check (role in ('admin', 'staff', 'member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.keywords (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid null references public.projects(id) on delete set null,
  term text not null,
  "group" text null,
  search_volume integer not null default 0,
  keyword_difficulty integer not null default 0,
  cpc numeric null,
  intent text null,
  created_at timestamptz not null default now()
);

create table if not exists public.competitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  domain_url text not null,
  niche text null,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_settings (
  id text primary key,
  platform_name text not null default 'SEOIntel Audit',
  support_email text not null default 'support@keywordintelligence.com',
  require_email_verification boolean not null default false,
  public_registration boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;
alter table public.projects enable row level security;
alter table public.keywords enable row level security;
alter table public.competitors enable row level security;
alter table public.platform_settings enable row level security;

create policy "users can read own profile"
on public.user_profiles for select
to authenticated
using (auth.uid() = id);

create policy "users can upsert own profile"
on public.user_profiles for insert
to authenticated
with check (auth.uid() = id);

create policy "users can update own profile"
on public.user_profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "users can manage own projects"
on public.projects for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "users can manage own keywords"
on public.keywords for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "users can manage own competitors"
on public.competitors for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "platform settings are readable"
on public.platform_settings for select
to anon, authenticated
using (true);
