# Audit Engine

Vercel starts and reads jobs only. The separate Render Node worker claims queued Supabase rows, refreshes a lease, discovers public pages, runs deterministic SEO checks and passive browser-protection checks, stores summarized evidence, and builds the final report. No crawl loop runs in a Vercel request.

Phases are URL validation, search-access rules, sitemap discovery, page scanning, SEO analysis, passive security analysis, scoring, and report generation. Progress uses phase and observed page state; a plan page maximum is a capacity limit, not a completion denominator.

The worker does not store complete raw HTML. Stored page rows contain URL, response status/time/size, title, description, H1, word count, depth, issue count, and timestamp. Rankings, backlinks, traffic, search volume, Lighthouse scores, and field Core Web Vitals are not produced by the audit engine.

The engine has one canonical scoring path in `src/lib/audit/audit-scoring.ts`. Existing lightweight browser tools are not authoritative audit engines.
