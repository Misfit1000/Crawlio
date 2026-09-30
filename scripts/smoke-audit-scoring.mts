import assert from 'node:assert/strict';
import { calculateTransparentAuditScore, categoryForIssue, deduplicatePageIssues, normalizedIssueKey } from '../src/lib/audit/audit-scoring';
import type { ResourceAuditIssue, ResourceAuditPage } from '../src/lib/audit/resource-types';
import { auditCoverage, measuredAuditCategories } from '../src/lib/audit/audit-evidence-quality';

const page = (url: string, patch: Partial<ResourceAuditPage> = {}): ResourceAuditPage => ({
  id: url,
  url,
  statusCode: 200,
  responseTimeMs: 200,
  pageSizeBytes: 30_000,
  title: 'Healthy page title',
  metaDescription: 'A useful page description for the audit scoring smoke test.',
  h1: 'Healthy heading',
  wordCount: 500,
  crawlDepth: 0,
  issueCount: 0,
  crawledAt: new Date().toISOString(),
  ...patch,
});

const issue = (title: string, affectedUrl: string, severity: ResourceAuditIssue['severity'] = 'medium', category = 'crawlability'): ResourceAuditIssue => ({
  id: `${title}:${affectedUrl}`,
  title,
  affectedUrl,
  severity,
  category,
  description: title,
  evidence: 'Measured evidence',
  recommendation: 'Apply the documented fix.',
  detectedAt: new Date().toISOString(),
});

const healthySmallSite = calculateTransparentAuditScore({
  pages: [page('https://example.com/'), page('https://example.com/about')],
  issues: [],
  unavailableChecks: { mobile: ['Browser-rendered Core Web Vitals were not collected.'] },
});
assert.equal(healthySmallSite.overall, 100, 'A small site must not be penalized for using fewer pages than its plan allows.');
assert.equal(healthySmallSite.categories.crawlability.score, 100);

const criticalIndexing = calculateTransparentAuditScore({
  pages: [page('https://example.com/'), page('https://example.com/about')],
  issues: [issue('Site-wide noindex directive', 'https://example.com/', 'critical'), issue('Site-wide noindex directive', 'https://example.com/about', 'critical')],
});
assert((criticalIndexing.categories.crawlability.score ?? 100) <= 65, 'Critical site-wide indexability must cause a serious deduction.');

const isolated = calculateTransparentAuditScore({
  pages: Array.from({ length: 10 }, (_, index) => page(`https://example.com/${index}`)),
  issues: [issue('Missing canonical', 'https://example.com/1', 'medium')],
});
const siteWide = calculateTransparentAuditScore({
  pages: Array.from({ length: 10 }, (_, index) => page(`https://example.com/${index}`)),
  issues: Array.from({ length: 10 }, (_, index) => issue('Missing canonical', `https://example.com/${index}`, 'medium')),
});
assert((siteWide.categories.crawlability.score ?? 100) < (isolated.categories.crawlability.score ?? 0), 'Site-wide findings must weigh more than isolated findings.');

assert.equal(healthySmallSite.categories.mobile.score, null, 'Unavailable checks must not reduce the score.');
for (const category of Object.values(siteWide.categories)) {
  if (category.score != null) assert(category.score >= 0 && category.score <= 100);
}

console.log('Transparent audit scoring smoke test passed.');

for (const count of [500, 1000, 5000]) {
  const pages = Array.from({ length: count }, (_, i) => page(`https://example.com/${i}`, {
    statusCode: i % 20 === 0 ? 404 : 200, responseTimeMs: i % 3 === 0 ? 2000 : 200,
    pageSizeBytes: i % 7 === 0 ? 2_000_000 : 1000,
  }));
  const issues = pages.filter((_, i) => i % 2 === 0).map(p => issue('Missing canonical', p.url));
  const sample = issues[0];
  const fromRows = calculateTransparentAuditScore({ pages, issues });
  const fromAggregate = calculateTransparentAuditScore({ pages: [], issues: [], aggregate: {
    pageCount: count, errorPages: pages.filter(p => p.statusCode >= 400).length, redirectPages: 0,
    slowPages: pages.filter(p => p.responseTimeMs > 1500).length, largePages: pages.filter(p => p.pageSizeBytes > 1_000_000).length,
    groups: [{ key: normalizedIssueKey(sample), category: categoryForIssue(sample), title: sample.title,
      severity: sample.severity, affectedPages: issues.length }],
  } });
  assert.deepEqual(fromAggregate, fromRows, `Aggregate scoring must match all ${count} retained rows`);
}
console.log('Incremental scoring matches complete evidence at 500, 1000 and 5000 pages.');

const slowPage = page('https://example.com/slow', { responseTimeMs: 2000, pageSizeBytes: 1_500_000 });
const performanceIssues = [issue('Slow HTML Request', slowPage.url, 'medium', 'performance'), issue('Large HTML Page Size', slowPage.url, 'medium', 'performance')];
const current = calculateTransparentAuditScore({ pages: [slowPage], issues: performanceIssues, scoringVersion: '2.2', measuredCategories: ['performance'] });
assert.equal(current.deductions.length, 2, 'Page aggregates must not duplicate explicit performance findings.');
assert.equal(deduplicatePageIssues([performanceIssues[0], { ...performanceIssues[0], id: 'duplicate-check' }]).length, 1);
assert.equal(current.categories.structuredData.score, null, 'Unperformed categories must remain unavailable, not perfect.');
const legacy = calculateTransparentAuditScore({ pages: [slowPage], issues: performanceIssues });
assert.equal(legacy.deductions.length, 4, 'The legacy scoring model remains unchanged.');
assert.deepEqual(auditCoverage({ pagesCrawled: 20, pagesDiscovered: 25, pageLimit: 1000 }), {
  analysed: 20, discovered: 25, allowance: 1000, discoveredPercent: 80, allowancePercent: 2,
});
assert.equal(auditCoverage({ pagesCrawled: 0, pagesDiscovered: 0, pageLimit: 1000 }).discoveredPercent, null);
assert(!measuredAuditCategories(['on-page', 'accessibility']).includes('structuredData'));
assert(!measuredAuditCategories(['mobile']).includes('mobile'), 'Viewport presence is not browser-measured mobile usability.');
console.log('Evidence-aware scoring avoids double penalties and distinguishes coverage from allowance.');
