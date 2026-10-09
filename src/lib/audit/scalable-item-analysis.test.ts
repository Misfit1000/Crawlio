import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { analysisFrontierItem, analysisIssueToRow, analysisPageToRow, analyseScalableItem, auditHtmlExtraction, scoreOptions, scoreGroups, selectedCheckModules, type ScalableAnalysisFetcher, type ScalableAnalysisScheduler } from './scalable-item-analysis';
import { buildSecurityIssues, mapAuditIssue, normalizeCrawlUrl, parseFetchedPage } from './worker-page-analysis';
import { makeAuditScope, AUDIT_CHECK_GROUPS, AUDIT_GROUP_DETAILS } from './audit-scope';
import type { ResourceAuditDocument, ResourceAuditIssue, ResourceAuditPage } from './resource-types';
import { frontierItem } from '../supabase/scalable-audit-repository';
import { issueToRow, pageToRow } from '../supabase/audit-repository';
import type { SafePublicFetchOptions, SafePublicResponse } from '../security/safe-public-fetch';

const url = 'https://example.com/';
const html = '<!doctype html><html lang="en"><head><title>Shared analysis fixture</title><meta name="description" content="A fixture for shared audit analysis."><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main><h1>Shared fixture</h1><a href="/next?utm_source=fixture#section">Next page</a><form action="http://example.com/submit"><label for="email">Email</label><input id="email"><button>Submit</button></form><img src="http://example.com/picture.png" alt="Fixture"></main></body></html>';
const scheduler: ScalableAnalysisScheduler = { schedule: (_url, operation) => operation() };
const run = { metadata: { scoringVersion: '2.2', sitemapInspected: true, robotsState: 'parsed', robots: { rules: [], sitemaps: [] } } };
function audit(scope = makeAuditScope('security')): ResourceAuditDocument {
  return { id: 'shared-analysis-fixture', normalizedUrl: url, plan: 'free', mode: 'quick', effectiveMode: 'quick', scope } as ResourceAuditDocument;
}
function response(overrides: Partial<SafePublicResponse> = {}): SafePublicResponse {
  return { requestedUrl: url, finalUrl: url, status: 200, body: html, bodyBytes: new TextEncoder().encode(html).length,
    headers: {}, contentType: 'text/html', redirectCount: 0, durationMs: 2_000, ...overrides };
}
function fixtureFetch(value = response()) {
  const requests: Array<{ url: string; options: SafePublicFetchOptions }> = [];
  const fetcher: ScalableAnalysisFetcher = async (target, options) => { requests.push({ url: target, options }); return value; };
  return { requests, fetcher };
}

