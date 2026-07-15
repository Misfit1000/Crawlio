# Crawlio rebrand compatibility

The public product name is **Crawlio**. The previous public name was **SEOIntel**.

## Stable identifiers retained

The rebrand does not rename deployed database tables, columns, functions, policies, storage buckets, audit IDs, report IDs, article IDs, or environment secrets. Migrations 001-016 remain immutable historical records.

The application reads these legacy browser and request identifiers temporarily so existing sessions and saved workspace state continue to work:

- `X-SEOIntel-Guest-Id` and `seointel_guest_id`
- legacy theme, report-selection, audit-history, checklist, note, preference, and activity-layout local-storage keys
- `SEOINTEL_ALLOW_PRIVATE_TEST_TARGETS` and `SEOINTEL_E2E_TSX_LOADED`, which are local-test-only flags
- the `seointelbot` robots token, accepted alongside the current `crawliobot` token

New browser writes and requests use Crawlio identifiers. The compatibility reads can be removed only after a documented deprecation period.

## External names retained

- Current production URL: `https://keywordsintel.vercel.app`
- Current Render service and health URL: `seointel-audit-worker` and `https://seointel-audit-worker.onrender.com/health`
- Vercel project: `crawlio`, renamed in place while retaining the existing production alias
- GitHub repository: `https://github.com/Misfit1000/Crawlio`

The retained domain and Render service name are functional deployment identifiers, not public product copy. Do not replace them with an unconfigured Crawlio domain or service URL.

Vercel still reports Node.js 24.x in Project Settings even though repository and deployed function contracts require Node.js 22. Change the dashboard setting to 22.x separately and verify a redeployment.

## Stored display data

Migration `017_crawlio_display_brand.sql` updates only known legacy values in `platform_settings.platform_name`. It does not alter customer content, audit evidence, blog sources, or historical migrations.
