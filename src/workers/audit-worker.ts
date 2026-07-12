import { parseHtml, type ParsedPageData } from '../lib/seo/html-parser';
import { pathToFileURL } from 'node:url';
import { fetchRobotsTxt, getSitemapUrlsFromRobots, isBlockedByRobots, parseRobotsTxt } from '../lib/seo/robots';
import { fetchSitemap } from '../lib/seo/sitemap';
import { isSameDomain, normalizeUrl, stripTrackingParams } from '../lib/seo/url-utils';
import { runAllChecks } from '../lib/seo/checks/runner';
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
import type { AuditIssue } from '../lib/audit/types';
import { PublicFetchError, safePublicFetch, type SafePublicFetchOptions } from '../lib/security/safe-public-fetch';
import { calculateTransparentAuditScore, toReportScoreRecord } from '../lib/audit/audit-scoring';
import { AuditWriteBatch } from './audit-write-batch';
import { HostRequestScheduler } from './host-request-scheduler';

type QueueItem = { url: string; depth: number; discoveredFrom?: string };
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
  return {
    severity: toSeverity(issue.severity),
    category: String(issue.category || 'seo'),
    title: issue.title || 'Audit issue',
    description: issue.description || issue.title || 'Audit issue detected.',
    affectedUrl: issue.affectedUrl || fallbackUrl,
    evidence: issue.evidence || issue.element || '',
    recommendation: issue.recommendation || 'Review this item and update the affected page.',
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
  return {
    url,
    finalUrl: response.finalUrl,
    statusCode: response.status,
    responseTimeMs: response.durationMs,
    pageSizeBytes: response.bodyBytes,
    headers: response.headers,
    contentType: response.contentType,
    html: response.body,
    parsed: response.body ? parseHtml(response.body, response.finalUrl) : null,
  };
}

async function ensureNotCancelled(auditId: string) {
  const audit = await auditRepository.getAudit(auditId);
  if (audit?.status === 'cancelled') {
    throw new Error('AUDIT_CANCELLED');
  }
}

function normalizeCrawlUrl(input: string, base?: string) {
  const normalized = normalizeUrl(input, base);
  if (!normalized) return null;
  const url = new URL(stripTrackingParams(normalized));
  url.hash = '';
  return url.toString();
}