test('shared analyzer remains independent of worker, database, monitoring and Node HTTP modules', async () => {
  const result = await build({ entryPoints: ['src/lib/audit/scalable-item-analysis.ts'], bundle: true,
    platform: 'node', format: 'esm', packages: 'external', write: false, metafile: true, logLevel: 'silent' });
  const inputs = Object.keys(result.metafile!.inputs);
  assert.ok(inputs.every(input => !/src\/(?:workers|lib\/(?:supabase|monitoring))\//.test(input)));
  const imports = Object.values(result.metafile!.inputs).flatMap(input => input.imports.map(item => item.path));
  assert.ok(imports.every(path => !/^(?:node:)?(?:http|https|dns|net|tls)(?:\/|$)/.test(path)));
  assert.ok(!inputs.some(input => input.endsWith('safe-public-fetch.ts')));
});

test('all selected check groups keep the production extraction and dispatch policy', async () => {
  for (const group of AUDIT_CHECK_GROUPS) {
    const scoped = audit(makeAuditScope(group));
    assert.deepEqual(selectedCheckModules(scoped, '2.2').map(check => check.id).sort(), [...AUDIT_GROUP_DETAILS[group].modules].sort());
    assert.equal(auditHtmlExtraction(scoped, '2.2').keywords, false);
    const { fetcher, requests } = fixtureFetch();
    const result = await analyseScalableItem(scoped, run, analysisFrontierItem(url, 'page'), scheduler, fetcher);
    assert.equal(requests.length, 1);
    assert.equal((result.page as Record<string, unknown>).fetch_status, 'success');
    assert.deepEqual(result.children, [], 'page coverage cannot enqueue other pages');
    const options = scoreOptions({ ...run, analysed: 1, metadata: { ...run.metadata, measuredCategories: result.measuredCategories } }, scoped);
    assert.deepEqual(options.selectedCategories, [AUDIT_GROUP_DETAILS[group].category]);
    assert.ok(options.measuredCategories?.every(category => options.selectedCategories?.includes(category)));
  }
});

test('security evidence, deterministic IDs, scoped findings and site discovery are preserved', async () => {
  const { fetcher } = fixtureFetch();
  const selected = audit();
  const item = analysisFrontierItem(url, 'page');
  const result = await analyseScalableItem(selected, run, item, scheduler, fetcher);
  const repeated = await analyseScalableItem(selected, run, item, scheduler, fetcher);
  const issues = result.issues as Array<Record<string, unknown>>;
  assert.ok(issues.length > 0);
  assert.ok(issues.every(issue => issue.category === 'Security' || issue.category === 'security'));
  assert.equal(issues.filter(issue => issue.check_id === 'missing-hsts' || issue.title === 'Missing HSTS header').length, 1);
  assert.deepEqual(issues.map(issue => issue.id), (repeated.issues as typeof issues).map(issue => issue.id));
  assert.equal((result.page as Record<string, unknown>).id, (repeated.page as Record<string, unknown>).id);
  assert.deepEqual(result.measuredCategories, ['security']);
  assert.ok((result.groups as Array<{ category: string }>).every(group => group.category === 'security'));

  const site = await analyseScalableItem(audit(makeAuditScope('seo', 'site')), run, item, scheduler, fetcher);
  assert.deepEqual((site.children as Array<{ url: string }>).map(child => child.url), ['https://example.com/next']);
  const performance = await analyseScalableItem(audit(makeAuditScope('performance')), run, item, scheduler, fetcher);
  assert.ok((performance.issues as Array<Record<string, unknown>>).some(issue => issue.check_id === 'slow-server-response'));
});

test('robots and sitemap dependencies retain bounded fetches, conservative access and retry semantics', async () => {
  const robots = analysisFrontierItem('https://example.com/robots.txt', 'robots');
  const unavailable = fixtureFetch(response({ status: 503, body: '', contentType: 'text/plain' }));
  const retry = await analyseScalableItem(audit(), run, robots, scheduler, unavailable.fetcher);
  assert.equal(typeof retry.retryAt, 'string');
  assert.equal(unavailable.requests[0].options.maxBytes, 128_000);
  const stopped = await analyseScalableItem(audit(), run, { ...robots, attempts: 2 }, scheduler, unavailable.fetcher);
  assert.equal(stopped.robotsUnavailable, true);
  let requests = 0;
  const forbiddenFetch: ScalableAnalysisFetcher = async () => { requests++; throw new Error('Must not fetch'); };
  const deniedRun = { metadata: { ...run.metadata, robotsUnavailable: true } };
  const blocked = await analyseScalableItem(audit(), deniedRun, analysisFrontierItem(url, 'page'), scheduler, forbiddenFetch);
  assert.equal((blocked.page as Record<string, unknown>).fetch_status, 'blocked');
  assert.deepEqual(blocked.groups, []);
  const sitemap = analysisFrontierItem('https://example.com/sitemap.xml', 'sitemap');
  assert.deepEqual(await analyseScalableItem(audit(), deniedRun, sitemap, scheduler, forbiddenFetch), { key: sitemap.key, children: [] });
  assert.equal(requests, 0);
  const xml = fixtureFetch(response({ body: '<urlset><url><loc>https://example.com/next</loc></url><url><loc>https://elsewhere.example/page</loc></url></urlset>', contentType: 'application/xml' }));
  const discovery = await analyseScalableItem(audit(makeAuditScope('seo', 'site')), run, sitemap, scheduler, xml.fetcher);
  assert.equal(xml.requests[0].options.maxBytes, 2_000_000);
  assert.deepEqual((discovery.children as Array<{ url: string }>).map(child => child.url), ['https://example.com/next']);
  const transportFailure: ScalableAnalysisFetcher = async () => { throw Object.assign(new Error('temporary DNS'), { code: 'EAI_AGAIN' }); };
  assert.equal(typeof (await analyseScalableItem(audit(), run, sitemap, scheduler, transportFailure)).retryAt, 'string');
  assert.deepEqual((await analyseScalableItem(audit(), run, { ...sitemap, attempts: 2 }, scheduler, transportFailure)).discoveryErrors, ['Sitemap unavailable']);
});

test('pure row conversions, frontier hashes and parsing match the production contracts', () => {
  const fetched = parseFetchedPage(url, response(), { keywords: false, accessibility: true });
  assert.equal(fetched.parsed?.accessibility?.unlabeledFields, 0);
  assert.equal(normalizeCrawlUrl('/next?utm_source=fixture#section', url), 'https://example.com/next');
  assert.deepEqual(analysisFrontierItem(url, 'page', 3, url, 'Example'), frontierItem(url, 'page', 3, url, 'Example'));
  const sourceIssue = buildSecurityIssues(fetched)[0];
  const issue: ResourceAuditIssue = { ...sourceIssue, id: 'issue-fixture', detectedAt: '2026-10-09T00:00:00.000Z' };
  const page: ResourceAuditPage = { id: 'page-fixture', url, title: 'Fixture', metaDescription: '', h1: 'Fixture',
    statusCode: 200, responseTimeMs: 100, pageSizeBytes: 500, wordCount: 50, crawlDepth: 2, issueCount: 1,
    crawledAt: issue.detectedAt, fetchStatus: 'success', sourceUrl: url,
    toolEvidence: { version: 1, contentType: 'text/html', metaRobots: '', xRobotsTag: '', redirected: false, robotsAllowed: true, securityHeaders: {} } };
  assert.deepEqual(analysisPageToRow('audit-fixture', page), pageToRow('audit-fixture', page));
  assert.deepEqual(analysisIssueToRow('audit-fixture', issue), issueToRow('audit-fixture', issue));
  assert.deepEqual(scoreGroups([issue, { ...issue, severity: 'high' }, { ...issue, severity: 'info' }]).map(group => group.severity), ['high']);
  assert.equal(mapAuditIssue({ id: 'fixture-check', title: 'Fixture' } as never, url).affectedUrl, url);
  assert.deepEqual(scoreOptions({ analysed: 0, metadata: {} }, audit()).measuredCategories, []);
  assert.equal(scoreOptions({ analysed: 1, metadata: {} }, audit()).scoringVersion, '2.1');
});
