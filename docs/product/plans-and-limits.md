# Crawlio Plans And Limits

## Dynamic Audit Modes

The `plan_limits` table is the source of truth for each plan's enabled modes and page allowances. The audit form, public pricing, admission API, and worker all use the same values. Administrators can enable Quick, Standard, or Deep independently within the currently supported ceilings: 50 Quick pages, 50 Standard pages, and 100 Deep pages. Unsupported values are rejected rather than advertised and silently reduced.

Deep audits also require `DEEP_AUDIT_ENABLED=true` on both the API and dedicated worker. A configured but unavailable Deep mode is shown as temporarily unavailable.

## Free Lightweight Audit

- Quick Audit only.
- 5 pages per audit.
- Low concurrency and short fetch timeout.
- Basic SEO checks for title, meta description, headings, canonical/noindex, sitemap/robots basics, internal link discovery, and image alt basics.
- Passive security checks for HTTPS, HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, and insecure forms.
- JSON export only.

## Plus Standard Audit

- Quick and Standard audits.
- Up to 50 successfully analysed pages. The worker continues through safe replacement candidates when a discovered URL fails or is blocked.
- Smaller sites and sites that block crawling can finish below 50 pages; reports show the exact discovered, attempted, analysed, failed, and blocked coverage instead of claiming pages that were not checked.
- Higher queue priority than Free.
- Full standard SEO categories: technical SEO, crawlability, indexability, schema, image SEO, links, sitemap/robots, performance basics, and passive security.
- Structured PDF reports are enabled. They contain stored audit scores, charts, top fixes, page summaries, metadata previews, and audit activity without rerunning the audit.

## Agency Deep Audit

- Quick, Standard, and Deep audits.
- Up to 75 pages when `DEEP_AUDIT_ENABLED=true`.
- Highest customer queue priority.
- White-label, embed, API, and scheduled audit flags are enabled in plan limits.

## Admin

- Admin users can manage users, enabled audit modes, plan limits, audits, queue, workers, and safe platform settings.
- Admin users get generous limits and priority `999`.

## Large Sites

Crawlio does not currently promise 1,000-page audits. The production-safe ceiling is 100 pages for Deep audits. Supporting 1,000 pages or more requires resumable crawl segments, a durable URL frontier, paginated report storage, and verified always-on worker capacity; changing only a plan value is not sufficient.

## Priority Queue

Audits are claimed by highest `queue_priority` first and oldest `created_at` second:

- Admin: 999
- Agency: 100
- Paid: 50
- Free: 10

## Quotas

Server-side entitlement checks enforce daily/monthly audit quota before an audit is created. Free users can only have one queued/running audit at a time.

## Locked Features

Locked UI sections should clearly say the feature is available in a paid audit. Crawlio must not fake locked or unavailable data.

## Data Honesty

Crawlio does not fake backlinks, search volume, rankings, traffic, CPC, or domain authority. Those require imported or verified data sources.

## Security Scope

Security checks are passive and non-invasive. Crawlio checks public configuration signals and does not exploit vulnerabilities or perform penetration testing.
