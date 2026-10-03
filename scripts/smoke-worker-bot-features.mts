import assert from 'node:assert/strict';
import { formatReportToMarkdown } from '../src/workers/cloudflare-audit/src/report-formatter';
import { auditSitemap } from '../src/workers/cloudflare-audit/src/sitemap-auditor';
import { simulateBotAccess } from '../src/workers/cloudflare-audit/src/ai-bots-simulator';
import { inspectPage } from '../src/workers/cloudflare-audit/src/inspector';
import type { ResourceAuditReport } from '../src/lib/audit/resource-types';

console.log('🤖 Testing Crawlio Worker Bot Advanced Features...\n');

// 1. Report Formatter Test
console.log('1. Testing Executive Markdown Report Formatter...');
const mockReport: ResourceAuditReport = {
  scores: {
    overall: 92,
    grade: 'A',
    seo: 95,
    technical: 90,
    crawlability: 100,
    internalLinks: 88,
    performance: 85,
    security: 90,
    accessibility: 95,
    coverage: {
      pagesDiscovered: 5,
      pagesAnalysed: 5,
      coveragePercent: 100,
      stopReason: 'page_limit_reached',
    },
    auditEngineVersion: '2026.09',
    executor: 'cloudflare',
  },
  summary: 'Site is in great health.',
  topIssues: [
    {
      id: 'issue-1',
      title: 'Missing Alt Text',
      description: 'Image missing alt attribute.',
      severity: 'medium',
      category: 'seo',
      affectedUrl: 'https://example.com/logo.png',
      recommendation: 'Add descriptive alt text.',
      detectedAt: new Date().toISOString(),
    },
  ],
  pages: [
    {
      id: 'p-1',
      url: 'https://example.com/',
      statusCode: 200,
      responseTimeMs: 85,
      pageSizeBytes: 15400,
      title: 'Example Domain',
      metaDescription: 'An example page.',
      h1: 'Example Header',
      wordCount: 350,
      crawlDepth: 0,
      issueCount: 1,
      crawledAt: new Date().toISOString(),
    },
  ],
  exports: {
    json: '/export/json',
    issuesCsv: '/export/issues.csv',
    pagesCsv: '/export/pages.csv',
  },
  generatedAt: new Date().toISOString(),
};

const markdown = formatReportToMarkdown(mockReport, 'https://example.com');
assert(markdown.includes('92 / 100'), 'Markdown must display overall score');
assert(markdown.includes('Grade: **A**'), 'Markdown must display grade');
assert(markdown.includes('Missing Alt Text'), 'Markdown must list top issues');
assert(markdown.includes('Crawlio Worker Bot'), 'Markdown must have footer attribution');
console.log('   ✅ Markdown Report Formatter verified.\n');

// 2. Build Verification Test
console.log('2. Verifying Worker Bot Feature Exports...');
assert.equal(typeof inspectPage, 'function');
assert.equal(typeof simulateBotAccess, 'function');
assert.equal(typeof auditSitemap, 'function');
assert.equal(typeof formatReportToMarkdown, 'function');
console.log('   ✅ Worker Bot Feature Exports verified.\n');

console.log('🎉 ALL WORKER BOT FEATURE VERIFICATIONS PASSED SUCCESSFULLY!');
