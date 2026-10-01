# Crawlio Evidence-First, Low-Cost Roadmap

Status: proposed follow-up roadmap, not a claim that these tools are implemented.
Keep the current audit experience, Vanta Black, admin operations, and blog reliability release separate.

## Changes to the Proposed Plan

1. Establish evidence prerequisites before adding tools. Current page records do not contain every indexability, robots, response-header, or incoming-link fact these features need.
2. Prioritize improvements inside the report before launching ten separate destinations. Use an accessible, lazy-loaded Tools area for standalone utilities.
3. Treat free-tier friendliness as a measured resource budget, not negligible or zero cost by assumption.
4. Do not compute whole-site findings from the first 50 rows. Clearly distinguish complete aggregates, downloaded evidence, samples, and unavailable measurements.
5. Reuse canonical scores, grade bands, URL handling, ownership checks, and export infrastructure. New tools do not alter the audit score.

## Prerequisites

- **Robots evaluation:** `src/lib/seo/robots.ts` currently combines matching groups and uses prefix checks with Allow-first precedence. That is not sufficient for a multi-crawler tester. Replace the implementation behind the shared interface with one standards-aware evaluator, preserving persisted legacy rules and existing worker behavior during rollout. Test specific-group precedence, merged equal groups, longest matching rule, equal-length Allow preference, wildcards, end anchors, query paths, percent encoding, and line evidence. Do not introduce a second parser.
- **Robots fetch state:** preserve status, retrieval time, and a bounded raw document alongside the parsed result in the existing one-time audit initialization commit. Missing, empty, malformed, inaccessible, and temporarily unavailable are distinct. An HTTP error must not silently become an empty successful file. Legacy audits without raw content can use paste mode, not a new fetch.
- **Evidence projection:** document which retained fields support each feature. Add only bounded fields from the already-fetched response to existing commits when justified. Avoid storing full HTML, repeated response headers, or new per-page writes.
- **Coverage:** include audit ID, processing version, completed/partial state, analysed count, retained count, evidence timestamp, and complete/sample scope in tool inputs. Unknown is never false or zero.
- **Privacy:** all evidence reads remain authorized and paginated. Tool state is ephemeral; never put private page URLs, pasted robots content, or schema text in share links or monitoring events.

## Release Order

| Phase | Deliverable | Data / Cost Boundary |
| --- | --- | --- |
| 0 | Finish audit overview, complete aggregate charts, page evidence, executive summary, accessible navigation, Vanta Black, and admin guardrails | Current release; reuse retained evidence and bounded requests |
| 1 | SERP/social preview and improved executive/print view | Browser-only, selected-page metadata, no API calls after evidence is loaded |
| 2 | Robots sandbox and per-product crawler access | One shared evaluator; existing robots evidence or pasted text; no crawler requests |
| 3 | Crawl-clutter and depth analysis | Complete server aggregates or explicitly labelled loaded subset; no graph dependency |
| 4 | Sitemap download and header remediation | Require sufficient retained indexability/header evidence; authorize any complete-evidence export |
| 5 | Structured-data builder | Standalone lazy-loaded browser tool, safe JSON parsing, bounded input |
| 6 | Opt-in public score badge | Existing public-report permission; caching and revocation semantics resolved first |

## Feature Corrections

### SERP and Social Preview

- Reuse title, description, URL, site name, and Open Graph values already retained. Do not invent missing social fields.
- Start with Google-style mobile/desktop and generic social previews. Platform-specific cards are illustrative, not exact live rendering.
- Local overrides never mutate stored audit evidence. Provide Reset to audited values and a text equivalent.
- Avoid fetching arbitrary remote preview images just to inspect dimensions. Reuse an already loaded image or show a metadata-only state; this avoids extra traffic and third-party tracking.
- Font-aware width checks are approximate and rerun only on input changes after fonts load. Reserve image/layout dimensions.

### Sitemap Generator

- A successfully fetched 200 page is not automatically indexable. Check content type, meta and X-Robots directives, canonical destination, supported origin, robots state, and redirect evidence where available.
- Restrict output to one selected origin. Do not combine HTTP/HTTPS, subdomains, or cross-domain canonicals into a single claimed complete sitemap.
- Deduplicate URLs using existing normalization without stripping meaningful query parameters or path case.
- Unknown indexability means excluded with an explanation, not silently included.
- Use reliable modification evidence only; the audit crawl time is not a page's last modification date. Omit invented priority and change frequency.
- A 50-row view exports a clearly labelled subset. For complete large audits, reuse the authorized resumable export path rather than silently downloading thousands of rows.