async function processAuditJob(audit: ResourceAuditDocument, writer: AuditWriteBatch) {
  const config = getAuditProfileForDocument(audit);
  const startUrl = normalizeCrawlUrl(audit.normalizedUrl) || audit.normalizedUrl;
  const queue: QueueItem[] = [{ url: startUrl, depth: 0 }];
  const scheduled = new Set<string>([startUrl]);
  const visited = new Set<string>();
  const pages: ResourceAuditPage[] = [];
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

  async function enqueuePage(url: string, depth: number, discoveredFrom: string) {
    const cleanUrl = normalizeCrawlUrl(url, discoveredFrom);
    if (!cleanUrl || scheduled.size >= config.pageLimit || scheduled.has(cleanUrl)) return false;
    if (!isSameDomain(cleanUrl, audit.normalizedUrl)) return false;
    scheduled.add(cleanUrl);
    queue.push({ url: cleanUrl, depth, discoveredFrom });
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
    currentPhase: 'Validating URL',
    currentUrl: audit.normalizedUrl,
    currentCheck: 'URL normalization',
  }, { type: 'audit_started', message: 'Audit worker started' }, { force: true });
  await writer.addEvent({
    type: 'url_normalized',
    message: `Normalized ${audit.submittedInput} to ${audit.normalizedUrl}`,
    affectedUrl: audit.normalizedUrl,
    progress: 8,
  });

  await ensureNotCancelled(audit.id);

  const origin = new URL(audit.normalizedUrl).origin;
  await writeProgress({
    progress: 10,
    currentPhase: 'Checking robots.txt',
    currentUrl: new URL('/robots.txt', origin).toString(),
    currentCheck: 'robots.txt',
  }, { type: 'robots_fetching', message: 'Fetching robots.txt' });
  const robotsTxt = await fetchRobotsTxt(origin, workerFetchOptions(config.timeoutMs));
  const robotsRules = robotsTxt ? parseRobotsTxt(robotsTxt) : null;

  await writeProgress({
    progress: 14,
    currentPhase: 'Checking sitemap',
    currentUrl: new URL('/sitemap.xml', origin).toString(),
    currentCheck: 'sitemap.xml',
  }, { type: 'sitemap_fetching', message: 'Fetching sitemap URLs' });

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
    currentPhase: 'Crawling pages',
    pagesDiscovered: scheduled.size,
    checksTotal: 0,
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
      await addIssue({
        severity: 'medium',
        category: 'crawlability',
        title: 'Page blocked by robots.txt',
        description: 'The crawler skipped this URL because robots.txt disallows it.',
        affectedUrl: currentUrl,
        evidence: 'robots.txt disallow rule matched the page path',
        recommendation: 'Confirm this page should be blocked from crawlers, or update robots.txt.',
      });
      return;
    }

    await ensureNotCancelled(audit.id);
    const crawlProgress = 20 + Math.floor((visited.size / Math.max(visited.size + queue.length, 1)) * 35);
    await writeProgress({
      progress: Math.min(55, crawlProgress),
      currentPhase: 'Crawling pages',
      currentUrl,
      currentCheck: 'Fetching HTML',
      pagesDiscovered: scheduled.size,
      pagesCrawled: pages.length,
    }, { type: 'page_crawling', message: `Fetching ${currentUrl}` });

    let fetched: FetchedPage;
    try {
      fetched = await requestScheduler.schedule(currentUrl, () => fetchHtmlPage(currentUrl, config.timeoutMs));
    } catch (error: any) {
      const publicFetchError = error instanceof PublicFetchError ? error : null;
      if (publicFetchError?.code === 'RESPONSE_TOO_LARGE' || publicFetchError?.code === 'UNSUPPORTED_CONTENT_TYPE') {
        await addIssue({
          severity: 'medium',
          category: publicFetchError.code === 'RESPONSE_TOO_LARGE' ? 'performance' : 'technical',
          title: publicFetchError.code === 'RESPONSE_TOO_LARGE' ? 'HTML response exceeded the configured analysis limit' : 'Unsupported page content type',
          description: publicFetchError.message,
          affectedUrl: currentUrl,
          evidence: publicFetchError.code,
          recommendation: publicFetchError.code === 'RESPONSE_TOO_LARGE' ? 'Reduce the HTML response size and rerun the audit.' : 'Audit an HTML page rather than a binary or unsupported resource.',
        });
        return;
      }
      if (publicFetchError?.code === 'PRIVATE_NETWORK_TARGET' || publicFetchError?.code === 'UNSUPPORTED_PORT' || publicFetchError?.code === 'EMBEDDED_CREDENTIALS') {
        throw publicFetchError;
      }
      if (currentUrl.startsWith('https://')) {
        const httpUrl = currentUrl.replace(/^https:\/\//, 'http://');
        await addIssue({
          severity: 'high',
          category: 'security',
          title: 'HTTPS failed or unavailable',
          description: 'The HTTPS request failed and the worker attempted HTTP fallback once.',
          affectedUrl: currentUrl,
          evidence: error?.message || 'HTTPS fetch failed',
          recommendation: 'Fix HTTPS availability and redirect HTTP traffic to HTTPS.',
        });
        await writeProgress({ usedHttpFallback: true });
        fetched = await requestScheduler.schedule(httpUrl, () => fetchHtmlPage(httpUrl, config.timeoutMs));
      } else {
        await addIssue({
          severity: 'medium',
          category: 'crawlability',
          title: 'Page fetch failed',
          description: 'The worker could not fetch this public page.',
          affectedUrl: currentUrl,
          evidence: error?.message || 'Fetch failed',
          recommendation: 'Check server availability, redirects, and response timeout.',
        });
        return;
      }
    }

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

    await ensureNotCancelled(audit.id);
    const analysisStartedAt = Date.now();
    await writeProgress({
      currentPhase: 'Running SEO checks',
      currentUrl: fetched.finalUrl,
      currentCheck: 'SEO checks',
      progress: 55 + Math.floor((pages.length / Math.max(scheduled.size, 1)) * 20),
    }, { type: 'check_started', message: `Running SEO checks for ${fetched.finalUrl}` });

    const seoIssues = fetched.parsed
      ? runAllChecks(flatPageData)
        .filter((issue) => isSeoIssueAllowedForProfile(config, issue))
        .map((issue) => mapAuditIssue(issue, fetched.finalUrl))
      : [];
    for (const issue of seoIssues) {
      await ensureNotCancelled(audit.id);
      await addIssue(issue);
    }
    await writer.addEvent({
      type: 'check_completed',
      message: `SEO checks completed for ${fetched.finalUrl}`,
      affectedUrl: fetched.finalUrl,
      checkTitle: 'SEO checks',
      progress: 75,
    });

    await ensureNotCancelled(audit.id);
    await writeProgress({
      currentPhase: 'Running passive security checks',
      currentUrl: fetched.finalUrl,
      currentCheck: 'Passive security checks',
      progress: 75 + Math.floor((pages.length / Math.max(scheduled.size, 1)) * 15),
    }, { type: 'check_started', message: `Running passive security checks for ${fetched.finalUrl}` });
    const securityIssues = buildSecurityIssues(fetched);
    for (const issue of securityIssues) {
      await ensureNotCancelled(audit.id);
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
      wordCount: fetched.parsed?.wordCount || 0,
      crawlDepth: item.depth,
      issueCount: seoIssues.length + securityIssues.length,
      crawledAt: nowIso(),
    });
    pages.push(pageRecord);

    await writeProgress({
      currentPhase: 'Crawling pages',
      currentUrl: fetched.finalUrl,
      currentCheck: 'Page crawled',
      pagesCrawled: pages.length,
      progress: Math.min(90, 20 + Math.floor((pages.length / Math.max(scheduled.size, 1)) * 70)),
    }, {
      type: 'page_crawled',
      message: `Crawled ${fetched.finalUrl}`,
      data: { responseTimeMs: fetched.responseTimeMs, statusCode: fetched.statusCode },
    });

    if (fetched.parsed) {
      for (const link of fetched.parsed.internalLinks) {
        if (scheduled.size >= config.pageLimit) break;
        await enqueuePage(link.href, item.depth + 1, fetched.finalUrl);
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
    await addIssue({
      severity: 'info',
      category: 'audit-coverage',
      title: 'Audit time budget reached',
      description: 'The audit stopped scheduling new pages after reaching its resource-safe time budget.',
      affectedUrl: audit.normalizedUrl,
      evidence: `Stored ${pages.length} completed page checks before the time budget ended.`,
      recommendation: 'Review the completed evidence or run a narrower audit scope.',
    });
  }

  await writer.flush();
  const issues = await auditRepository.getIssues(audit.id);
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
    currentPhase: 'Scoring',
    currentUrl: null,
    currentCheck: 'Score calculation',
  }, { type: 'score_updated', message: `Overall score updated to ${overallScore}`, data: { overallScore } });

  await writeProgress({
    progress: 95,
    currentPhase: 'Building report',
    currentCheck: 'Final report',
  }, { type: 'report_building', message: 'Building final report' });

  const report: ResourceAuditReport = {
    scores: {
      ...toReportScoreRecord(transparentScore),
      pageTypeCounts,
      issueCategoryCounts: categoryCounts,
      deepAudit: config.deepSitemapExpansion ? {
        sitemapExpansion: true,
        pageCoverageLimit: config.pageLimit,
        pagesDiscovered: Math.max(scheduled.size, pages.length),
        issueClusters: Object.keys(categoryCounts).length,
      } : null,
    },
    summary: `${config.label}: audited ${pages.length} page${pages.length === 1 ? '' : 's'} and found ${issues.length} issue${issues.length === 1 ? '' : 's'}.`,
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
  await writeProgress({
    status: 'completed',
    progress: 100,
    currentPhase: 'Completed',
    currentUrl: null,
    currentCheck: null,
    pagesCrawled: pages.length,
    checksTotal: pages.length * 2,
    checksCompleted: pages.length * 2,
    completedAt,
    lockedBy: null,
    lockedAt: null,
    leaseExpiresAt: null,
  }, {
    type: 'audit_completed',
    message: `Audit completed in ${Math.max(1, Math.round((Date.now() - new Date(workerStart).getTime()) / 1000))}s`,
    progress: 100,
  }, { force: true });
}

