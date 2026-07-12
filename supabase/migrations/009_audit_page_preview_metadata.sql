-- Compact audited-site previews use collected metadata and never require iframe embedding.
-- Empty strings preserve compatibility with existing audit rows and clients.

alter table public.audit_pages
  add column if not exists canonical_url text not null default '',
  add column if not exists site_name text not null default '',
  add column if not exists favicon_url text not null default '',
  add column if not exists open_graph_image text not null default '',
  add column if not exists theme_color text not null default '',
  add column if not exists screenshot_url text not null default '';

comment on column public.audit_pages.screenshot_url is
  'Optional genuine screenshot URL. Empty unless a trusted screenshot pipeline supplied an actual capture.';

comment on column public.audit_pages.open_graph_image is
  'Resolved public og:image URL collected from the audited page metadata.';
