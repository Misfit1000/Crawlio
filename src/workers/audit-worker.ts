import { parseHtml, type ParsedPageData } from '../lib/seo/html-parser';
import { pathToFileURL } from 'node:url';
import { fetchRobotsTxt, getSitemapUrlsFromRobots, isBlockedByRobots, parseRobotsTxt } from '../lib/seo/robots';
import { fetchSitemap } from '../lib/seo/sitemap';
import { isSameDomain, normalizeUrl, stripTrackingParams } from '../lib/seo/url-utils';
import { AUDIT_CHECK_COUNT, runAllChecksSafely } from '../lib/seo/checks/runner';
import { auditRepository } from '../lib/supabase/audit-repository';
import { startWorkerHealthServer } from './audit-worker-health';
import {
  WORKER_ENV_ERROR,
  buildWorkerHeartbeat,
  createInitialWorkerState,
  loadWorkerConfig,
  updateWorkerState,
  type AuditWorkerRuntimeState,
} from './audit-worker-runtime';
import { getAuditProfileForDocument, isSeoIssueAllowedForProfile } from '../lib/audit/audit-profiles';
import {
  type AuditSeverity,
  type ResourceAuditDocument,
  type ResourceAuditIssue,
  type ResourceAuditPage,
  type ResourceAuditReport,
} from '../lib/audit/resource-types';
import { AUDIT_LIMITS } from '../lib/audit/audit-config';
import { isTerminalAuditStatus } from '../lib/audit/audit-time';
import type { AuditIssue } from '../lib/audit/types';
import { safePublicFetch, type SafePublicFetchOptions } from '../lib/security/safe-public-fetch';
import { calculateTransparentAuditScore, toReportScoreRecord } from '../lib/audit/audit-scoring';
import { AuditWriteBatch } from './audit-write-batch';
import { HostRequestScheduler } from './host-request-scheduler';
import { isAuditJobType } from './audit-job-types';
import { AUDIT_ENGINE_VERSION, CHECK_REGISTRY_VERSION, SCORING_VERSION } from '../lib/platform/version';
import {
  aggregateFailureCounts,
  classifyAuditFailure,
  failureForCode,
  failureForHttpStatus,
  failureProgressMessage,
  type AuditFailure,
} from '../lib/audit/audit-failures';

type QueueItem = { url: string; depth: number; discoveredFrom?: string; sourceUrls: string[]; anchorTexts: string[] };
const NO_QUEUED_LOG_INTERVAL_MS = 30_000;

type FetchedPage = {
  url: string;
  finalUrl: string;
  statusCode: number;
  responseTimeMs: number;
  pageSizeBytes: number;
  headers: Record<string, string>;
  contentType: string;
  html: string;
  parsed: ParsedPageData | null;
};

type FetchAttemptResult = { page: FetchedPage; attemptCount: number; recoveredAfterRetry: boolean };

class RetriedFetchError extends Error {
  constructor(readonly original: unknown, readonly attemptCount: number) {
    super(original instanceof Error ? original.message : String(original || 'Fetch failed'));
    this.name = 'RetriedFetchError';
  }
}

