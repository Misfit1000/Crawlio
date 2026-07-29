# Blog automation setup

Apply every Supabase migration in numeric order through 020. Migration 020 adds private editor recovery drafts and in-app administrator notifications. Both tables are service-role-only and have no browser policies.

Vercel serves the Vite application, protected blog APIs, bounded workflow stages, source/feed processing, publication, complete article HTML, sitemap, news sitemap, and RSS. Configure the server variables in `docs/deployment/vercel-blog-environment.md`. Never use a `VITE_` prefix for Groq, service-role, dispatcher, or cron secrets.

Render runs audits only. Configure the variables in `docs/deployment/render-audit-environment.md`; do not add blog or provider settings. Keep `GROQ_BLOG_ENABLED=false` and `BLOG_AUTOMATION_ENABLED=false` for the first Vercel deploy. Test Groq, process one unpublished draft through every stage, verify section revision and discovery output, then enable automation while review-first mode remains active.

Publication requires valid source, originality, metadata, link, image/no-image, quality, and initial-HTML gates. Published public responses include canonical, robots, Open Graph, Article JSON-LD, Breadcrumb JSON-LD, related links, and responsive images. Drafts, previews, fixtures, and scheduled posts before release remain private and noindex.

## Low-effort Blog Studio

The Blog studio starts with three workflows:

1. **Publish latest SEO update** selects a current authoritative feed item that is not already covered. It writes, cites, validates, and publishes only when every critical gate passes.
2. **Create from a source** accepts one public HTTP or HTTPS source URL. Crawlio validates the destination, extracts available source metadata, and runs the same guarded publishing workflow.
3. **Write manually** uses Write, Review, and Publish steps. Title and article content stay prominent; generated search fields, sources, images, scheduling, and canonical controls remain available under Advanced options.

AI jobs that fail a publication gate are saved privately as Needs attention. They are never published by bypassing source, claim, originality, link, or rendering checks. The Blog studio inbox reports published, needs-attention, and terminal-failure outcomes without adding email or webhook dependencies.

Manual drafts are copied to browser storage immediately and saved to the server after three idle seconds, with writes capped to once per fifteen seconds. Published articles use an isolated editor buffer and only change publicly after Republish. A stale browser tab receives a conflict response instead of overwriting a newer article.
