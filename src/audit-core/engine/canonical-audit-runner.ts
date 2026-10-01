import type { AuditProfile, AuditNetworkAdapter, SafeFetchOptions } from '../contracts';
import type { ExtractedPageEvidence } from '../extractors/cloudflare-html-extractor';
import { buildSecurityIssues, mapAuditIssue, runAllChecksSafely, AUDIT_CHECK_COUNT } from '../checks';
import { calculateTransparentAuditScore, toReportScoreRecord, buildProvisionalAuditScore, shouldPublishProvisionalScore } from '../scoring';
import { normalizeCrawlUrl, isSameDomain } from '../url';
import { parseRobotsTxt, getSitemapUrlsFromRobots, isBlockedByRobots } from '../robots';
import { parseSitemapXml } from '../sitemap';
import type {
  ResourceAuditDocument,
  ResourceAuditIssue,
  ResourceAuditPage,
  ResourceAuditReport,
  AuditSeverity,
} from '../../lib/audit/resource-types';
import {
  aggregateFailureCounts,
  classifyAuditFailure,
  failureForCode,
  failureForHttpStatus,
  failureProgressMessage,
  type AuditFailure,
} from '../../lib/audit/audit-failures';
import { AUDIT_ENGINE_VERSION, CHECK_REGISTRY_VERSION, SCORING_VERSION } from '../../lib/platform/version';

export interface AuditWriterAdapter {
  addPage: (page: Omit<ResourceAuditPage, 'id'>) => Promise<ResourceAuditPage>;
  addIssue: (issue: Omit<ResourceAuditIssue, 'id' | 'detectedAt'>) => Promise<void>;
  addEvent: (event: {
    type: string;
    message: string;
    affectedUrl?: string;
    category?: string;
    severity?: AuditSeverity;
    progress?: number;
    data?: unknown;
    checkTitle?: string;
  }) => Promise<void>;
  writeProgress: (
    patch: Partial<ResourceAuditDocument>,
    event?: { type: string; message: string; affectedUrl?: string; progress?: number }
  ) => Promise<void>;
  setFinalReport: (report: ResourceAuditReport) => Promise<void>;
  saveCheckpoint?: (checkpoint: { pagesCrawled: number; scheduled: unknown[] }) => Promise<void>;
}

export interface CanonicalAuditRunnerInput {
  auditId: string;
  normalizedUrl: string;
  workerId: string;
  executorType: 'render' | 'cloudflare';
  profile: AuditProfile;
  network: AuditNetworkAdapter;
  extractor: (
    response: Response,
    input: {
      url: string;
      finalUrl: string;
      statusCode: number;
      responseTimeMs: number;
      pageSizeBytes: number;
      contentType: string;
      headers: Record<string, string>;
      depth: number;
      source: string;
    }
  ) => Promise<ExtractedPageEvidence>;
  writer: AuditWriterAdapter;
  checkOwnership?: () => Promise<void>;
}

