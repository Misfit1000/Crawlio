import assert from 'node:assert/strict';
import {
  classifyReportSection,
  extractReportScores,
  groupRecommendations,
  observedPageMetrics,
  scoreToGrade,
} from '../src/lib/audit/report-insights.ts';
import type { ResourceAuditIssue, ResourceAuditPage } from '../src/lib/audit/resource-types.ts';

assert.equal(scoreToGrade(100), 'A');
assert.equal(scoreToGrade(90), 'A');
assert.equal(scoreToGrade(89), 'B');
assert.equal(scoreToGrade(80), 'B');
assert.equal(scoreToGrade(79), 'C');
assert.equal(scoreToGrade(60), 'D');
assert.equal(scoreToGrade(50), 'E');
assert.equal(scoreToGrade(49), 'F');
assert.equal(scoreToGrade(null), null);

const scores = extractReportScores({ overall: 84, security: '91', seo: undefined });
assert.equal(scores.overall, 84);
assert.equal(scores.security, 91);
assert.equal(scores.seo, null, 'missing section scores must remain unmeasured');
assert.equal(scores.performance, null, 'missing performance data must not inherit the overall score');

const issue = (overrides: Partial<ResourceAuditIssue>): ResourceAuditIssue => ({
  id: String(Math.random()),
  severity: 'medium',
  category: 'metadata',
  title: 'Missing meta description',
  description: 'The page does not provide a meta description.',
  affectedUrl: 'https://example.com/',
  evidence: 'meta description was not found',
  recommendation: 'Add a concise description for the page.',
  detectedAt: new Date(0).toISOString(),
  ...overrides,
});

const issues = [
  issue({ id: 'one', affectedUrl: 'https://example.com/' }),
  issue({ id: 'two', affectedUrl: 'https://example.com/about', severity: 'high' }),
  issue({ id: 'three', title: 'Missing HSTS', category: 'security headers', affectedUrl: 'https://example.com/' }),
  issue({ id: 'four', title: 'Slow response', category: 'performance', affectedUrl: 'https://example.com/slow' }),
];

const grouped = groupRecommendations(issues);
assert.equal(grouped.length, 3);
assert.equal(grouped[0].title, 'Missing meta description');
assert.equal(grouped[0].severity, 'high');
assert.equal(grouped[0].affectedCount, 2);
assert.equal(classifyReportSection(issues[2]), 'security');
assert.equal(classifyReportSection(issues[3]), 'performance');

const pages: ResourceAuditPage[] = [
  { id: 'one', url: 'https://example.com/', statusCode: 200, responseTimeMs: 100, pageSizeBytes: 1024, title: 'Home', metaDescription: '', h1: 'Home', wordCount: 100, crawlDepth: 0, issueCount: 0, crawledAt: new Date(0).toISOString() },
  { id: 'two', url: 'https://example.com/about', statusCode: 301, responseTimeMs: 200, pageSizeBytes: 2048, title: 'About', metaDescription: '', h1: 'About', wordCount: 80, crawlDepth: 1, issueCount: 1, crawledAt: new Date(0).toISOString() },
  { id: 'three', url: 'https://example.com/missing', statusCode: 404, responseTimeMs: 1000, pageSizeBytes: 3072, title: '', metaDescription: '', h1: '', wordCount: 0, crawlDepth: 1, issueCount: 2, crawledAt: new Date(0).toISOString() },
];

const metrics = observedPageMetrics(pages);
assert.equal(metrics.averageResponseMs, 433);
assert.equal(metrics.p95ResponseMs, 1000);
assert.equal(metrics.averagePageBytes, 2048);
assert.equal(metrics.totalPageBytes, 6144);
assert.equal(metrics.successfulPages, 1);
assert.equal(metrics.redirectPages, 1);
assert.equal(metrics.errorPages, 1);

console.log('Report insight smoke checks passed.');
