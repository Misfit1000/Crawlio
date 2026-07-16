import type { Page } from '@playwright/test';

export const AUDIT_ID = '11111111-1111-4111-8111-111111111111';
const timestamp = '2026-07-16T10:00:00.000Z';

export function auditSnapshot(status: 'queued' | 'running' | 'completed' = 'completed') {
  const terminal = status === 'completed';
  const running = status === 'running';
  const audit = {
    id: AUDIT_ID,
    userId: null,
    guestKeyHash: 'fixture',
    projectId: null,
    submittedInput: 'https://example.com/a/very-long-but-valid-page-address-for-layout-verification',
    normalizedUrl: 'https://example.com/a/very-long-but-valid-page-address-for-layout-verification',
    finalUrl: 'https://example.com/',
    hostname: 'example.com',
    mode: 'quick',
    plan: 'free',
    requestedMode: 'quick',
    effectiveMode: 'quick',
    queuePriority: 10,
    processingTier: 'free',
    quotaCounted: true,
    workerRuntime: terminal || running ? 'node' : null,
    estimatedWaitSeconds: 2,
    status,
    progress: terminal ? 100 : running ? 45 : 0,
    currentPhase: terminal ? 'Report ready' : running ? 'Checking pages' : 'Queued',
    currentUrl: terminal ? null : 'https://example.com/',
    currentCheck: terminal ? null : running ? 'Page titles' : null,
    pageLimit: 5,
    pagesDiscovered: terminal ? 2 : 1,
    pagesCrawled: terminal ? 2 : running ? 1 : 0,
    checksTotal: 10,
    checksCompleted: terminal ? 10 : running ? 4 : 0,
    issuesFound: terminal ? 1 : 0,
    criticalCount: 0,
    highCount: terminal ? 1 : 0,
    mediumCount: 0,
    lowCount: 0,
    createdAt: timestamp,
    updatedAt: terminal ? '2026-07-16T10:00:12.000Z' : timestamp,
    startedAt: status === 'queued' ? null : '2026-07-16T10:00:02.000Z',
    completedAt: terminal ? '2026-07-16T10:00:12.000Z' : null,
    expiresAt: '2026-08-16T10:00:00.000Z',
    cancelledAt: null,
    error: null,
    lockedBy: terminal ? null : running ? 'fixture-worker' : null,
    lockedAt: running ? '2026-07-16T10:00:02.000Z' : null,
    leaseExpiresAt: running ? '2026-07-16T10:01:02.000Z' : null,
    usedHttpFallback: false,
    warningCount: 0,
    failureCounts: {},
  };
  const issue = {
    id: 'missing-title',
    severity: 'high',
    category: 'on_page',
    title: 'Missing page title',
    description: 'The page does not provide a descriptive title.',
    affectedUrl: 'https://example.com/a/very-long-but-valid-page-address-for-layout-verification',
    evidence: 'No title element was found.',
    recommendation: 'Add a concise, descriptive page title.',
    checkId: 'title.presence',
    findingKey: 'title.presence|https://example.com/a/very-long-but-valid-page-address-for-layout-verification',
    sourceUrls: [],
    affectedPageCount: 1,
    detectedAt: timestamp,
  };
  const pages = terminal ? [{
    id: 'page-1', url: 'https://example.com/', statusCode: 200, responseTimeMs: 120, pageSizeBytes: 12000,
    title: 'Example Domain', metaDescription: 'A deterministic E2E fixture.', h1: 'Example Domain', canonicalUrl: 'https://example.com/',
    siteName: 'Example', faviconUrl: '', openGraphImage: '', themeColor: '#2563eb', screenshotUrl: '', fetchStatus: 'success',
    wordCount: 320, crawlDepth: 0, issueCount: 1, crawledAt: timestamp,
  }] : [];
  return {
    audit,
    latestEvents: [{ id: `event-${status}`, type: terminal ? 'audit_completed' : 'progress_update', timestamp, message: audit.currentPhase, phase: audit.currentPhase, progress: audit.progress }],
    latestPages: pages,
    latestIssues: terminal ? [issue] : [],
    finalReport: terminal ? {
      scores: { overall: 82, onPage: 78, technical: 88, performance: 84, security: 90, crawlability: 86, scoreState: 'final', coverage: { pagesAnalysed: 2, pageLimit: 5 } },
      summary: 'The fixture audit completed with one high-priority issue.',
      topIssues: [issue],
      pages,
      exports: { json: '', issuesCsv: '', pagesCsv: '' },
      generatedAt: '2026-07-16T10:00:12.000Z',
    } : null,
  };
}

export async function mockBlogApi(page: Page) {
  await page.route('**/api/tools/blog/posts**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: { posts: [], total: 0, limit: 9, offset: 0 } }),
  }));
}

export async function expectNoHorizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}