type QueueItem = {
  url: string;
  depth: number;
  discoveredFrom?: string;
  sourceUrls: string[];
  anchorTexts: string[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runCanonicalAudit(input: CanonicalAuditRunnerInput): Promise<ResourceAuditReport | null> {
  const { auditId, normalizedUrl, workerId, executorType, profile, network, extractor, writer, checkOwnership } = input;
  const startedAt = Date.now();
  const startUrl = normalizeCrawlUrl(normalizedUrl) || normalizedUrl;

  const rootQueueItem: QueueItem = { url: startUrl, depth: 0, sourceUrls: [], anchorTexts: [] };
  const queue: QueueItem[] = [rootQueueItem];
  const queueItems = new Map<string, QueueItem>([[startUrl, rootQueueItem]]);
  const scheduled = new Set<string>([startUrl]);
  const visited = new Set<string>();
  const processedContentUrls = new Set<string>();
  const pages: ResourceAuditPage[] = [];
  const provisionalIssues: ResourceAuditIssue[] = [];
  const failures: AuditFailure[] = [];
  const unavailableChecks: string[] = [];

  let analysedPages = 0;
  let completedChecks = 0;
  let lastProvisionalScoreAt = 0;
  let lastProvisionalScorePages = 0;
  let provisionalIssueSequence = 0;
  let durationLimitReached = false;

  const auditDeadline = startedAt + profile.auditDeadlineMs;
  const candidateLimit = profile.candidateLimit;
  const quotaReached = () => analysedPages >= profile.pageLimit;
  const candidateBudgetReached = () => visited.size >= candidateLimit;
  const coverageTarget = () => Math.max(1, Math.min(profile.pageLimit, scheduled.size));

  const addIssue = async (issue: Omit<ResourceAuditIssue, 'id' | 'detectedAt'>) => {
    provisionalIssueSequence += 1;
    provisionalIssues.push({
      ...issue,
      id: `provisional-${provisionalIssueSequence}`,
      detectedAt: nowIso(),
    });
    await writer.addIssue(issue);
  };

  const recordFailure = async (failure: AuditFailure, item: QueueItem, storePage = true) => {
    failures.push(failure);
    const severity: AuditSeverity =
      failure.code === 'CHECK_UNAVAILABLE' || failure.code === 'AUDIT_DEADLINE_EXCEEDED'
        ? 'info'
        : failure.category === 'tls' ||
          failure.code === 'HTTP_403' ||
          failure.code === 'HTTP_404' ||
          failure.code.startsWith('HTTP_5') ||
          failure.category === 'dns'
        ? 'high'
        : 'medium';

    await addIssue({
      severity,
      category: failure.category === 'http' || failure.category === 'redirect' ? 'technical' : failure.category,
      title: failure.safeTitle,
      description: failure.safeExplanation,
      affectedUrl: failure.affectedUrl,
      evidence: failure.httpStatus ? `HTTP status ${failure.httpStatus}` : 'The audit could not collect usable page evidence.',
      recommendation: failure.suggestedAction,
      checkId: `failure:${failure.code.toLowerCase()}`,
      failureCode: failure.code,
      findingKey: `${failure.code}|${failure.affectedUrl}`.toLowerCase(),
      sourceUrls: item.sourceUrls,
      affectedPageCount: Math.max(1, item.sourceUrls.length),
    });

    if (storePage) {
      const pageRecord = await writer.addPage({
        url: failure.affectedUrl,
        statusCode: failure.httpStatus || 0,
        responseTimeMs: 0,
        pageSizeBytes: 0,
        title: '',
        metaDescription: '',
        h1: '',
        canonicalUrl: '',
        siteName: '',
        faviconUrl: '',
        openGraphImage: '',
        themeColor: '',
        screenshotUrl: '',
        fetchStatus: failure.code === 'ROBOTS_BLOCKED' ? 'blocked' : 'failed',
        failureCode: failure.code,
        failureCategory: failure.category,
        safeTitle: failure.safeTitle,
        safeExplanation: failure.safeExplanation,
        suggestedAction: failure.suggestedAction,
        retryable: failure.retryable,
        attemptCount: failure.attemptCount,
        recoveredAfterRetry: failure.recoveredAfterRetry,
        sourceUrl: item.sourceUrls[0] || item.discoveredFrom,
        anchorText: item.anchorTexts[0] || '',
        wordCount: 0,
        crawlDepth: item.depth,
        issueCount: 1,
        crawledAt: nowIso(),
      });
      pages.push(pageRecord);
    }
  };

  const maybePublishProvisionalScore = async (force = false) => {
    const nowMs = Date.now();
    if (
      !shouldPublishProvisionalScore({
        pagesAnalysed: analysedPages,
        lastPublishedPages: lastProvisionalScorePages,
        nowMs,
        lastPublishedAtMs: lastProvisionalScoreAt,
        force,
      })
    ) {
      return;
    }

    const snapshot = buildProvisionalAuditScore({
      issues: provisionalIssues,
      pages,
      pagesAnalysed: analysedPages,
      pagesDiscovered: scheduled.size,
      pageLimit: profile.pageLimit,
      unavailableChecks,
      updatedAt: new Date(nowMs).toISOString(),
    });

    if (snapshot.overallScore == null) return;
    lastProvisionalScoreAt = nowMs;
    lastProvisionalScorePages = analysedPages;

    await writer.addEvent({
      type: 'score_updated',
      message: `Preliminary score updated from ${analysedPages} analysed pages.`,
      progress: Math.min(90, 20 + Math.floor((analysedPages / coverageTarget()) * 70)),
      data: snapshot,
    });
  };

  const enqueuePage = async (url: string, depth: number, discoveredFrom: string, anchorText = '') => {
    const cleanUrl = normalizeCrawlUrl(url, discoveredFrom);
    if (!cleanUrl) return false;
    const existing = queueItems.get(cleanUrl);
    if (existing) {
      if (!existing.sourceUrls.includes(discoveredFrom)) existing.sourceUrls.push(discoveredFrom);
      if (anchorText && !existing.anchorTexts.includes(anchorText)) existing.anchorTexts.push(anchorText);
      return false;
    }
    if (scheduled.size >= candidateLimit || scheduled.has(cleanUrl)) return false;
    if (!isSameDomain(cleanUrl, normalizedUrl)) return false;

    scheduled.add(cleanUrl);
    const item: QueueItem = {
      url: cleanUrl,
      depth,
      discoveredFrom,
      sourceUrls: [discoveredFrom],
      anchorTexts: anchorText ? [anchorText] : [],
    };
    queueItems.set(cleanUrl, item);
    queue.push(item);
    return true;
  };

  // Phase 1: Audit Initiation
  await writer.writeProgress(
    {
      status: 'running',
      progress: 5,
      pageLimit: profile.pageLimit,
      currentPhase: 'Preparing your audit',
      currentUrl: normalizedUrl,
      currentCheck: 'URL normalization',
    },
    { type: 'audit_started', message: `Audit started via ${executorType} executor` }
  );

  if (checkOwnership) await checkOwnership();

  // Phase 2: Robots.txt Access Rules
  const origin = new URL(normalizedUrl).origin;
  await writer.writeProgress(
    {
      progress: 10,
      currentPhase: 'Discovering pages',
      currentUrl: `${origin}/robots.txt`,
      currentCheck: 'robots.txt',
    },
    { type: 'robots_fetching', message: 'Checking search engine access rules' }
  );

  let robotsRules: ReturnType<typeof parseRobotsTxt> | null = null;
  try {
    const robotsResponse = await network.fetchSafe(`${origin}/robots.txt`, {
      timeoutMs: profile.fetchTimeoutMs,
      maxRedirects: profile.redirectLimit,
      maxBytes: 512_000,
      allowedContentTypes: ['text/plain', 'text/html'],
    });
    if (robotsResponse.status >= 200 && robotsResponse.status < 300) {
      robotsRules = parseRobotsTxt(robotsResponse.body);
    }
  } catch {}

  // Phase 3: Sitemap Discovery
  await writer.writeProgress(
    {
      progress: 14,
      currentPhase: 'Discovering pages',
      currentUrl: `${origin}/sitemap.xml`,
      currentCheck: 'sitemap.xml',
    },
    { type: 'sitemap_fetching', message: 'Looking for sitemap URLs' }
  );

  const sitemapCandidates = [
    ...(robotsRules ? robotsRules.sitemaps : []),
    `${origin}/sitemap.xml`,
  ];
  if (profile.deepSitemapExpansion) {
    sitemapCandidates.push(
      `${origin}/sitemap_index.xml`,
      `${origin}/page-sitemap.xml`,
      `${origin}/post-sitemap.xml`,
      `${origin}/product-sitemap.xml`
    );
  }

  const sitemapQueue = [...new Set(sitemapCandidates)];
  const visitedSitemaps = new Set<string>();
  while (sitemapQueue.length && visitedSitemaps.size < profile.sitemapDocumentLimit && scheduled.size < candidateLimit) {
    const sitemapUrl = normalizeCrawlUrl(sitemapQueue.shift()!);
    if (!sitemapUrl || visitedSitemaps.has(sitemapUrl) || !isSameDomain(sitemapUrl, normalizedUrl)) continue;
    visitedSitemaps.add(sitemapUrl);
    try {
      const sitemapResp = await network.fetchSafe(sitemapUrl, {
        timeoutMs: profile.fetchTimeoutMs,
        maxRedirects: profile.redirectLimit,
        maxBytes: profile.maxResponseBytes,
        allowedContentTypes: ['application/xml', 'text/xml', 'text/plain', 'application/xhtml+xml'],
      });
      if (sitemapResp.status >= 200 && sitemapResp.status < 300) {
        const sitemapDoc = parseSitemapXml(sitemapResp.body);
        for (const nested of sitemapDoc.sitemaps) {
          const normNested = normalizeCrawlUrl(nested, sitemapUrl);
          if (normNested && isSameDomain(normNested, normalizedUrl) && !visitedSitemaps.has(normNested)) {
            sitemapQueue.push(normNested);
          }
        }
        for (const pageUrl of sitemapDoc.urls) {
          if (scheduled.size >= candidateLimit) break;
          await enqueuePage(pageUrl, 1, sitemapUrl);
        }
      }
    } catch {}
  }

  // Phase 4: Crawl Frontier Execution
  await writer.writeProgress({
    progress: 20,
    currentPhase: 'Checking page content',
    pageLimit: profile.pageLimit,
    pagesDiscovered: scheduled.size,
    checksTotal: coverageTarget() * (AUDIT_CHECK_COUNT + 2),
    checksCompleted: completedChecks,
  });

  async function processPage(item: QueueItem): Promise<void> {
    if (Date.now() >= auditDeadline) {
      durationLimitReached = true;
      return;
    }
    const currentUrl = normalizeCrawlUrl(item.url) || item.url;
    if (visited.has(currentUrl) || processedContentUrls.has(currentUrl) || candidateBudgetReached() || quotaReached()) {
      return;
    }
    visited.add(currentUrl);

    if (robotsRules && isBlockedByRobots(currentUrl, robotsRules)) {
      await recordFailure(failureForCode('ROBOTS_BLOCKED', { affectedUrl: currentUrl }), item);
      return;
    }

    if (checkOwnership) await checkOwnership();

    const fetchOptions: SafeFetchOptions = {
      timeoutMs: profile.fetchTimeoutMs,
      maxRedirects: profile.redirectLimit,
      maxBytes: profile.maxResponseBytes,
      allowedContentTypes: ['text/html', 'application/xhtml+xml'],
    };

    let fetchResp;
    try {
      fetchResp = await network.fetchSafe(currentUrl, fetchOptions);
    } catch (error) {
      const failure = classifyAuditFailure(error, { affectedUrl: currentUrl, attemptCount: 1 });
      await recordFailure(failure, item);
      return;
    }

    const finalContentUrl = normalizeCrawlUrl(fetchResp.finalUrl) || fetchResp.finalUrl;
    if (processedContentUrls.has(finalContentUrl)) {
      return;
    }
    processedContentUrls.add(finalContentUrl);

    if (fetchResp.status >= 400) {
      await recordFailure(failureForHttpStatus(fetchResp.status, { affectedUrl: fetchResp.finalUrl }), item);
      return;
    }
    if (!fetchResp.body.trim()) {
      await recordFailure(failureForCode('EMPTY_RESPONSE', { affectedUrl: fetchResp.finalUrl }), item);
      return;
    }

    completedChecks += 1;

    // Extract PageEvidence using the canonical extractor
    const responseObj = new Response(fetchResp.body, {
      status: fetchResp.status,
      headers: fetchResp.headers,
    });
    const evidence = await extractor(responseObj, {
      url: currentUrl,
      finalUrl: fetchResp.finalUrl,
      statusCode: fetchResp.status,
      responseTimeMs: fetchResp.durationMs,
      pageSizeBytes: fetchResp.bodyBytes,
      contentType: fetchResp.contentType,
      headers: fetchResp.headers,
      depth: item.depth,
      source: item.discoveredFrom || 'crawl',
    });

    // Run SEO Checks
    const checkRun = runAllChecksSafely(evidence);
    const seoIssues = checkRun.issues.map((i) => mapAuditIssue(i, fetchResp.finalUrl));
    for (const issue of seoIssues) {
      if (checkOwnership) await checkOwnership();
      await addIssue(issue);
    }
    completedChecks += checkRun.completedChecks;

    // Run Security Checks
    const securityIssues = buildSecurityIssues({
      finalUrl: fetchResp.finalUrl,
      headers: fetchResp.headers,
      parsed: evidence,
    });
    for (const issue of securityIssues) {
      if (checkOwnership) await checkOwnership();
      await addIssue(issue);
    }
    completedChecks += 1;

    // Record analysed page
    const pageRecord = await writer.addPage({
      url: fetchResp.finalUrl,
      statusCode: fetchResp.status,
      responseTimeMs: fetchResp.durationMs,
      pageSizeBytes: fetchResp.bodyBytes,
      title: evidence.title || '',
      metaDescription: evidence.metaDescription || '',
      h1: evidence.h1?.[0] || '',
      canonicalUrl: evidence.canonical || '',
      siteName: evidence.siteName || '',
      faviconUrl: evidence.faviconUrl || '',
      openGraphImage: evidence.ogImage || '',
      themeColor: evidence.themeColor || '',
      screenshotUrl: '',
      fetchStatus: 'success',
      retryable: false,
      attemptCount: 1,
      recoveredAfterRetry: false,
      sourceUrl: item.discoveredFrom,
      anchorText: '',
      wordCount: evidence.wordCount || 0,
      crawlDepth: item.depth,
      issueCount: seoIssues.length + securityIssues.length,
      crawledAt: nowIso(),
    });
    pages.push(pageRecord);
    analysedPages += 1;

    await maybePublishProvisionalScore();

    // Enqueue newly discovered internal links
    for (const link of evidence.internalLinks) {
      if (scheduled.size >= candidateLimit) break;
      await enqueuePage(link.href, item.depth + 1, fetchResp.finalUrl, link.text);
    }

    if (writer.saveCheckpoint && analysedPages % 5 === 0) {
      await writer.saveCheckpoint({
        pagesCrawled: analysedPages,
        scheduled: Array.from(queueItems.values()).slice(0, 100),
      });
    }
  }

  // Process queue bounded by concurrency
  let active = 0;
  await new Promise<void>((resolve, reject) => {
    const pump = () => {
      if (Date.now() >= auditDeadline) durationLimitReached = true;
      while (
        !durationLimitReached &&
        !quotaReached() &&
        !candidateBudgetReached() &&
        active < profile.concurrency &&
        analysedPages + active < profile.pageLimit &&
        queue.length > 0
      ) {
        const item = queue.shift()!;
        active++;
        processPage(item)
          .catch(reject)
          .finally(() => {
            active--;
            if ((durationLimitReached || quotaReached() || candidateBudgetReached() || queue.length === 0) && active === 0) {
              resolve();
            } else {
              pump();
            }
          });
      }
      if ((durationLimitReached || quotaReached() || candidateBudgetReached() || queue.length === 0) && active === 0) {
        resolve();
      }
    };
    pump();
  });

  if (analysedPages === 0) {
    const primaryFailure = failures[0] || failureForCode('UNKNOWN_TARGET_FAILURE', { affectedUrl: normalizedUrl });
    await writer.writeProgress({
      status: 'failed',
      progress: 100,
      currentPhase: 'Audit could not collect usable evidence',
      currentUrl: null,
      currentCheck: null,
      pagesCrawled: 0,
      warningCount: failures.length,
      failureCounts: aggregateFailureCounts(failures),
      error: `${primaryFailure.safeTitle}. ${primaryFailure.safeExplanation}`,
      completedAt: nowIso(),
      lockedBy: null,
    });
    return null;
  }

  // Phase 5: Final Scoring & Report Generation
  const transparentScore = calculateTransparentAuditScore({
    issues: provisionalIssues,
    pages,
    unavailableChecks: {
      mobile: ['Browser-rendered Core Web Vitals were not collected.'],
      technical: unavailableChecks,
    },
    limitations: [`Audit limited crawl to at most ${profile.pageLimit} pages.`],
  });

  const overallScore = transparentScore.overall ?? 0;
  const crawlStopReason = quotaReached()
    ? 'page_limit_reached'
    : durationLimitReached
    ? 'audit_deadline_reached'
    : candidateBudgetReached()
    ? 'safety_limit_reached'
    : 'crawl_queue_exhausted';

  const report: ResourceAuditReport = {
    scores: {
      ...toReportScoreRecord(transparentScore),
      auditEngineVersion: AUDIT_ENGINE_VERSION,
      scoringVersion: SCORING_VERSION,
      checkRegistryVersion: CHECK_REGISTRY_VERSION,
      executor: executorType,
      warningSummary: aggregateFailureCounts(failures),
      coverage: {
        pagesDiscovered: scheduled.size,
        pagesAttempted: visited.size,
        pagesAnalysed: analysedPages,
        coveragePercent: Math.round((analysedPages / coverageTarget()) * 100),
        pageLimit: profile.pageLimit,
        stopReason: crawlStopReason,
      },
    },
    summary: `Audit completed: analysed ${analysedPages} pages with ${provisionalIssues.length} issues and ${failures.length} warnings.`,
    topIssues: [...provisionalIssues]
      .sort((a, b) => {
        const weights = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
        return weights[b.severity] - weights[a.severity];
      })
      .slice(0, 25),
    pages,
    exports: {
      json: `/api/tools/audit/export/${auditId}/json`,
      issuesCsv: `/api/tools/audit/export/${auditId}/issues.csv`,
      pagesCsv: `/api/tools/audit/export/${auditId}/pages.csv`,
    },
    generatedAt: nowIso(),
  };

  await writer.setFinalReport(report);

  const completedStatus = failures.length ? 'completed_with_warnings' : 'completed';
  await writer.writeProgress(
    {
      status: completedStatus,
      progress: 100,
      currentPhase: failures.length ? 'Report ready with warnings' : 'Report ready',
      currentUrl: null,
      currentCheck: null,
      pagesCrawled: analysedPages,
      checksTotal: Math.max(completedChecks, coverageTarget() * (AUDIT_CHECK_COUNT + 2)),
      checksCompleted: completedChecks,
      warningCount: failures.length,
      failureCounts: aggregateFailureCounts(failures),
      completedAt: nowIso(),
      lockedBy: null,
      lockedAt: null,
      leaseExpiresAt: null,
    },
    {
      type: failures.length ? 'audit_completed_with_warnings' : 'audit_completed',
      message: `Audit completed in ${Math.max(1, Math.round((Date.now() - startedAt) / 1000))}s via ${executorType}`,
      progress: 100,
    }
  );

  return report;
}