function nowIso() {
  return new Date().toISOString();
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toSeverity(value: string | undefined): AuditSeverity {
  if (value === 'critical' || value === 'high' || value === 'medium' || value === 'low' || value === 'info') {
    return value;
  }
  return 'medium';
}

function mapAuditIssue(issue: AuditIssue, fallbackUrl: string): Omit<ResourceAuditIssue, 'id' | 'detectedAt'> {
  const affectedUrl = issue.affectedUrl || fallbackUrl;
  return {
    severity: toSeverity(issue.severity),
    category: String(issue.category || 'seo'),
    title: issue.title || 'Audit issue',
    description: issue.description || issue.title || 'Audit issue detected.',
    affectedUrl,
    evidence: issue.evidence || issue.element || '',
    recommendation: issue.recommendation || 'Review this item and update the affected page.',
    checkId: issue.id,
    findingKey: `${issue.id}|${affectedUrl}`.toLowerCase(),
    sourceUrls: [],
    affectedPageCount: 1,
  };
}

function buildSecurityIssues(page: FetchedPage): Omit<ResourceAuditIssue, 'id' | 'detectedAt'>[] {
  const issues: Omit<ResourceAuditIssue, 'id' | 'detectedAt'>[] = [];
  const headers = page.headers;
  const add = (severity: AuditSeverity, title: string, evidence: string, recommendation: string) => {
    issues.push({
      severity,
      category: 'security',
      title,
      description: title,
      affectedUrl: page.finalUrl,
      evidence,
      recommendation,
    });
  };

  if (!page.finalUrl.startsWith('https://')) {
    add('high', 'Page is not served over HTTPS', page.finalUrl, 'Serve all public pages over HTTPS and redirect HTTP to HTTPS.');
  }
  if (!headers['strict-transport-security'] && page.finalUrl.startsWith('https://')) {
    add('medium', 'Missing HSTS header', 'strict-transport-security header not present', 'Add a Strict-Transport-Security header after HTTPS is stable.');
  }
  if (!headers['content-security-policy']) {
    add('medium', 'Missing Content-Security-Policy header', 'content-security-policy header not present', 'Add a CSP that restricts scripts, frames, images, and form targets.');
  }
  if (!headers['x-frame-options'] && !headers['content-security-policy']?.includes('frame-ancestors')) {
    add('medium', 'Missing clickjacking protection', 'x-frame-options/frame-ancestors not present', 'Add X-Frame-Options or a CSP frame-ancestors directive.');
  }
  if (!headers['x-content-type-options']) {
    add('low', 'Missing X-Content-Type-Options header', 'x-content-type-options header not present', 'Add X-Content-Type-Options: nosniff.');
  }
  if (!headers['referrer-policy']) {
    add('low', 'Missing Referrer-Policy header', 'referrer-policy header not present', 'Add a privacy-aware Referrer-Policy header.');
  }
  if (!headers['permissions-policy']) {
    add('low', 'Missing Permissions-Policy header', 'permissions-policy header not present', 'Add a Permissions-Policy header for unused browser features.');
  }
  if (page.finalUrl.startsWith('https://') && /(?:src|href)=["']http:\/\//i.test(page.html)) {
    add('medium', 'Mixed content references detected', 'HTML references http:// assets from an HTTPS page', 'Update insecure asset references to HTTPS.');
  }
  if (/<form[^>]+action=["']http:\/\//i.test(page.html)) {
    add('high', 'Insecure form action detected', 'Form posts to an http:// endpoint', 'Use HTTPS form actions for all public forms.');
  }

  return issues;
}

function workerFetchOptions(timeoutMs: number): SafePublicFetchOptions {
  const allowPrivateForTesting = process.env.SEOINTEL_ALLOW_PRIVATE_TEST_TARGETS === 'true';
  return {
    timeoutMs,
    dnsTimeoutMs: 3_000,
    maxRedirects: 5,
    maxBytes: Number(process.env.AUDIT_MAX_HTML_BYTES || 2_000_000),
    allowedContentTypes: ['text/html', 'application/xhtml+xml'],
    allowPrivateForTesting,
    allowNonStandardPortsForTesting: allowPrivateForTesting,
  };
}

async function fetchHtmlPage(url: string, timeoutMs: number): Promise<FetchedPage> {
  const response = await safePublicFetch(url, workerFetchOptions(timeoutMs));
  let parsed: ParsedPageData | null = null;
  if (response.body) {
    try {
      parsed = parseHtml(response.body, response.finalUrl);
    } catch (error) {
      const parseError = new Error(error instanceof Error ? error.message : 'HTML parsing failed.');
      (parseError as Error & { code: string }).code = 'INVALID_HTML_RESPONSE';
      throw parseError;
    }
  }
  return {
    url,
    finalUrl: response.finalUrl,
    statusCode: response.status,
    responseTimeMs: response.durationMs,
    pageSizeBytes: response.bodyBytes,
    headers: response.headers,
    contentType: response.contentType,
    html: response.body,
    parsed,
  };
}

function shouldRetryStatus(status: number) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

async function fetchPageWithRetry(
  url: string,
  timeoutMs: number,
  scheduler: HostRequestScheduler,
  maxAttempts = 2,
): Promise<FetchAttemptResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const page = await scheduler.schedule(url, () => fetchHtmlPage(url, timeoutMs));
      if (shouldRetryStatus(page.statusCode) && attempt < maxAttempts) {
        await wait(200 * attempt);
        continue;
      }
      return { page, attemptCount: attempt, recoveredAfterRetry: attempt > 1 };
    } catch (error) {
      lastError = error;
      const failure = classifyAuditFailure(error, { affectedUrl: url, attemptCount: attempt });
      if (!failure.retryable || attempt >= maxAttempts) throw new RetriedFetchError(error, attempt);
      await wait(200 * attempt);
    }
  }
  throw new RetriedFetchError(lastError, maxAttempts);
}

async function ensureWorkerOwnership(auditId: string, workerId: string) {
  const audit = await auditRepository.getAudit(auditId);
  if (audit?.status === 'cancelled') {
    throw new Error('AUDIT_CANCELLED');
  }
  if (!audit || audit.status !== 'running' || audit.lockedBy !== workerId) {
    throw new Error('AUDIT_OWNERSHIP_LOST');
  }
}

function normalizeCrawlUrl(input: string, base?: string) {
  const normalized = normalizeUrl(input, base);
  if (!normalized) return null;
  const url = new URL(stripTrackingParams(normalized));
  url.hash = '';
  return url.toString();
}

