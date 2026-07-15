# Crawlio Plans And Limits

## Free Lightweight Audit

- Quick Audit only.
- 5 pages per audit.
- Low concurrency and short fetch timeout.
- Basic SEO checks for title, meta description, headings, canonical/noindex, sitemap/robots basics, internal link discovery, and image alt basics.
- Passive security checks for HTTPS, HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, and insecure forms.
- JSON export only.

## Paid Standard Audit

- Quick and Standard audits.
- Up to 25 pages.
- Higher queue priority than Free.
- Full standard SEO categories: technical SEO, crawlability, indexability, schema, image SEO, links, sitemap/robots, performance basics, and passive security.
- Structured PDF reports are enabled. They contain stored audit scores, charts, top fixes, page summaries, metadata previews, and audit activity without rerunning the audit.

## Agency Deep Audit

- Quick, Standard, and Deep audits.
- Up to 75 pages when `DEEP_AUDIT_ENABLED=true`.
- Highest customer queue priority.
- White-label, embed, API, and scheduled audit flags are enabled in plan limits.

## Admin

- Admin users can manage users, plans, audits, queue, workers, and safe platform settings.
- Admin users get generous limits and priority `999`.

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
