-- NVIDIA provider metadata, review-first publishing, calendar revisions, and image variants.
-- Append-only: migrations 001-012 remain unchanged.
begin;

alter table public.blog_generation_jobs alter column provider set default 'nvidia_nim';
alter table public.blog_generation_jobs alter column prompt_version set default 'qwen-blog-v3';
alter table public.blog_generation_jobs add column if not exists generation_stages jsonb not null default '[]'::jsonb;

update public.blog_generation_jobs
set provider = 'nvidia_nim',
    model = 'qwen/qwen3.5-122b-a10b',
    prompt_version = 'qwen-blog-v3'
where state = 'queued' and provider = 'gemini';

alter table public.blog_posts
  add column if not exists recommended_publication_at timestamptz null,
  add column if not exists publication_rule text not null default '',
  add column if not exists publication_urgency text not null default 'normal',
  add column if not exists schedule_version integer not null default 0 check (schedule_version >= 0),
  add column if not exists responsive_images jsonb not null default '[]'::jsonb;

alter table public.blog_competitor_research
  add column if not exists traffic_data_source text not null default '',
  add column if not exists traffic_observed_at timestamptz null;

alter table public.blog_autopilot_settings
  add column if not exists required_reviewed_articles_before_autopublish integer not null default 30 check (required_reviewed_articles_before_autopublish between 30 and 50),
  add column if not exists automatic_articles_reviewed integer not null default 0 check (automatic_articles_reviewed >= 0),
  add column if not exists automatic_articles_approved integer not null default 0 check (automatic_articles_approved >= 0),
  add column if not exists automatic_articles_rejected integer not null default 0 check (automatic_articles_rejected >= 0),
  add column if not exists strict_autopilot_enabled boolean not null default false,
  add column if not exists emergency_pause boolean not null default false,
  add column if not exists pause_all_publication boolean not null default false,
  add column if not exists urgent_news_hold boolean not null default true,
  add column if not exists fixed_publication_minute integer null check (fixed_publication_minute is null or fixed_publication_minute between 0 and 1439),
  add column if not exists blackout_dates date[] not null default '{}',
  add column if not exists maintenance_mode boolean not null default false,
  add column if not exists provider_last_success_at timestamptz null,
  add column if not exists provider_enabled boolean not null default false,
  add column if not exists provider_last_error_code text not null default '',
  add column if not exists provider_last_duration_ms integer null check (provider_last_duration_ms is null or provider_last_duration_ms >= 0),
  add column if not exists provider_live_verification_status text not null default 'not_run';

create table if not exists public.blog_section_revisions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.blog_posts(id) on delete cascade,
  generation_job_id uuid null references public.blog_generation_jobs(id) on delete set null,
  actor_id uuid null references public.user_profiles(id) on delete set null,
  section_key text not null,
  action text not null,
  before_html text not null,
  after_html text not null,
  source_snapshot jsonb not null default '[]'::jsonb,
  validation_results jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz null
);

create index if not exists blog_section_revisions_article_idx on public.blog_section_revisions (article_id, created_at desc);
create unique index if not exists blog_section_revisions_active_idx on public.blog_section_revisions (article_id, section_key) where status = 'pending';

create table if not exists public.blog_image_variants (
  id uuid primary key default gen_random_uuid(),
  image_id uuid not null references public.blog_images(id) on delete cascade,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  format text not null check (format in ('webp','avif','jpeg','png')),
  mime_type text not null,
  file_size integer not null check (file_size > 0),
  storage_path text not null,
  storage_url text not null,
  content_hash text not null,
  processing_status text not null default 'ready' check (processing_status in ('ready','failed','deleted')),
  created_at timestamptz not null default now(),
  unique (image_id, width, format),
  unique (content_hash, width, format)
);

create index if not exists blog_image_variants_image_idx on public.blog_image_variants (image_id, width);

create table if not exists public.blog_provider_health (
  id bigint generated always as identity primary key,
  provider text not null check (provider = 'nvidia_nim'),
  model text not null,
  status text not null,
  safe_error_code text not null default '',
  duration_ms integer null check (duration_ms is null or duration_ms >= 0),
  test_kind text not null default 'admin_test',
  actor_id uuid null references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists blog_provider_health_created_idx on public.blog_provider_health (created_at desc);

alter table public.blog_section_revisions enable row level security;
alter table public.blog_image_variants enable row level security;
alter table public.blog_provider_health enable row level security;

drop policy if exists "admins manage blog section revisions" on public.blog_section_revisions;
create policy "admins manage blog section revisions" on public.blog_section_revisions for all to authenticated
using (public.is_admin_user(auth.uid())) with check (public.is_admin_user(auth.uid()));
drop policy if exists "admins manage blog image variants" on public.blog_image_variants;
create policy "admins manage blog image variants" on public.blog_image_variants for all to authenticated
using (public.is_admin_user(auth.uid())) with check (public.is_admin_user(auth.uid()));
drop policy if exists "public read ready blog image variants" on public.blog_image_variants;
create policy "public read ready blog image variants" on public.blog_image_variants for select to anon, authenticated
using (processing_status = 'ready');
drop policy if exists "admins read blog provider health" on public.blog_provider_health;
create policy "admins read blog provider health" on public.blog_provider_health for select to authenticated
using (public.is_admin_user(auth.uid()));
drop policy if exists "admins insert blog provider health" on public.blog_provider_health;
create policy "admins insert blog provider health" on public.blog_provider_health for insert to authenticated
with check (public.is_admin_user(auth.uid()));

grant select, insert, update, delete on public.blog_section_revisions to authenticated;
grant select, insert, update, delete on public.blog_image_variants to authenticated;
grant select, insert on public.blog_provider_health to authenticated;
grant usage, select on sequence public.blog_provider_health_id_seq to authenticated;

-- Verification after deployment:
-- select provider, model, count(*) from public.blog_generation_jobs group by provider, model;
-- select required_reviewed_articles_before_autopublish, automatic_articles_approved, strict_autopilot_enabled from public.blog_autopilot_settings where id = 'default';
-- select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename in ('blog_section_revisions','blog_image_variants','blog_provider_health');
-- select count(*) from public.blog_posts; -- existing records must remain unchanged
-- Rollback guidance: disable Strict Autopilot, archive pending section revisions, then drop only objects introduced above after exporting their records.

commit;
