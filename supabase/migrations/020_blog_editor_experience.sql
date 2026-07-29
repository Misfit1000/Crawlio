-- Low-effort Blog Studio: isolated editor buffers and administrator notifications.
begin;

create table if not exists public.blog_editor_drafts (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.user_profiles(id) on delete cascade,
  article_id uuid null references public.blog_posts(id) on delete cascade,
  client_draft_id text not null check (char_length(client_draft_id) between 8 and 120),
  payload jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version between 1 and 2147483647),
  base_post_updated_at timestamptz null,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (admin_user_id, client_draft_id)
);

create unique index if not exists blog_editor_drafts_article_admin_idx
  on public.blog_editor_drafts (admin_user_id, article_id)
  where article_id is not null;
create index if not exists blog_editor_drafts_expiry_idx
  on public.blog_editor_drafts (expires_at);

drop trigger if exists blog_editor_drafts_set_updated_at on public.blog_editor_drafts;
create trigger blog_editor_drafts_set_updated_at
before update on public.blog_editor_drafts
for each row execute function public.set_updated_at();

alter table public.blog_editor_drafts enable row level security;
revoke all on public.blog_editor_drafts from anon, authenticated;
-- No browser policies: only the server-side service role may read or write editor buffers.

create table if not exists public.blog_admin_notifications (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.user_profiles(id) on delete cascade,
  notification_type text not null check (notification_type in ('blog_published', 'blog_needs_attention', 'blog_failed')),
  title text not null check (char_length(title) between 1 and 160),
  message text not null default '' check (char_length(message) <= 500),
  article_id uuid null references public.blog_posts(id) on delete cascade,
  job_id uuid null references public.blog_generation_jobs(id) on delete cascade,
  link_path text not null default '/admin' check (char_length(link_path) between 1 and 300),
  read_at timestamptz null,
  expires_at timestamptz not null default (now() + interval '90 days'),
  created_at timestamptz not null default now()
);

create unique index if not exists blog_admin_notifications_job_type_idx
  on public.blog_admin_notifications (admin_user_id, job_id, notification_type);
create index if not exists blog_admin_notifications_inbox_idx
  on public.blog_admin_notifications (admin_user_id, read_at, created_at desc);
create index if not exists blog_admin_notifications_expiry_idx
  on public.blog_admin_notifications (expires_at);

alter table public.blog_admin_notifications enable row level security;
revoke all on public.blog_admin_notifications from anon, authenticated;
-- No browser policies: authenticated administrators use protected API routes.

commit;

-- Verification:
-- select tablename, rowsecurity from pg_tables where schemaname = 'public'
--   and tablename in ('blog_editor_drafts', 'blog_admin_notifications');
-- select count(*) from pg_policies where schemaname = 'public'
--   and tablename in ('blog_editor_drafts', 'blog_admin_notifications');
