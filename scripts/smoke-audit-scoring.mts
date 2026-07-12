import assert from 'node:assert/strict';
import { calculateTransparentAuditScore } from '../src/lib/audit/audit-scoring';
import type { ResourceAuditIssue, ResourceAuditPage } from '../src/lib/audit/resource-types';

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