async function processAuditJob(audit: ResourceAuditDocument, writer: AuditWriteBatch, workerId: string) {
  const config = getAuditProfileForDocument(audit);
  const startUrl = normalizeCrawlUrl(audit.normalizedUrl) || audit.normalizedUrl;
  const rootQueueItem: QueueItem = { url: startUrl, depth: 0, sourceUrls: [], anchorTexts: [] };
  const queue: QueueItem[] = [rootQueueItem];
  const queueItems = new Map<string, QueueItem>([[startUrl, rootQueueItem]]);
  const scheduled = new Set<string>([startUrl]);
  const visited = new Set<string>();
  const pages: ResourceAuditPage[] = [];
  const failures: AuditFailure[] = [];
  const unavailableChecks: string[] = [];
  const announcedFailureCodes = new Set<string>();
  let analysedPages = 0;
  let completedChecks = 0;
  const workerStart = nowIso();
  const requestScheduler = new HostRequestScheduler(Math.min(2, config.concurrency), 150);
  const auditDeadline = Date.now() + Math.min(10 * 60_000, Math.max(45_000, config.pageLimit * config.timeoutMs));
  let durationLimitReached = false;
  const writeProgress = (
    patch: Partial<ResourceAuditDocument>,
    event?: Parameters<AuditWriteBatch['writeProgress']>[1],
    options?: Parameters<AuditWriteBatch['writeProgress']>[2],
  ) => writer.writeProgress(patch, event, options);
  const addIssue = (issue: Omit<ResourceAuditIssue, 'id' | 'detectedAt'>) => writer.addIssue(issue);

  const recordFailure = async (failure: AuditFailure, item: QueueItem, storePage = true) => {
    failures.push(failure);
    const counts = aggregateFailureCounts(failures);
    const severity: AuditSeverity = failure.code === 'CHECK_UNAVAILABLE' || failure.code === 'AUDIT_DEADLINE_EXCEEDED'
      ? 'info'
      : failure.category === 'tls' || failure.code === 'HTTP_403' || failure.code === 'HTTP_404' || failure.code.startsWith('HTTP_5') || failure.category === 'dns'
        ? 'high'
        : 'medium';

    await auditRepository.addInternalDiagnostic({
      auditId: audit.id,
      affectedUrl: failure.affectedUrl,
      failureCode: failure.code,
      phase: failure.category,
      attemptCount: failure.attemptCount,
      requestDurationMs: null,
      workerId: audit.lockedBy,
      internalDetails: failure.internalDetails,
    });

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
        title: '', metaDescription: '', h1: '', canonicalUrl: '', siteName: '', faviconUrl: '', openGraphImage: '', themeColor: '', screenshotUrl: '',
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

    if (!announcedFailureCodes.has(failure.code)) {
      announcedFailureCodes.add(failure.code);
      await writer.addEvent({
        type: 'page_warning',
        message: failureProgressMessage(failure, 1),
        affectedUrl: failure.affectedUrl,
        category: failure.category,
        severity,
        data: { safeTitle: failure.safeTitle, suggestedAction: failure.suggestedAction },
      });
    }
    await writeProgress({ warningCount: failures.length, failureCounts: counts });
  };

  async function enqueuePage(url: string, depth: number, discoveredFrom: string, anchorText = '') {
    const cleanUrl = normalizeCrawlUrl(url, discoveredFrom);
    if (!cleanUrl) return false;
    const existing = queueItems.get(cleanUrl);
    if (existing) {
      if (!existing.sourceUrls.includes(discoveredFrom)) existing.sourceUrls.push(discoveredFrom);
      if (anchorText && !existing.anchorTexts.includes(anchorText)) existing.anchorTexts.push(anchorText);
      return false;
    }
    if (scheduled.size >= config.pageLimit || scheduled.has(cleanUrl)) return false;
    if (!isSameDomain(cleanUrl, audit.normalizedUrl)) return false;
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
    await writer.addEvent({
      type: 'page_discovered',
      message: `Discovered ${cleanUrl}`,
      affectedUrl: cleanUrl,
      progress: 18,
      data: { discoveredFrom, crawlDepth: depth },
    });
    return true;
  }

  await writeProgress({
    status: 'running',
    progress: 5,
    currentPhase: 'Preparing your audit',
    currentUrl: audit.normalizedUrl,
    currentCheck: 'URL normalization',
  }, { type: 'audit_started', message: 'Audit started' }, { force: true });
  await writer.addEvent({
    type: 'url_normalized',
    message: `Website address confirmed as ${audit.normalizedUrl}`,
    affectedUrl: audit.normalizedUrl,
    progress: 8,
  });

  await ensureWorkerOwnership(audit.id, workerId);

  const origin = new URL(audit.normalizedUrl).origin;
  await writeProgress({
    progress: 10,
    currentPhase: 'Discovering pages',
    currentUrl: new URL('/robots.txt', origin).toString(),
    currentCheck: 'robots.txt',
  }, { type: 'robots_fetching', message: 'Checking search engine access rules' });
  const robotsTxt = await fetchRobotsTxt(origin, workerFetchOptions(config.timeoutMs));
  const robotsRules = robotsTxt ? parseRobotsTxt(robotsTxt) : null;

  await writeProgress({
    progress: 14,
    currentPhase: 'Discovering pages',
    currentUrl: new URL('/sitemap.xml', origin).toString(),
    currentCheck: 'sitemap.xml',
  }, { type: 'sitemap_fetching', message: 'Looking for sitemap URLs' });

  const sitemapCandidates = [
    ...getSitemapUrlsFromRobots(robotsTxt),
    new URL('/sitemap.xml', origin).toString(),
  ];
  if (config.deepSitemapExpansion) {
    sitemapCandidates.push(
      new URL('/sitemap_index.xml', origin).toString(),
      new URL('/page-sitemap.xml', origin).toString(),
      new URL('/post-sitemap.xml', origin).toString(),
      new URL('/product-sitemap.xml', origin).toString(),
    );
    await writer.addEvent({
      type: 'deep_crawl_expansion',
      message: 'Deep audit enabled expanded sitemap discovery and crawl graph coverage.',
      progress: 16,
      data: { pageLimit: config.pageLimit, sitemapCandidates: sitemapCandidates.length },
    });
  }
  for (const sitemapUrl of sitemapCandidates) {
    if (scheduled.size >= config.pageLimit) break;
    const sitemap = await fetchSitemap(sitemapUrl, workerFetchOptions(config.timeoutMs));
    for (const sitemapPageUrl of sitemap.urls) {
      if (scheduled.size >= config.pageLimit) break;
      await enqueuePage(sitemapPageUrl, 1, sitemapUrl);
    }
  }

  await writeProgress({
    progress: 20,
    currentPhase: 'Checking page content',
    pagesDiscovered: scheduled.size,
    checksTotal: Math.max(1, scheduled.size) * (AUDIT_CHECK_COUNT + 1),
    checksCompleted: 0,
  });

  let active = 0;
  let cancelled = false;

  async function processPage(item: QueueItem) {
    if (Date.now() >= auditDeadline) {
      durationLimitReached = true;
      return;
    }
    const currentUrl = normalizeCrawlUrl(item.url) || item.url;
    if (visited.has(currentUrl) || visited.size >= config.pageLimit) return;
    visited.add(currentUrl);

    if (robotsRules && isBlockedByRobots(currentUrl, robotsRules)) {
      await recordFailure(failureForCode('ROBOTS_BLOCKED', { affectedUrl: currentUrl }), item);
      return;
    }

    await ensureWorkerOwnership(audit.id, workerId);
    const crawlProgress = 20 + Math.floor((visited.size / Math.max(visited.size + queue.length, 1)) * 35);
    await writeProgress({
      progress: Math.min(55, crawlProgress),
      currentPhase: 'Checking page content',
      currentUrl,
      currentCheck: 'Loading page content',
      pagesDiscovered: scheduled.size,
      pagesCrawled: analysedPages,
    }, { type: 'page_crawling', message: `Checking ${currentUrl}` });

    let fetchResult: FetchAttemptResult;
    try {
      fetchResult = await fetchPageWithRetry(currentUrl, config.timeoutMs, requestScheduler);
    } catch (error) {
      const retried = error instanceof RetriedFetchError ? error : new RetriedFetchError(error, 1);
      const primaryFailure = classifyAuditFailure(retried.original, { affectedUrl: currentUrl, attemptCount: retried.attemptCount });
      const canTryHttp = currentUrl.startsWith('https://')
        && ['TLS_CERTIFICATE_INVALID', 'CONNECTION_REFUSED', 'HTTPS_UNAVAILABLE'].includes(primaryFailure.code);
      if (!canTryHttp) {
        await recordFailure(primaryFailure, item);
        return;
      }
      const httpUrl = currentUrl.replace(/^https:\/\//, 'http://');
      try {
        fetchResult = await fetchPageWithRetry(httpUrl, config.timeoutMs, requestScheduler, 1);
        await recordFailure({
          ...primaryFailure,
          recoveredAfterRetry: true,
          safeExplanation: `${primaryFailure.safeExplanation} HTTPS failed, but the page was available over HTTP. The audit continued using the insecure version.`,
        }, item, false);
        await writeProgress({ usedHttpFallback: true });
      } catch {
        await recordFailure(primaryFailure, item);
        return;
      }
    }

    const fetched = fetchResult.page;
    if (fetched.statusCode >= 400) {
      await recordFailure(failureForHttpStatus(fetched.statusCode, {
        affectedUrl: fetched.finalUrl,
        attemptCount: fetchResult.attemptCount,
        recoveredAfterRetry: fetchResult.recoveredAfterRetry,
        internalDetails: `HTTP ${fetched.statusCode}`,
      }), item);
      return;
    }
    if (!fetched.html.trim()) {
      await recordFailure(failureForCode('EMPTY_RESPONSE', {
        affectedUrl: fetched.finalUrl,
        attemptCount: fetchResult.attemptCount,
        recoveredAfterRetry: fetchResult.recoveredAfterRetry,
      }), item);
      return;
    }
    completedChecks += 1;

    if (!audit.finalUrl) {
      await writeProgress({ finalUrl: fetched.finalUrl });
      await writer.addEvent({
        type: 'homepage_fetched',
        message: `Homepage fetched with status ${fetched.statusCode}`,
        affectedUrl: fetched.finalUrl,
        progress: 22,
      });
    }

    const flatPageData = {
      ...(fetched.parsed || {}),
      url: fetched.finalUrl,
      finalUrl: fetched.finalUrl,
      status: fetched.statusCode,
      headers: fetched.headers,
      loadTimeMs: fetched.responseTimeMs,
      pageSizeBytes: fetched.pageSizeBytes,
      contentType: fetched.contentType,
      depth: item.depth,
    };

    await ensureWorkerOwnership(audit.id, workerId);
    const analysisStartedAt = Date.now();
    await writeProgress({
      currentPhase: 'Reviewing technical signals',
      currentUrl: fetched.finalUrl,
      currentCheck: 'SEO checks',
      progress: 55 + Math.floor((pages.length / Math.max(scheduled.size, 1)) * 20),
    }, { type: 'check_started', message: `Running SEO checks for ${fetched.finalUrl}` });

    const checkRun = fetched.parsed ? runAllChecksSafely(flatPageData) : { issues: [], unavailableChecks: [], completedChecks: 0 };
    const seoIssues = checkRun.issues
      .filter((issue) => isSeoIssueAllowedForProfile(config, issue))
      .map((issue) => mapAuditIssue(issue, fetched.finalUrl));
    for (const issue of seoIssues) {
      await ensureWorkerOwnership(audit.id, workerId);
      await addIssue(issue);
    }
    completedChecks += checkRun.completedChecks;
    for (const unavailable of checkRun.unavailableChecks) {
      unavailableChecks.push(`${unavailable.checkTitle} on ${fetched.finalUrl}`);
      await recordFailure(failureForCode('CHECK_UNAVAILABLE', {
        affectedUrl: fetched.finalUrl,
        internalDetails: `${unavailable.checkId}: ${unavailable.internalDetails}`,
      }), item, false);
    }
    await writer.addEvent({
      type: 'check_completed',
      message: `SEO checks completed for ${fetched.finalUrl}`,
      affectedUrl: fetched.finalUrl,
      checkTitle: 'SEO checks',
      progress: 75,
    });

    await ensureWorkerOwnership(audit.id, workerId);
    await writeProgress({
      currentPhase: 'Reviewing passive security signals',
      currentUrl: fetched.finalUrl,
      currentCheck: 'Passive security checks',
      progress: 75 + Math.floor((pages.length / Math.max(scheduled.size, 1)) * 15),
    }, { type: 'check_started', message: `Running passive security checks for ${fetched.finalUrl}` });
    let securityIssues: Omit<ResourceAuditIssue, 'id' | 'detectedAt'>[] = [];
    try {
      securityIssues = buildSecurityIssues(fetched);
      completedChecks += 1;
    } catch (error) {
      unavailableChecks.push(`Passive security checks on ${fetched.finalUrl}`);
      await recordFailure(failureForCode('CHECK_UNAVAILABLE', {
        affectedUrl: fetched.finalUrl,
        internalDetails: error instanceof Error ? error.message : String(error || 'Security check failure'),
      }), item, false);
    }
    for (const issue of securityIssues) {
      await ensureWorkerOwnership(audit.id, workerId);
      await addIssue(issue);
    }
    await writer.addEvent({
      type: 'check_completed',
      message: `Passive security checks completed for ${fetched.finalUrl}`,
      affectedUrl: fetched.finalUrl,
      checkTitle: 'Passive security checks',
      progress: 90,
    });

    writer.recordAnalysisDuration(Date.now() - analysisStartedAt);
    const pageRecord = await writer.addPage({
      url: fetched.finalUrl,
      statusCode: fetched.statusCode,
      responseTimeMs: fetched.responseTimeMs,
      pageSizeBytes: fetched.pageSizeBytes,
      title: fetched.parsed?.title || '',
      metaDescription: fetched.parsed?.metaDescription || '',
      h1: fetched.parsed?.h1?.[0] || '',
      canonicalUrl: fetched.parsed?.canonical || '',
      siteName: fetched.parsed?.siteName || '',
      faviconUrl: fetched.parsed?.faviconUrl || '',
      openGraphImage: fetched.parsed?.ogImage || '',
      themeColor: fetched.parsed?.themeColor || '',
      screenshotUrl: '',
      fetchStatus: 'success',
      failureCode: undefined,
      failureCategory: undefined,
      safeTitle: undefined,
      safeExplanation: undefined,
      suggestedAction: undefined,
      retryable: false,
      attemptCount: fetchResult.attemptCount,
      recoveredAfterRetry: fetchResult.recoveredAfterRetry,
      sourceUrl: item.discoveredFrom,
      anchorText: '',
      wordCount: fetched.parsed?.wordCount || 0,
      crawlDepth: item.depth,
      issueCount: seoIssues.length + securityIssues.length,
      crawledAt: nowIso(),
    });
    pages.push(pageRecord);
    analysedPages += 1;

    await writeProgress({
      currentPhase: 'Checking page content',
      currentUrl: fetched.finalUrl,
      currentCheck: 'Page crawled',
      pagesCrawled: analysedPages,
      checksTotal: Math.max(1, scheduled.size) * (AUDIT_CHECK_COUNT + 1),
      checksCompleted: completedChecks,
      progress: Math.min(90, 20 + Math.floor((pages.length / Math.max(scheduled.size, 1)) * 70)),
    }, {
      type: 'page_crawled',
      message: `Page analysed: ${fetched.finalUrl}`,
      data: { responseTimeMs: fetched.responseTimeMs, statusCode: fetched.statusCode },
    });

    if (fetched.parsed) {
      for (const link of fetched.parsed.internalLinks) {
        await enqueuePage(link.href, item.depth + 1, fetched.finalUrl, link.text);
      }
    }
  }

  await new Promise<void>((resolve, reject) => {
    const pump = () => {
      if (cancelled) return resolve();
      if (Date.now() >= auditDeadline) durationLimitReached = true;
      while (!durationLimitReached && active < config.concurrency && queue.length > 0 && visited.size < config.pageLimit) {
        const item = queue.shift()!;
        active++;
        processPage(item)
          .catch((error) => {
            if (error?.message === 'AUDIT_CANCELLED') {
              cancelled = true;
              return;
            }
            reject(error);
          })
          .finally(() => {
            active--;
            if ((durationLimitReached || queue.length === 0 || visited.size >= config.pageLimit) && active === 0) {
              resolve();
            } else {
              pump();
            }
          });
      }
      if ((durationLimitReached || queue.length === 0 || visited.size >= config.pageLimit) && active === 0) {
        resolve();
      }
    };
    pump();
  });

  if (cancelled || (await auditRepository.getAudit(audit.id))?.status === 'cancelled') {
    await writer.addEvent({
      type: 'audit_cancelled',
      message: 'Audit cancelled. Partial results were kept.',
      progress: (await auditRepository.getAudit(audit.id))?.progress,
    });
    return;
  }

  if (durationLimitReached) {
    await recordFailure(failureForCode('AUDIT_DEADLINE_EXCEEDED', {
      affectedUrl: audit.normalizedUrl,
      internalDetails: `Analysed ${analysedPages} pages before the deadline.`,
    }), { url: audit.normalizedUrl, depth: 0, sourceUrls: [], anchorTexts: [] }, false);
  }

  const groupedFailures = new Map<string, AuditFailure[]>();
  for (const failure of failures) groupedFailures.set(failure.code, [...(groupedFailures.get(failure.code) || []), failure]);
  for (const grouped of groupedFailures.values()) {
    const sample = grouped[0];
    await writer.addEvent({
      type: 'warning_summary',
      message: failureProgressMessage(sample, grouped.length),
      affectedUrl: sample.affectedUrl,
      category: sample.category,
      severity: sample.code === 'CHECK_UNAVAILABLE' || sample.code === 'AUDIT_DEADLINE_EXCEEDED' ? 'info' : 'medium',
      data: {
        count: grouped.length,
        safeTitle: sample.safeTitle,
        affectedUrls: grouped.map((failure) => failure.affectedUrl).filter(Boolean).slice(0, 100),
      },
    });
  }

  await writer.flush();
  const issues = await auditRepository.getIssues(audit.id);
  if (analysedPages === 0) {
    const primaryFailure = failures[0] || failureForCode('UNKNOWN_TARGET_FAILURE', { affectedUrl: audit.normalizedUrl });
    const completedAt = nowIso();
    await writeProgress({
      status: 'failed',
      progress: 100,
      currentPhase: 'Audit could not collect usable evidence',
      currentUrl: null,
      currentCheck: null,
      pagesCrawled: 0,
      checksTotal: Math.max(1, scheduled.size) * (AUDIT_CHECK_COUNT + 1),
      checksCompleted: completedChecks,
      warningCount: failures.length,
      failureCounts: aggregateFailureCounts(failures),
      error: `${primaryFailure.safeTitle}. ${primaryFailure.safeExplanation}`,
      completedAt,
      lockedBy: null,
      lockedAt: null,
      leaseExpiresAt: null,
    }, {
      type: 'audit_failed',
      message: `${primaryFailure.safeTitle}. No page returned usable evidence, so the audit stopped safely.`,
      affectedUrl: primaryFailure.affectedUrl,
      progress: 100,
    }, { force: true });
    return;
  }
  const categoryCounts: Record<string, number> = issues.reduce((acc: Record<string, number>, issue) => {
    const key = String(issue.category || 'other').toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const pageTypeCounts: Record<string, number> = pages.reduce((acc: Record<string, number>, page) => {
    const path = (() => {
      try {
        return new URL(page.url).pathname.toLowerCase();
      } catch {
        return '/';
      }
    })();
    const key = path === '/' || path === '' ? 'homepage'
      : /blog|post|article|news/.test(path) ? 'content'
        : /product|service|pricing|shop/.test(path) ? 'commercial'
          : /contact|about|team|location/.test(path) ? 'trust'
            : 'other';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const transparentScore = calculateTransparentAuditScore({
    issues,
    pages,
    unavailableChecks: {
      mobile: ['Browser-rendered Core Web Vitals and device interaction metrics were not collected.'],
      technical: unavailableChecks,
    },
    limitations: [
      `${config.label} limited the crawl to at most ${config.pageLimit} pages.`,
      'Provider-dependent rankings, backlinks, traffic, and search-volume data were not collected and did not affect scores.',
      'Passive Security Review only; no penetration testing was performed.',
    ],
  });
  const overallScore = transparentScore.overall ?? 0;

  await writeProgress({
    progress: 92,
    currentPhase: 'Preparing your report',
    currentUrl: null,
    currentCheck: 'Score calculation',
  }, { type: 'score_updated', message: `Overall score updated to ${overallScore}`, data: { overallScore } });

  await writeProgress({
    progress: 95,
    currentPhase: 'Preparing your report',
    currentCheck: 'Final report',
  }, { type: 'report_building', message: 'Building final report' });

  const report: ResourceAuditReport = {
    scores: {
      ...toReportScoreRecord(transparentScore),
      auditEngineVersion: AUDIT_ENGINE_VERSION,
      scoringVersion: SCORING_VERSION,
      checkRegistryVersion: CHECK_REGISTRY_VERSION,
      pageTypeCounts,
      issueCategoryCounts: categoryCounts,
      warningSummary: aggregateFailureCounts(failures),
      coverage: {
        pagesDiscovered: scheduled.size,
        pagesAnalysed: analysedPages,
        pagesFailed: pages.filter((page) => page.fetchStatus === 'failed').length,
        pagesBlocked: pages.filter((page) => page.fetchStatus === 'blocked').length,
        coveragePercent: Math.round((analysedPages / Math.max(1, scheduled.size)) * 100),
      },
      deepAudit: config.deepSitemapExpansion ? {
        sitemapExpansion: true,
        pageCoverageLimit: config.pageLimit,
        pagesDiscovered: Math.max(scheduled.size, pages.length),
        issueClusters: Object.keys(categoryCounts).length,
      } : null,
    },
    summary: `${config.label}: analysed ${analysedPages} page${analysedPages === 1 ? '' : 's'}, recorded ${failures.length} warning${failures.length === 1 ? '' : 's'}, and found ${issues.length} issue${issues.length === 1 ? '' : 's'}.`,
    topIssues: [...issues].sort((a, b) => {
      const weights = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
      return weights[b.severity] - weights[a.severity];
    }).slice(0, 25),
    pages,
    exports: {
      json: `/api/tools/audit/export/${audit.id}/json`,
      issuesCsv: `/api/tools/audit/export/${audit.id}/issues.csv`,
      pagesCsv: `/api/tools/audit/export/${audit.id}/pages.csv`,
    },
    generatedAt: nowIso(),
  };
  await auditRepository.setFinalReport(audit.id, report);

  const completedAt = nowIso();
  const completedStatus = failures.length ? 'completed_with_warnings' : 'completed';
  await writeProgress({
    status: completedStatus,
    progress: 100,
    currentPhase: failures.length ? 'Report ready with warnings' : 'Report ready',
    currentUrl: null,
    currentCheck: null,
    pagesCrawled: analysedPages,
    checksTotal: Math.max(1, scheduled.size) * (AUDIT_CHECK_COUNT + 1),
    checksCompleted: completedChecks,
    warningCount: failures.length,
    failureCounts: aggregateFailureCounts(failures),
    completedAt,
    lockedBy: null,
    lockedAt: null,
    leaseExpiresAt: null,
  }, {
    type: failures.length ? 'audit_completed_with_warnings' : 'audit_completed',
    message: failures.length
      ? `Report generated with ${failures.length} warning${failures.length === 1 ? '' : 's'}.`
      : `Audit completed in ${Math.max(1, Math.round((Date.now() - new Date(workerStart).getTime()) / 1000))}s`,
    progress: 100,
  }, { force: true });
}

async function processAudit(audit: ResourceAuditDocument, workerId: string) {
  const writer = new AuditWriteBatch(audit.id, undefined, { workerId });
  const profile = getAuditProfileForDocument(audit);
  try {
    await processAuditJob(audit, writer, workerId);
  } finally {
    await writer.flush();
    await auditRepository.trimAuditEvents(audit.id, profile.maxEvents);
    console.log(`Audit ${audit.id} metrics ${JSON.stringify(writer.getMetrics())}`);
  }
}

async function writeWorkerHeartbeat(state: AuditWorkerRuntimeState, patch?: Partial<AuditWorkerRuntimeState>) {
  if (patch) updateWorkerState(state, patch);
  await auditRepository.upsertWorkerHeartbeat(buildWorkerHeartbeat(state));
}

function createLeaseRefresher(auditId: string, workerId: string) {
  const refreshEveryMs = Math.max(5_000, Math.floor(AUDIT_LIMITS.lockLeaseMs / 2));
  const timer = setInterval(() => {
    auditRepository.refreshAuditLease(auditId, workerId).catch((error) => {
      console.error(`Audit ${auditId} lease refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, refreshEveryMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

let lastNoQueuedLogAt = 0;

function logNoQueuedAudits() {
  const now = Date.now();
  if (now - lastNoQueuedLogAt < NO_QUEUED_LOG_INTERVAL_MS) return;
  lastNoQueuedLogAt = now;
  console.log('No queued audits found');
}

export async function runOneAudit(
  workerId = process.env.AUDIT_WORKER_ID || `worker-${process.pid}`,
  runtimeState?: AuditWorkerRuntimeState,
) {
  const audit = await auditRepository.claimNextQueuedAudit(workerId, runtimeState?.runtime || 'node-worker');
  if (!audit) {
    if (runtimeState) {
      await writeWorkerHeartbeat(runtimeState, { status: 'idle', currentAuditId: null });
      logNoQueuedAudits();
    }
    return false;
  }

  if (!isAuditJobType(audit.effectiveMode)) {
    await auditRepository.updateAuditForWorker(audit.id, workerId, { status: 'failed', error: 'Unsupported audit job type.', completedAt: nowIso(), lockedBy: null, lockedAt: null, leaseExpiresAt: null });
    console.error(`Audit worker rejected unsupported job type for ${audit.id}`);
    return true;
  }

  if (runtimeState) {
    await writeWorkerHeartbeat(runtimeState, { status: 'running', currentAuditId: audit.id });
  }
  console.log(`Claimed audit ${audit.id} plan=${audit.plan} priority=${audit.queuePriority} mode=${audit.effectiveMode} url=${audit.normalizedUrl}`);
  console.log(`Audit ${audit.id} running`);

  const stopLeaseRefresher = createLeaseRefresher(audit.id, workerId);
  try {
    await processAudit(audit, workerId);
    const latest = await auditRepository.getAudit(audit.id);
    if (latest?.status === 'cancelled') {
      console.log(`Audit ${audit.id} cancelled`);
    } else if (latest?.status === 'completed' || latest?.status === 'completed_with_warnings') {
      console.log(`Audit ${audit.id} ${latest.status}`);
    }
    if (runtimeState) {
      await writeWorkerHeartbeat(runtimeState, {
        status: 'idle',
        currentAuditId: null,
        queuePollingStatus: 'active',
        databaseConnected: true,
        lastCompletedAuditId: latest?.status === 'completed' || latest?.status === 'completed_with_warnings' ? audit.id : runtimeState.lastCompletedAuditId,
        lastCompletedAuditAt: latest?.status === 'completed' || latest?.status === 'completed_with_warnings' ? nowIso() : runtimeState.lastCompletedAuditAt,
      });
    }
  } catch (error: any) {
    if (error?.message === 'AUDIT_CANCELLED') {
      await auditRepository.cancelAudit(audit.id);
      console.log(`Audit ${audit.id} cancelled`);
      if (runtimeState) {
        await writeWorkerHeartbeat(runtimeState, { status: 'idle', currentAuditId: null });
      }
      return true;
    }
    if (error?.message === 'AUDIT_OWNERSHIP_LOST') {
      console.error(`Audit ${audit.id} stopped because this worker no longer owns the active lease.`);
      if (runtimeState) await writeWorkerHeartbeat(runtimeState, { status: 'idle', currentAuditId: null, queuePollingStatus: 'active' });
      return true;
    }
    const terminalAudit = await auditRepository.getAudit(audit.id).catch(() => null);
    if (terminalAudit && isTerminalAuditStatus(terminalAudit.status)) {
      console.error(`Audit ${audit.id} post-finalisation cleanup failed without changing terminal status: ${error instanceof Error ? error.message : String(error)}`);
      if (runtimeState) await writeWorkerHeartbeat(runtimeState, { status: 'idle', currentAuditId: null, queuePollingStatus: 'active' });
      return true;
    }
    const failure = classifyAuditFailure(error, { affectedUrl: audit.currentUrl || audit.normalizedUrl });
    const safeMessage = `${failure.safeTitle}. ${failure.safeExplanation}`;
    try {
      await auditRepository.addInternalDiagnostic({
        auditId: audit.id,
        affectedUrl: failure.affectedUrl,
        failureCode: failure.code,
        phase: 'audit',
        attemptCount: failure.attemptCount,
        workerId,
        internalDetails: failure.internalDetails,
      });
    } catch (diagnosticError) {
      console.error(`Audit ${audit.id} diagnostic storage failed: ${diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)}`);
    }
    const failed = await auditRepository.updateAuditForWorker(audit.id, workerId, {
      status: 'failed',
      progress: 100,
      error: safeMessage,
      currentPhase: 'Audit could not collect usable evidence',
      completedAt: nowIso(),
      lockedBy: null,
      lockedAt: null,
      leaseExpiresAt: null,
    });
    if (failed) {
      await auditRepository.appendEvent(audit.id, {
        type: 'audit_failed',
        message: failure.safeTitle,
        affectedUrl: failure.affectedUrl,
        progress: 100,
      });
    }
    console.error(`Audit ${audit.id} failed [${failure.code}]: ${failure.internalDetails}`);
    if (runtimeState) {
      await writeWorkerHeartbeat(runtimeState, { status: 'idle', currentAuditId: null, queuePollingStatus: 'active', databaseConnected: true });
    }
  } finally {
    stopLeaseRefresher();
  }
  return true;
}

export async function runAuditWorkerLoop() {
  const config = loadWorkerConfig();
  auditRepository.requireSupabaseAdminClient();
  const state = createInitialWorkerState(config);
  let workerReady = false;
  let shutdownRequested = false;
  let shuttingDown = false;
  const healthServer = startWorkerHealthServer(state, () => workerReady, process.env.WORKER_HEALTH_PORT || process.env.PORT);

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    shutdownRequested = true;
    console.log(`Audit worker received ${signal}; shutting down`);
    try {
      await writeWorkerHeartbeat(state, { status: 'stopping' });
      if (state.currentAuditId) {
        await auditRepository.expireAuditLease(state.currentAuditId, config.workerId);
      }
      await writeWorkerHeartbeat(state, { status: 'stopped', currentAuditId: null });
    } catch (error) {
      console.error(`Audit worker shutdown cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      healthServer?.close();
      process.exit(0);
    }
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  await writeWorkerHeartbeat(state, { status: 'starting', currentAuditId: null });
  console.log(`SEOIntel audit worker started as ${config.workerId}`);
  console.log('Supabase admin: connected');
  console.log(`Supabase project: ${config.supabaseHost}`);
  console.log(`Polling interval: ${config.pollIntervalMs}ms`);

  workerReady = true;
  while (!shutdownRequested) {
    try {
      await writeWorkerHeartbeat(state, { status: 'idle', currentAuditId: null, queuePollingStatus: 'active', databaseConnected: true, lastFatalWorkerError: null });
      const claimed = await runOneAudit(config.workerId, state);
      if (!claimed) await wait(config.pollIntervalMs);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error || 'Worker polling failure');
      updateWorkerState(state, { status: 'idle', currentAuditId: null, queuePollingStatus: 'error', databaseConnected: false, lastFatalWorkerError: detail });
      console.error(`Worker queue polling failed: ${detail}`);
      await wait(Math.max(config.pollIntervalMs, 2_000));
    }
  }

  await writeWorkerHeartbeat(state, { status: 'stopped', currentAuditId: null, queuePollingStatus: 'stopped' });
  healthServer?.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAuditWorkerLoop().catch((error) => {
    if (error instanceof Error && error.message === WORKER_ENV_ERROR) {
      console.error(error.message);
    } else {
      console.error('Audit worker crashed', error);
    }
    process.exit(1);
  });
}
