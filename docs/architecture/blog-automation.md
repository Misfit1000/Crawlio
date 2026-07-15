# Blog Automation Architecture

## Runtime Boundaries

- **Browser:** administrator forms and public reading only. It receives no provider or service-role secret.
- **Vercel API:** authentication, validation, rate limits, idempotent job creation, editorial CRUD, static article HTML, sitemap, news sitemap, and RSS.
- **Supabase:** posts, jobs, discoveries, source records, quality results, links, images, revisions, publication events, settings, and leases.
- **Render worker:** approved-feed discovery, freshness selection, provider generation, quality and originality checks, scheduling, and due publication.

No provider call, feed loop, competitor fetch loop, or article generation runs inside a Vercel request.

## Freshness And Selection

A source is high priority only when it was published or materially updated inside 48 hours, is relevant to Crawlio's audience, and is authoritative or primary. Seven-day material can remain medium priority. Older material is low priority unless an evidenced continuing rollout is still active.

Selection is deterministic and chooses at most two opportunities with distinct topic clusters and search intents. Existing coverage, stale items, weak novelty, and insufficient evidence are skipped. The system never generates filler to reach a quota.

## Origins And Quotas

Every post and job stores an origin. `autopilot` and `trend_autopilot` count against automatic daily and weekly quotas. `admin_manual`, `admin_custom_headline`, `admin_batch`, and `scheduled_manual` are counted separately. `editor_update` is an update, not a new automatic article.

## Job Safety

Job idempotency keys are unique. Claims use `FOR UPDATE SKIP LOCKED`, a bounded lease, and a maximum attempt count. Scheduler transitions update only rows still in `scheduled` state, making repeated invocations safe. Each batch headline creates an independent job.

The default urgent-content setting is hold-for-review. Automatic scheduling is possible only when every deterministic publication gate passes and the administrator explicitly disables that hold.

## Content Honesty

The system does not claim rankings, indexing, traffic, backlinks, or search volume. Competitor work is limited to content-gap observations and may not copy wording, examples, paragraph order, or heading structure. Groq drafts run through bounded Vercel stages, must cite supplied sources through standard hyperlinks, and are rejected when critical quality checks fail. Article-length ranges depend on content type and never justify filler.