async function processAudit(audit: ResourceAuditDocument) {
  const writer = new AuditWriteBatch(audit.id);
  const profile = getAuditProfileForDocument(audit);
  try {
    await processAuditJob(audit, writer);
  } finally {
    await writer.flush();
    await auditRepository.trimAuditEvents(audit.id, profile.maxEvents);
    console.log(`Audit ${audit.id} metrics ${JSON.stringify(writer.getMetrics())}`);
  }
}

async function writeWorkerHeartbeat(state: AuditWorkerRuntimeState, patch?: Partial<Pick<AuditWorkerRuntimeState, 'status' | 'currentAuditId'>>) {
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

  if (runtimeState) {
    await writeWorkerHeartbeat(runtimeState, { status: 'running', currentAuditId: audit.id });
  }
  console.log(`Claimed audit ${audit.id} plan=${audit.plan} priority=${audit.queuePriority} mode=${audit.effectiveMode} url=${audit.normalizedUrl}`);
  console.log(`Audit ${audit.id} running`);

  const stopLeaseRefresher = createLeaseRefresher(audit.id, workerId);
  try {
    await processAudit(audit);
    const latest = await auditRepository.getAudit(audit.id);
    if (latest?.status === 'cancelled') {
      console.log(`Audit ${audit.id} cancelled`);
    } else if (latest?.status === 'completed') {
      console.log(`Audit ${audit.id} completed`);
    }
    if (runtimeState) {
      await writeWorkerHeartbeat(runtimeState, { status: 'idle', currentAuditId: null });
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
    const message = error?.message || 'Unknown audit worker error';
    await auditRepository.updateAudit(audit.id, {
      status: 'failed',
      error: message,
      currentPhase: 'Failed',
      completedAt: nowIso(),
      lockedBy: null,
      lockedAt: null,
      leaseExpiresAt: null,
    });
    await auditRepository.appendEvent(audit.id, {
      type: 'audit_failed',
      message,
      progress: (await auditRepository.getAudit(audit.id))?.progress,
    });
    console.error(`Audit ${audit.id} failed: ${message}`);
    if (runtimeState) {
      await writeWorkerHeartbeat(runtimeState, { status: 'failed', currentAuditId: audit.id });
      await writeWorkerHeartbeat(runtimeState, { status: 'idle', currentAuditId: null });
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
    await writeWorkerHeartbeat(state, { status: 'idle', currentAuditId: null });
    const claimed = await runOneAudit(config.workerId, state);
    if (!claimed) {
      await wait(config.pollIntervalMs);
    }
  }

  await writeWorkerHeartbeat(state, { status: 'stopped', currentAuditId: null });
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