### Internal Links and Crawl Clutter

- A frontier parent is a discovery relationship, not a complete incoming-link graph. Current `sourceUrl` and `crawlDepth` support observed paths/depth only.
- Add incoming/outgoing counts only when all relevant retained relationships were observed. Bound relationship storage and expose truncation.
- Call sitemap-discovered zero-inlink pages potential orphans only within stated crawl coverage. Entry pages are not automatically orphans.
- Distinguish discovery depth from shortest observed graph distance. Redirects, canonicals, shared navigation, and crawl limits can change interpretation.
- Group tracking parameters as potential variants, but preserve sorting, filters, pagination, language, and session semantics as separate evidence. A query parameter is not itself an SEO defect.
- Treat trailing slashes and path casing as candidates, not equivalent URLs, unless redirects or canonical evidence support equivalence. Fragments identify same-document destinations, not separate fetched pages.
- Do not expose full session/token parameter values; redact sensitive query values in examples and exports.

### Robots and Crawler Access

- Evaluate the selected path, not just `/`. A domain-wide Allowed/Blocked result is misleading when sections have different rules; use Partial where observed paths differ.
- Separate crawler tokens from usage-control tokens. Maintain a small reviewed registry with official documentation links and last-verified dates.
- Verify current OpenAI, Anthropic, Perplexity, Google, and Apple documentation before adding labels. Do not claim access implies discovery, inclusion, citation, indexing, or model training.
- Missing robots content and parser warnings remain visible. The sandbox evaluates directives, not authentication, bot protection, or actual crawler visits.

### Header Remediation and Structured Data

- Generate snippets from observed header findings only. Security headers are not direct ranking guarantees.
- Do not enable HSTS preload or includeSubDomains by default. Do not overwrite a functioning existing CSP. Start new CSP guidance in report-only mode, with explicit staging validation and policy-specific caveats.
- Begin with Nginx, Apache, Vercel, and Caddy; add other deployment targets only when their actual configuration surface is supported.
- Schema forms validate syntax and supported structural fields only. Product offers, prices, reviews, ratings, authors, dates, and business facts require real user input; never synthesize them.
- Parse JSON only, limit input size/depth, reject unsafe URL schemes, escape `<` when embedding JSON-LD in HTML, and provide external validation links without implying eligibility.

### Score Badge

- Use existing opaque share tokens, not raw audit IDs/domains. Require explicit owner opt-in; exclude failed/scoreless audits.
- Show audit date, score version, and limited coverage where applicable. It is an audit result, not verification or a ranking.
- Immutable CDN caching conflicts with immediate share revocation. Use short cache windows/revalidation or a documented purge mechanism; test revoked and expired sharing before release.
- A CDN hit still consumes edge resources. Rate-limit generation and keep output text escaped with no scripts, external resources, or arbitrary SVG markup.

## Resource and Usability Gates

- No new homepage dependency or eager API request. Route-level loading for standalone tools.
- Tool editing, animation, previews, and validation add zero database writes and zero crawler requests.
- Default evidence requests remain 50 rows, maximum 100. Complete processing above the local evidence cap uses existing worker/export infrastructure.
- Keep charts/maps sampled and labelled. Scores/counts use complete aggregates, never the visual sample.
- Bound paste size, output size, rendered rows, and main-thread work. Use incremental processing or a browser worker only after profiling demonstrates a need.
- Use Vanta Black backgrounds with differentiated neutral surfaces, readable borders, visible focus, non-color status labels, text chart equivalents, and reduced motion. Do not animate continuously while hidden/offscreen.
- Preserve browser back/forward and report filters. Place contextual actions next to the evidence they use; do not add more nested report panels.

## Focused Validation

Test contracts and risks, not copies of implementation code: parser correctness, safe serialization, evidence scope, ownership/share revocation, source/score honesty, and bounded processing. One production build/typecheck plus targeted desktop/mobile light/dark journeys for each slice is sufficient. Do not rerun the entire suite for copy-only changes.

Measure compressed route JavaScript, request counts, retained bytes per page, API latency, rendering time on the 500/5,000-page fixtures, and database writes. Release only when the existing workflow budgets are preserved. Record limitations and migrations before enabling a feature.

## Reference Contracts

- [Robots Exclusion Protocol, RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html): parser behavior, user-agent matching, path matching, and encoding rules.
- [Vercel cache-control behavior](https://vercel.com/docs/caching/cache-control-headers): separate browser and edge caching; keep private responses out of shared caches.
- [Google SEO starter guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide): useful content and crawlability are improvements, not promises of indexing or rank.
