# Local Audit Accuracy Benchmark

Run only the focused benchmark from the repository root with the installed Node/tsx toolchain:

```powershell
node --import tsx scripts/benchmark-audit-accuracy.mts
```

No package script, installation, build, full typecheck, service, credentials, or network is required. The script accepts no arguments and writes one JSON object to stdout. Exit code 0 means every labelled expectation and guard passed; 1 means regression or setup failure. A setup failure still emits JSON with an `error` field. The script does not write a report file. Fixture URLs use the reserved `.invalid` domain; assets and scripts in the HTML are never loaded or executed. Global fetch and Node socket connections are blocked before engine imports, attempted use fails the benchmark even if swallowed by a check, and optional Sentry initialization is disabled for this process.

## Real Code Path

The harness imports `parseHtml`, `CHECKS`/`runCheckSetSafely`, and `CHECK_REGISTRY`. It uses the worker's actual `selectedCheckModules` and `auditHtmlExtraction`, constructing local documents through `toAuditDocument` and scopes through `makeAuditScope`. It does not reproduce detection rules. Registered issue IDs, affected URLs, and nonempty evidence, descriptions, titles, and recommendations are checked.

The two existing smoke scripts were read for conventions but are not executed: `smoke-finding-accuracy.mts` covers runner failure isolation and insight/grouping examples; `smoke-audit-scoring.mts` covers score semantics. This benchmark adds fixture-level detection labels, not a new scoring model.

## Labelled Corpus

`scripts/fixtures/audit-accuracy/scenarios.json` defines the 20 scored IDs and their runner modules. Every scenario explicitly lists each ID exactly once in `present` or `absent`. Labels are manually specified from fixture facts, never generated from the current engine output. Exact module lists and retained/omitted extraction fields are also fixture expectations.

| Scenario | Scope | Expected Labelled Findings | Important Negative Controls |
| --- | --- | --- | --- |
| `healthy` | SEO, crawlability, structured data, accessibility; site extraction | None | Valid metadata, absolute canonical, valid JSON, labelled controls, descriptive/decorative image alternatives |
| `seo-defects` | SEO; page | Missing title, description, H1, image alt | Canonical/noindex, invalid JSON, and unnamed button remain out of scope |
| `crawlability-defects` | Crawlability; page | Relative canonical, meta noindex | Canonical resolves through base URL, so not missing; SEO/schema/accessibility defects remain out of scope |
| `schema-defects` | Structured data; page | Invalid JSON-LD | One valid plus one invalid script is not absent JSON-LD; SEO/accessibility defects remain out of scope |
| `accessibility-defects` | Accessibility; page | Missing language/main, unnamed link/button, unlabeled field, duplicate ID, broken ARIA reference, positive tabindex, hidden focusable control, restricted zoom, static JS-shell limitation | SEO/canonical/noindex/schema defects remain out of scope |
| `decorative-images` | SEO, crawlability, structured data, accessibility; page | Missing JSON-LD | Empty/whitespace image alternatives are not missing alt; ARIA-named controls and wrapped/explicit labels are not unnamed/unlabelled |

For isolation, `suppressedPresent` IDs must be absent in the scoped result but present when the real corresponding runner modules inspect full extraction of the same HTML. This prevents a broken check or harmless fixture from passing an isolation assertion vacuously. All selected modules also run on full extraction; those findings must exactly match scoped extraction. Site/page coverage here tests extraction behavior only, not crawl admission or discovery.

The scored IDs are limited to missing title/description/H1/alt, missing/relative canonical, meta noindex, absent/malformed JSON-LD, and the eleven accessibility/static-shell signals in the manifest. Short/long metadata, content heuristics, local/social signals, multiple landmarks, and other registry IDs are not labelled. Their observed IDs appear as `unlabelledFindingIds`; they are not assumed correct or incorrect. A "healthy" scenario means healthy for these labels, not a globally clean audit.

