# Blog Automation Setup

SEOIntel includes a public blog, an administrator content workspace, deterministic publication gates, and an optional worker-backed NVIDIA NIM drafting pipeline. Published articles are public. Drafts, previews, failed jobs, and scheduled articles before their release time remain private and `noindex`.

## Apply The Database Migration

1. Apply every migration in `supabase/migrations/` in numeric order.
2. Existing installations apply `012_blog_automation_platform.sql` after `011_production_robustness.sql`.
3. Confirm the migration creates the generation, trend, source, quality, link, image, revision, publication, settings, and topic-hub tables.
4. Confirm Row Level Security is enabled on every new table.
5. Confirm the `blog-images` Storage bucket exists, public reads are allowed, and writes remain administrator/service-role only.
6. Run the verification queries at the bottom of migration 012.

Never edit or rerun an earlier migration to add these fields. Migration 012 preserves existing posts and gives unpublished content safe `noindex,nofollow` defaults.

## Configure Vercel

Vercel serves the Vite application, lightweight authenticated queue endpoints, complete article HTML, sitemap XML, news sitemap XML, and RSS. It does not call NVIDIA or run discovery loops.

Set:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BLOG_SCHEDULER_SECRET` only when an external scheduler will call the fallback scheduler endpoint

Do not set `NVIDIA_API_KEY` or any `VITE_NVIDIA_*` variable on Vercel. The Supabase service-role key remains server-only and must never use a `VITE_` prefix.

## Configure The Existing Render Worker

The audit worker can process blog jobs while the audit queue is idle, avoiding a second service.

Set on the Render worker:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BLOG_AUTOMATION_ENABLED=true`
- `NVIDIA_API_KEY`
- `NVIDIA_API_BASE_URL=https://integrate.api.nvidia.com/v1`
- `NVIDIA_BLOG_MODEL=qwen/qwen3.5-122b-a10b`
- `NVIDIA_BLOG_ENABLED=false` until connectivity is verified

Keep the existing start command:

```bash
npm run worker:audit
```

For an isolated worker, use `npm run worker:blog`, but do not run both modes against the same queue unless that extra capacity is intentional. Claims use leases and bounded retries.

## Configure Autopilot

1. Sign in as an administrator and open `/admin/blog`.
2. In **Autopilot settings**, add only approved public HTTPS RSS or Atom feeds.
3. Set the IANA timezone and publication window.
4. Keep **Require editorial review** enabled until the source and quality workflow has been verified in production.
5. Enable automatic discovery.

The worker checks for a discovery bucket once per minute and creates at most one discovery job per six-hour bucket. A discovery can select zero, one, or two distinct high-priority opportunities. Manual, custom-headline, and batch jobs do not consume automatic quotas.

## Publication Gates

An article cannot be scheduled or published until all critical checks pass:

- an article-type-aware editorial range without filler or a universal 1,500-word minimum
- one renderer-supplied H1 and logical H2/H3 structure
- a non-repetitive tagline and complete metadata
- recorded, verified sources represented by crawlable hyperlinks
- at least two crawlable internal links
- originality and close-paraphrase checks
- safe image validation, or an explicit no-image decision
- complete initial HTML with canonical, robots, Open Graph, and JSON-LD metadata

Failures move work to review or failed state. They never create a partial public article.

## Public Discovery Checks

After publishing a reviewed test article, verify:

- `/blog`
- `/blog/{slug}` returns complete article HTML in View Source
- `/sitemap.xml`
- `/news-sitemap.xml`
- `/rss.xml`
- canonical, robots, Open Graph, Article JSON-LD, and Breadcrumb JSON-LD

Only public, canonical, indexable articles appear in discovery files. Sitemap inclusion does not guarantee search-engine indexing or rankings.

## Safe Images

Use the admin image URL importer rather than pasting an arbitrary image URL into a published post. The importer applies DNS and redirect checks, blocks private networks, rejects SVG, limits files to 5 MB, verifies raster signatures, checks dimensions, records licence and attribution, stores the original, and creates bounded WebP and AVIF variants without upscaling.
