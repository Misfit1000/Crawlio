import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Socket } from 'node:net';
import { performance } from 'node:perf_hooks';
import type { AuditCheckGroup, AuditScope } from '../src/lib/audit/audit-scope.ts';
import type { ParsedPageData } from '../src/lib/seo/html-parser.ts';

type Scenario = {
  id: string;
  file: string;
  groups: AuditCheckGroup[];
  coverage: AuditScope['coverage'];
  expectedModules: string[];
  present: string[];
  absent: string[];
  suppressedPresent: string[];
  retainedEvidence: Array<keyof ParsedPageData>;
  omittedEvidence: Array<keyof ParsedPageData>;
};
type Manifest = { version: number; labelledChecks: Record<string, string>; scenarios: Scenario[] };
const WARMUP_ITERATIONS = 2;
const MEASURED_ITERATIONS = 25;
const fixtureDirectory = new URL('./fixtures/audit-accuracy/', import.meta.url);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const sorted = (values: Iterable<string>) => [...values].sort();
const round = (value: number) => Number(value.toFixed(3));
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function metrics(tp: number, fp: number, fn: number, tn: number) {
  return {
    truePositives: tp, falsePositives: fp, falseNegatives: fn, trueNegatives: tn,
    precision: tp + fp ? tp / (tp + fp) : null,
    recall: tp + fn ? tp / (tp + fn) : null,
  };
}

function timings(samples: number[]) {
  const ordered = [...samples].sort((a, b) => a - b);
  return {
    samples: samples.length,
    totalMs: round(samples.reduce((sum, value) => sum + value, 0)),
    medianMs: ordered.length ? round(ordered[Math.floor(ordered.length / 2)]) : null,
    p95Ms: ordered.length ? round(ordered[Math.ceil(ordered.length * 0.95) - 1]) : null,
  };
}

// Install before importing worker helpers: their imports initialize optional monitoring.
const originalFetch = globalThis.fetch;
const originalConnect = Socket.prototype.connect;
const originalDsn = process.env.SENTRY_DSN;
let networkAttempts = 0;
const denyNetwork = () => {
  networkAttempts += 1;
  throw new Error('Network access is forbidden in the local audit accuracy benchmark.');
};
globalThis.fetch = denyNetwork;
Socket.prototype.connect = denyNetwork;
process.env.SENTRY_DSN = '';

