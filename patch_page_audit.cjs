const fs = require('fs');

const code = `
import { CrawlResult } from './crawler';
import { AuditResult, AuditIssue } from '../audit/types';
import { runAllChecks } from './checks/runner';
import { calculateScore } from './scoring';

export function auditPage(crawl: CrawlResult): AuditResult {
  if (!crawl.success || !crawl.data) {
    return {
      score: 0,
      categoryScores: {},
      counts: { critical: 1, high: 0, medium: 0, low: 0 },
      passedChecks: [],
      issues: [{
        id: 'crawl-failed',
        category: 'Technical',
        severity: 'critical',
        title: 'Crawl Failed',
        description: crawl.error || 'Failed to fetch the page.',
        recommendation: 'Check URL and server status.',
        affectedUrl: crawl.url
      }]
    };
  }

  // Add the crawl metadata to the parsed data so checks can use them
  const pageData = {
    ...crawl.data,
    status: crawl.status,
    loadTimeMs: crawl.loadTimeMs,
    pageSizeBytes: crawl.pageSizeBytes,
    securityHeaders: crawl.headers,
    finalUrl: crawl.finalUrl
  };

  const issues = runAllChecks(pageData);
  const scoring = calculateScore(issues);

  return {
    score: scoring.overallScore,
    categoryScores: scoring.categoryScores,
    counts: scoring.counts,
    passedChecks: scoring.passedChecks,
    issues: issues
  };
}

export function auditFullCrawl(crawls: CrawlResult[]): { overallScore: number, allIssues: AuditIssue[], pageResults: { url: string, audit: AuditResult }[] } {
  let totalScore = 0;
  const allIssues: AuditIssue[] = [];
  const pageResults: { url: string, audit: AuditResult }[] = [];

  for (const crawl of crawls) {
    const audit = auditPage(crawl);
    totalScore += audit.score;
    allIssues.push(...audit.issues);
    pageResults.push({ url: crawl.url, audit });
  }

  const overallScore = crawls.length > 0 ? Math.round(totalScore / crawls.length) : 0;
  return { overallScore, allIssues, pageResults };
}
`;

fs.writeFileSync('src/lib/seo/page-audit.ts', code);