Nineteen of the twenty IDs have a positive scoped label. `missing-canonical` has negative scoped labels and positive isolation controls only; its detection is checked by those controls, not counted in scoped recall.

## Metrics and Failures

The unit is `(scenario, registered check ID)` after scope selection, not an issue occurrence, affected element, severity, score, or discovered page. Across six scenarios there are 120 labelled binary decisions. Micro precision is `TP / (TP + FP)` and micro recall is `TP / (TP + FN)`. Undefined denominators are JSON `null`, not an invented perfect score. Repetitions do not multiply label counts. Each scenario reports `missed`, `unexpected`, observed labelled IDs, and failures.

Any missed/unexpected labelled finding, duplicate labelled finding, unavailable selected/control module, missing registry entry/actionable evidence, wrong URL, scope/extraction mismatch, failed isolation control, changed repeated output, or attempted network access exits nonzero. Unlabelled finding counts are informational. Two warmups and 25 measured iterations per scenario must reproduce the complete parsed data and runner output, including unlabelled findings. Labels are evaluated on the baseline; any differing repeat independently fails determinism.

## Local Measurements

`localBenchmark.extractionAndChecks` reports 150 measured samples with summed elapsed milliseconds, median, and nearest-rank p95. Each timed interval includes only scoped `parseHtml` and `runCheckSetSafely`; selection, fixture reads, imports, hashes, memory sampling, full-extraction controls, and JSON output are excluded. Per-scenario timing summaries use the same definition. Batch wall/CPU measurements include baseline/control runs, warmups, and bookkeeping, but exclude imports and fixture reads. Input bytes and SHA-256 hashes identify the measured corpus.

Memory values are bytes from `process.memoryUsage()` before/after the scenario batch, with RSS/heap deltas and sampled process maxima after each measured iteration. Garbage collection may make deltas negative. These are not per-check allocations or true allocation peaks. `processLifetimeRssHighWaterMark` is Node's process-lifetime `maxRSS` converted from KiB to bytes and includes startup/imports. Imported worker dependencies contribute to memory even though no worker loop runs. No timing or memory threshold is enforced: this small local workload is for observation, not a production speed/capacity claim.

## Measured Example

Selected fields from a local Windows x64 run on Node v24.14.1 (2026-10-15):

```json
{
  "passed": true,
  "metrics": { "truePositives": 19, "falsePositives": 0, "falseNegatives": 0, "trueNegatives": 101, "precision": 1, "recall": 1 },
  "networkAttempts": 0,
  "extractionAndChecks": { "samples": 150, "totalMs": 86.921, "medianMs": 0.498, "p95Ms": 1.328 },
  "sampledProcessRssMaxBytes": 182464512,
  "rssDeltaBytes": 667648
}
```

The available runtime was Node 24; `package.json` targets Node 22, so this run does not establish Node 22 compatibility. Failure handling was verified by temporarily adding alt text to the deliberately missing-alt fixture without changing its labels: the benchmark exited 1, reported `missing-alt-text` as missed, and returned recall `18 / 19`. The fixture was restored afterward. Only this focused benchmark was executed; no existing smoke suite, build, or full typecheck was run.

## Limits

This is a tiny, synthetic regression corpus, not evidence of general precision/recall, search eligibility, WCAG conformance, or security assurance. Out-of-scope defects intentionally count as negative labels; their absence is correct for the requested scope, not evidence that the HTML has no defect. The positive controls test detector availability separately.

Delivery context is fixed synthetic HTTP 200 with a 100 ms input, known HTML bytes, and no actual robots/sitemap discovery. No URL fetching, redirect/retry handling, destination checks, JavaScript rendering, production audit, database write, queue work, passive security supplement, final scoring/deduplication, API, or UI is tested. JSON-LD checks concern syntax only. Fixture labels must be reviewed when intended check behavior changes; do not regenerate expectations from findings to turn a regression green.