async function benchmark() {
  assert.equal(process.argv.length, 2, 'This fixed local benchmark takes no arguments.');
  const { parseHtml } = await import('../src/lib/seo/html-parser.ts');
  const { CHECKS, runCheckSetSafely } = await import('../src/lib/seo/checks/runner.ts');
  const { CHECK_REGISTRY } = await import('../src/lib/seo/checks/registry.ts');
  const { makeAuditScope } = await import('../src/lib/audit/audit-scope.ts');
  const { auditHtmlExtraction, selectedCheckModules } = await import('../src/workers/scalable-audit-worker.ts');
  const { toAuditDocument } = await import('../src/lib/supabase/audit-repository.ts');
  const { AUDIT_ENGINE_VERSION, CHECK_REGISTRY_VERSION, SCORING_VERSION } = await import('../src/lib/platform/version.ts');
  const manifestSource = await readFile(new URL('scenarios.json', fixtureDirectory), 'utf8');
  const manifest = JSON.parse(manifestSource) as Manifest;
  assert.equal(manifest.version, 1);
  assert.equal(manifest.scenarios.length, 6, 'Keep this corpus small and explicitly labelled.');
  const labelledIds = Object.keys(manifest.labelledChecks);
  assert.equal(labelledIds.length, 20, 'Changes to the labelled population need an explicit review.');
  for (const [id, moduleId] of Object.entries(manifest.labelledChecks)) {
    assert.ok(CHECK_REGISTRY[id], `Labelled check is not registered: ${id}`);
    assert.ok(CHECKS.some(check => check.id === moduleId), `Labelled module is not registered: ${moduleId}`);
  }
  assert.equal(new Set(manifest.scenarios.map(scenario => scenario.id)).size, manifest.scenarios.length);
  const referenceModules = CHECKS.filter(check => Object.values(manifest.labelledChecks).includes(check.id));
  const loaded = [];
  for (const scenario of manifest.scenarios) {
    assert.match(scenario.id, /^[a-z][a-z-]*$/);
    assert.equal(scenario.file, `${scenario.id}.html`, 'Fixtures must stay in the local fixture directory.');
    assert.deepEqual(sorted([...scenario.present, ...scenario.absent]), sorted(labelledIds), `${scenario.id}: label every check exactly once`);
    assert.equal(new Set(scenario.suppressedPresent).size, scenario.suppressedPresent.length);
    for (const id of scenario.suppressedPresent) {
      assert.ok(scenario.absent.includes(id), `${scenario.id}: isolation controls must be explicitly absent`);
      assert.ok(!scenario.expectedModules.includes(manifest.labelledChecks[id]), `${scenario.id}: isolation control must belong to an unselected module`);
    }
    for (const id of scenario.present) {
      assert.ok(scenario.expectedModules.includes(manifest.labelledChecks[id]), `${scenario.id}: positive label is outside scope`);
    }
    loaded.push({ scenario, html: await readFile(new URL(scenario.file, fixtureDirectory), 'utf8') });
  }

  const memoryBefore = process.memoryUsage();
  let sampledRssMax = memoryBefore.rss;
  let sampledHeapMax = memoryBefore.heapUsed;
  const cpuBefore = process.cpuUsage();
  const batchStart = performance.now();
  const allSamples: number[] = [];
  const results = [];
  for (const { scenario, html } of loaded) {
    const failures: string[] = [];
    const verify = (condition: boolean, message: string) => { if (!condition) failures.push(message); };
    const url = `https://audit-accuracy.invalid/${scenario.id}`;
    const audit = toAuditDocument({
      id: `local-benchmark-${scenario.id}`, normalized_url: url, hostname: 'audit-accuracy.invalid',
      submitted_input: url, status: 'running', plan: 'free', effective_mode: 'quick', requested_mode: 'quick',
      processing_tier: 'free', processing_version: 2, page_limit: scenario.coverage === 'page' ? 1 : 5,
      plan_page_limit: 5, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      audit_scope: makeAuditScope('custom', scenario.coverage, scenario.groups),
    });
    assert.ok(audit, `${scenario.id}: could not construct the local audit document`);
    const modules = selectedCheckModules(audit, SCORING_VERSION);
    verify(JSON.stringify(sorted(modules.map(check => check.id))) === JSON.stringify(sorted(scenario.expectedModules)), 'Selected modules differ from the explicit fixture scope.');
    const options = auditHtmlExtraction(audit, SCORING_VERSION);
    // Delivery and discovery are fixed inputs, not measured network observations.
    const context = { url, finalUrl: url, status: 200, headers: {}, loadTimeMs: 100,
      pageSizeBytes: Buffer.byteLength(html), contentType: 'text/html', depth: 0,
      blockedByRobots: false, inSitemap: true, isIndexable: true };
    const execute = () => {
      const parsed = parseHtml(html, url, options);
      return { parsed, run: runCheckSetSafely(modules, { ...parsed, ...context }, audit.id) };
    };
    const baseline = execute();
    const fingerprint = hash(JSON.stringify(baseline));
    const actual = new Set(baseline.run.issues.filter(issue => labelledIds.includes(issue.id)).map(issue => issue.id));
    const missed = scenario.present.filter(id => !actual.has(id));
    const unexpected = scenario.absent.filter(id => actual.has(id));
    const unlabelled = sorted(new Set(baseline.run.issues.filter(issue => !labelledIds.includes(issue.id)).map(issue => issue.id)));
    for (const key of scenario.omittedEvidence) verify(baseline.parsed[key] === undefined, `Out-of-scope extraction retained ${key}.`);
    for (const key of scenario.retainedEvidence) verify(baseline.parsed[key] !== undefined, `Selected extraction omitted ${key}.`);
    for (const issue of baseline.run.issues) {
      verify(Boolean(CHECK_REGISTRY[issue.id]), `Finding has no registry entry: ${issue.id}.`);
      verify(issue.affectedUrl === url, `Finding attributed to the wrong URL: ${issue.id}.`);
      verify(Boolean(issue.title?.trim() && issue.description?.trim() && issue.evidence?.trim() && issue.recommendation?.trim()), `Finding lacks actionable evidence/copy: ${issue.id}.`);
    }
    verify(baseline.run.unavailableChecks.length === 0, 'A selected check was unavailable.');
    verify(baseline.run.completedChecks === modules.length, 'Not every selected check completed.');
    const duplicates = labelledIds.filter(id => baseline.run.issues.filter(issue => issue.id === id).length > 1);
    verify(duplicates.length === 0, `Duplicate labelled findings: ${duplicates.join(', ')}.`);

    const fullParsed = parseHtml(html, url);
    const fullExtractionRun = runCheckSetSafely(modules, { ...fullParsed, ...context }, audit.id);
    verify(JSON.stringify(baseline.run) === JSON.stringify(fullExtractionRun), 'Scoped and full extraction disagree for the same selected modules.');
    const reference = runCheckSetSafely(referenceModules, { ...fullParsed, ...context }, audit.id);
    verify(reference.unavailableChecks.length === 0, 'An isolation-control check was unavailable.');
    for (const id of scenario.suppressedPresent) {
      verify(reference.issues.some(issue => issue.id === id), `Isolation control did not detect its known defect: ${id}.`);
      verify(!baseline.run.issues.some(issue => issue.id === id), `Out-of-scope finding leaked: ${id}.`);
    }
    for (let iteration = 0; iteration < WARMUP_ITERATIONS; iteration += 1) {
      verify(hash(JSON.stringify(execute())) === fingerprint, `Non-deterministic warmup ${iteration + 1}.`);
    }
    const samples: number[] = [];
    for (let iteration = 0; iteration < MEASURED_ITERATIONS; iteration += 1) {
      const started = performance.now();
      const result = execute();
      samples.push(performance.now() - started);
      verify(hash(JSON.stringify(result)) === fingerprint, `Non-deterministic measured iteration ${iteration + 1}.`);
      const memory = process.memoryUsage();
      sampledRssMax = Math.max(sampledRssMax, memory.rss);
      sampledHeapMax = Math.max(sampledHeapMax, memory.heapUsed);
    }
    allSamples.push(...samples);
    results.push({
      id: scenario.id, fixture: scenario.file, fixtureSha256: hash(html), inputBytes: Buffer.byteLength(html),
      scope: audit.scope, selectedModules: modules.map(check => check.id),
      expectedPresent: scenario.present, expectedAbsent: scenario.absent, observedLabelled: sorted(actual),
      missed, unexpected, unlabelledFindingIds: unlabelled, suppressedControlFindings: scenario.suppressedPresent,
      unavailableChecks: baseline.run.unavailableChecks, duplicates, failures,
      passed: missed.length === 0 && unexpected.length === 0 && failures.length === 0,
      metrics: metrics(scenario.present.length - missed.length, unexpected.length, missed.length, scenario.absent.length - unexpected.length),
      localBenchmark: { extractionAndChecks: timings(samples) },
    });
  }
  const batchElapsedMs = performance.now() - batchStart;
  const cpu = process.cpuUsage(cpuBefore);
  const memoryAfter = process.memoryUsage();
  const sum = (key: 'truePositives' | 'falsePositives' | 'falseNegatives' | 'trueNegatives') => results.reduce((total, result) => total + result.metrics[key], 0);
  const passed = results.every(result => result.passed) && networkAttempts === 0;
  process.exitCode = passed ? 0 : 1;
  return {
    schemaVersion: 1, benchmark: 'audit-accuracy', measurementKind: 'local benchmark', passed,
    runtime: { node: process.version, platform: process.platform, architecture: process.arch },
    engine: { auditEngineVersion: AUDIT_ENGINE_VERSION, checkRegistryVersion: CHECK_REGISTRY_VERSION, scoringVersion: SCORING_VERSION },
    corpus: { manifestSha256: hash(manifestSource), scenarios: results.length, labelledChecks: manifest.labelledChecks,
      labelUnit: 'scenario + registered check ID; presence/absence after scope selection',
      labelledDecisions: results.length * labelledIds.length, unlabelledFindingsAreScored: false },
    safety: { networkAttempts, networkGuard: 'global fetch and Node socket connect blocked; Sentry disabled', productionAuditsRun: 0 },
    metrics: metrics(sum('truePositives'), sum('falsePositives'), sum('falseNegatives'), sum('trueNegatives')),
    localBenchmark: {
      warmupIterationsPerScenario: WARMUP_ITERATIONS, measuredIterationsPerScenario: MEASURED_ITERATIONS,
      extractionAndChecks: timings(allSamples), batchElapsedMs: round(batchElapsedMs),
      batchCpuMs: { user: round(cpu.user / 1000), system: round(cpu.system / 1000) },
      memory: { unit: 'bytes', before: memoryBefore, after: memoryAfter,
        rssDelta: memoryAfter.rss - memoryBefore.rss, heapUsedDelta: memoryAfter.heapUsed - memoryBefore.heapUsed,
        sampledProcessRssMax: sampledRssMax, sampledProcessHeapUsedMax: sampledHeapMax,
        processLifetimeRssHighWaterMark: process.resourceUsage().maxRSS * 1024 },
    },
    scenarios: results,
    limitations: [
      'Six hand-labelled local HTML scenarios and 20 selected check IDs, not general audit accuracy or a representative web corpus.',
      'Known out-of-scope defects are labelled absent by design; unlabelled findings are reported but not judged.',
      'No fetching, rendered browser evidence, crawl execution, passive security supplement, scoring, persistence, API or UI is exercised.',
      'HTTP/discovery context is synthetic; no claim of destination reachability, robots/sitemap correctness or production performance.',
      'Timings cover parseHtml plus selected checks only; batch CPU/time include controls and bookkeeping but exclude imports and file reads.',
      'Memory is process-wide, includes imported worker dependencies, and sampled maxima are not allocation peaks; lifetime RSS includes startup.',
      'Only labels and finding output must be deterministic; local timing and memory vary and have no performance pass threshold.',
    ],
  };
}

try {
  console.log(JSON.stringify(await benchmark(), null, 2));
} catch (error) {
  process.exitCode = 1;
  console.log(JSON.stringify({ schemaVersion: 1, benchmark: 'audit-accuracy', measurementKind: 'local benchmark',
    passed: false, safety: { networkAttempts, productionAuditsRun: 0 }, error: errorText(error) }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  Socket.prototype.connect = originalConnect;
  if (originalDsn === undefined) delete process.env.SENTRY_DSN;
  else process.env.SENTRY_DSN = originalDsn;
}
