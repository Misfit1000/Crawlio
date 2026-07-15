# Audit report experience

Crawlio reports use measured worker output and progressively reveal technical evidence. The authenticated dashboard and report pages must not contain sample scores, rankings, traffic, backlinks, or search-volume values.

## Grade scale

- A: 90-100
- B: 80-89
- C: 70-79
- D: 60-69
- E: 50-59
- F: below 50

The overall and section grades come from the stored final audit report. If a section was not scored by the audit engine, the interface says "Not measured". It does not copy the overall score into the missing section. A pre-report estimate may be calculated from real issue counts, but it must be labelled as an estimate.

## Report order

1. Executive summary and overall grade
2. Final section grades
3. Fix-priority distribution
4. Top grouped recommendations
5. On-page SEO
6. Technical SEO
7. Crawlability and indexing
8. Internal links
9. Performance observations
10. Mobile and usability
11. Passive Security Review
12. Structured data and social metadata
13. Searchable page explorer
14. Exports and raw structured details

Each recommendation explains what happened, why it matters, how to fix it, stored evidence, and affected pages. Repeated page findings are grouped by issue type and ordered by severity and affected-page count.

## Data boundaries

- Response time and page size are observations made during the audit. They are not Core Web Vitals field data.
- Rankings, backlinks, traffic, CPC, search volume, and authority metrics require a real import or connected provider.
- The Passive Security Review checks public HTTPS and browser protection signals only. It does not run attack payloads, port scans, brute force, or exploit attempts.
- Complete raw HTML is not stored or included in report exports.
- Audit status, result, cancellation, and export routes verify the signed-in owner or hashed guest session identity.
- Authenticated owners receive Supabase Realtime updates under owner-scoped RLS. Guest audits use identity-protected HTTP polling so anonymous clients cannot query all guest audit rows directly.

## Exports

JSON, issues CSV, and pages CSV read stored audit data. Entitled Full, Agency, and Admin audits can generate a structured PDF after completion. Exporting a report does not rerun the audit engine.
