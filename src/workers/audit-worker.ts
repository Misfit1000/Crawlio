import { parseHtml, type ParsedPageData } from '../lib/seo/html-parser';
import { pathToFileURL } from 'node:url';
import { fetchRobotsTxt, getSitemapUrlsFromRobots, isBlockedByRobots, parseRobotsTxt } from '../lib/seo/robots';
import { fetchSitemap } from '../lib/seo/sitemap';
import { isSameDomain, normalizeUrl, stripTrackingParams } from '../lib/seo/url-utils';
import { runAllChecks } from '../lib/seo/checks/runner';
import { auditRepository } from '../lib/firebase/audit-repository';
import {
  type AuditSeverity,
  type ResourceAuditDocument,
  type ResourceAuditIssue,
  type ResourceAuditPage,
  type ResourceAuditReport,
  getAuditModeConfig,
} from '../lib/audit/resource-types';
import { AUDIT_LIMITS } from '../lib/audit/audit-config';
import type { AuditIssue } from '../lib/audit/types';

type QueueItem = { url: string; depth: number; discoveredFrom?: string };

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

async function fetchHtmlPage(url: string, timeoutMs: number): Promise<FetchedPage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'SEOIntelBot/1.0 (+https://seointel.local)' },
      redirect: 'follow',
      signal: controller.signal,
    });
    const responseTimeMs = Date.now() - startedAt;
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const contentType = headers['content-type'] || '';
    const html = contentType.includes('text/html') ? await response.text() : '';
    return {
      url,
      finalUrl: response.url,
      statusCode: response.status,
      responseTimeMs,
      pageSizeBytes: Buffer.byteLength(html, 'utf8'),
      headers,
      contentType,
      html,
      parsed: html ? parseHtml(html, response.url) : null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureNotCancelled(auditId: string) {
  const audit = await auditRepository.getAudit(auditId);
  if (audit?.status === 'cancelled') {
    throw new Error('AUDIT_CANCELLED');
  }
}

async function writeProgress(auditId: string, patch: Partial<ResourceAuditDocument>, event?: { type: string; message: string; data?: unknown }) {
  await auditRepository.updateAudit(auditId, patch);
  if (event) {
    await auditRepository.appendEvent(auditId, {
      type: event.type,
      message: event.message,
      phase: patch.currentPhase,
      currentUrl: patch.currentUrl,
      checkTitle: patch.currentCheck || undefined,
      progress: patch.progress,
      data: event.data,
    });
  }
}

async function addIssue(auditId: string, issue: Omit<ResourceAuditIssue, 'id' | 'detectedAt'>) {
  await auditRepository.appendIssue(auditId, issue);
}

async function processAudit(audit: ResourceAuditDocument) {
  const config = getAuditModeConfig(audit.mode);
  const queue: QueueItem[] = [{ url: audit.normalizedUrl, depth: 0 }];
  const visited = new Set<string>();
  const pages: ResourceAuditPage[] = [];
  const workerStart = nowIso();

  await writeProgress(audit.id, {
    status: 'running',
    progress: 5,
    currentPhase: 'Validating URL',
    currentUrl: audit.normalizedUrl,
    currentCheck: 'URL normalization',
  }, { type: 'audit_started', message: 'Audit worker started' });
  await auditRepository.appendEvent(audit.id, {
    type: 'url_normalized',
    message: `Normalized ${audit.submittedInput} to ${audit.normalizedUrl}`,
    affectedUrl: audit.normalizedUrl,
    progress: 8,
  });

  await ensureNotCancelled(audit.id);

  const origin = new URL(audit.normalizedUrl).origin;
  await writeProgress(audit.id, {
    progress: 10,
    currentPhase: 'Checking robots.txt',
    currentUrl: new URL('/robots.txt', origin).toString(),
    currentCheck: 'robots.txt',
  }, { type: 'robots_fetching', message: 'Fetching robots.txt' });
  const robotsTxt = await fetchRobotsTxt(origin);
  const robotsRules = robotsTxt ? parseRobotsTxt(robotsTxt) : null;

  await writeProgress(audit.id, {
    progress: 14,
    currentPhase: 'Checking sitemap',
    currentUrl: new URL('/sitemap.xml', origin).toString(),
    currentCheck: 'sitemap.xml',
  }, { type: 'sitemap_fetching', message: 'Fetching sitemap URLs' });

  const sitemapCandidates = [
    ...getSitemapUrlsFromRobots(robotsTxt),
    new URL('/sitemap.xml', origin).toString(),
  ];
  for (const sitemapUrl of sitemapCandidates) {
    if (queue.length >= config.pageLimit) break;
    const sitemap = await fetchSitemap(sitemapUrl);
    for (const sitemapPageUrl of sitemap.urls) {
      if (queue.length >= config.pageLimit) break;
      const cleanUrl = stripTrackingParams(sitemapPageUrl);
      if (isSameDomain(cleanUrl, audit.normalizedUrl) && !queue.some((item) => item.url === cleanUrl)) {
        queue.push({ url: cleanUrl, depth: 1, discoveredFrom: sitemapUrl });
        await auditRepository.appendEvent(audit.id, {
          type: 'page_discovered',
          message: `Discovered ${cleanUrl}`,
          affectedUrl: cleanUrl,
          progress: 18,
          data: { discoveredFrom: sitemapUrl, crawlDepth: 1 },
        });
      }
    }
  }

  await auditRepository.updateAudit(audit.id, {
    progress: 20,
    currentPhase: 'Crawling pages',
    pagesDiscovered: queue.length,
    checksTotal: config.pageLimit * 2,
  });

  let active = 0;
  let cancelled = false;

  async function processPage(item: QueueItem) {
    const currentUrl = stripTrackingParams(item.url);
    if (visited.has(currentUrl) || visited.size >= config.pageLimit) return;
    visited.add(currentUrl);

    if (robotsRules && isBlockedByRobots(currentUrl, robotsRules)) {
      await addIssue(audit.id, {
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
    const crawlProgress = 20 + Math.floor((visited.size / config.pageLimit) * 35);
    await writeProgress(audit.id, {
      progress: Math.min(55, crawlProgress),
      currentPhase: 'Crawling pages',
      currentUrl,
      currentCheck: 'Fetching HTML',
      pagesDiscovered: Math.max(queue.length + visited.size, visited.size),
      pagesCrawled: pages.length,
    }, { type: 'page_crawling', message: `Fetching ${currentUrl}` });

    let fetched: FetchedPage;
    try {
      fetched = await fetchHtmlPage(currentUrl, config.timeoutMs);
    } catch (error: any) {
      if (currentUrl.startsWith('https://')) {
        const httpUrl = currentUrl.replace(/^https:\/\//, 'http://');
        await addIssue(audit.id, {
          severity: 'high',
          category: 'security',
          title: 'HTTPS failed or unavailable',
          description: 'The HTTPS request failed and the worker attempted HTTP fallback once.',
          affectedUrl: currentUrl,
          evidence: error?.message || 'HTTPS fetch failed',
          recommendation: 'Fix HTTPS availability and redirect HTTP traffic to HTTPS.',
        });
        await auditRepository.updateAudit(audit.id, { usedHttpFallback: true });
        fetched = await fetchHtmlPage(httpUrl, config.timeoutMs);
      } else {
        await addIssue(audit.id, {
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
      await auditRepository.updateAudit(audit.id, { finalUrl: fetched.finalUrl });
      await auditRepository.appendEvent(audit.id, {
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
    await writeProgress(audit.id, {
      currentPhase: 'Running SEO checks',
      currentUrl: fetched.finalUrl,
      currentCheck: 'SEO checks',
      progress: 55 + Math.floor((pages.length / config.pageLimit) * 20),
    }, { type: 'check_started', message: `Running SEO checks for ${fetched.finalUrl}` });

    const seoIssues = fetched.parsed ? runAllChecks(flatPageData).map((issue) => mapAuditIssue(issue, fetched.finalUrl)) : [];
    for (const issue of seoIssues) {
      await ensureNotCancelled(audit.id);
      await addIssue(audit.id, issue);
    }
    await auditRepository.appendEvent(audit.id, {
      type: 'check_completed',
      message: `SEO checks completed for ${fetched.finalUrl}`,
      affectedUrl: fetched.finalUrl,
      checkTitle: 'SEO checks',
      progress: 75,
    });

    await ensureNotCancelled(audit.id);
    await writeProgress(audit.id, {
      currentPhase: 'Running passive security checks',
      currentUrl: fetched.finalUrl,
      currentCheck: 'Passive security checks',
      progress: 75 + Math.floor((pages.length / config.pageLimit) * 15),
    }, { type: 'check_started', message: `Running passive security checks for ${fetched.finalUrl}` });
    const securityIssues = buildSecurityIssues(fetched);
    for (const issue of securityIssues) {
      await ensureNotCancelled(audit.id);
      await addIssue(audit.id, issue);
    }
    await auditRepository.appendEvent(audit.id, {
      type: 'check_completed',
      message: `Passive security checks completed for ${fetched.finalUrl}`,
      affectedUrl: fetched.finalUrl,
      checkTitle: 'Passive security checks',
      progress: 90,
    });

    const pageRecord = await auditRepository.appendPage(audit.id, {
      url: fetched.finalUrl,
      statusCode: fetched.statusCode,
      responseTimeMs: fetched.responseTimeMs,
      pageSizeBytes: fetched.pageSizeBytes,
      title: fetched.parsed?.title || '',
      metaDescription: fetched.parsed?.metaDescription || '',
      h1: fetched.parsed?.h1?.[0] || '',
      wordCount: fetched.parsed?.wordCount || 0,
      crawlDepth: item.depth,
      issueCount: seoIssues.length + securityIssues.length,
      crawledAt: nowIso(),
    });
    pages.push(pageRecord);

    await writeProgress(audit.id, {
      currentPhase: 'Crawling pages',
      currentUrl: fetched.finalUrl,
      currentCheck: 'Page crawled',
      pagesCrawled: pages.length,
      progress: Math.min(90, 20 + Math.floor((pages.length / config.pageLimit) * 70)),
    }, {
      type: 'page_crawled',
      message: `Crawled ${fetched.finalUrl}`,
      data: { responseTimeMs: fetched.responseTimeMs, statusCode: fetched.statusCode },
    });

    if (fetched.parsed) {
      for (const link of fetched.parsed.internalLinks) {
        if (queue.length + visited.size >= config.pageLimit) break;
        const normalized = normalizeUrl(link.href, fetched.finalUrl);
        if (!normalized) continue;
        const cleanUrl = stripTrackingParams(normalized);
        if (isSameDomain(cleanUrl, audit.normalizedUrl) && !visited.has(cleanUrl) && !queue.some((queued) => queued.url === cleanUrl)) {
          queue.push({ url: cleanUrl, depth: item.depth + 1, discoveredFrom: fetched.finalUrl });
          await auditRepository.appendEvent(audit.id, {
            type: 'page_discovered',
            message: `Discovered ${cleanUrl}`,
            affectedUrl: cleanUrl,
            progress: Math.min(55, 20 + Math.floor((visited.size / config.pageLimit) * 35)),
            data: { discoveredFrom: fetched.finalUrl, crawlDepth: item.depth + 1 },
          });
          await auditRepository.updateAudit(audit.id, { pagesDiscovered: queue.length + visited.size });
        }
      }
    }
  }

  await new Promise<void>((resolve, reject) => {
    const pump = () => {
      if (cancelled) return resolve();
      while (active < config.concurrency && queue.length > 0 && visited.size < config.pageLimit) {
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
            if ((queue.length === 0 || visited.size >= config.pageLimit) && active === 0) {
              resolve();
            } else {
              pump();
            }
          });
      }
      if ((queue.length === 0 || visited.size >= config.pageLimit) && active === 0) {
        resolve();
      }
    };
    pump();
  });

  if (cancelled || (await auditRepository.getAudit(audit.id))?.status === 'cancelled') {
    await auditRepository.appendEvent(audit.id, {
      type: 'audit_cancelled',
      message: 'Audit cancelled. Partial results were kept.',
      progress: (await auditRepository.getAudit(audit.id))?.progress,
    });
    return;
  }

  const issues = await auditRepository.getIssues(audit.id);
  const weightedIssueScore = issues.reduce((total, issue) => {
    const weights = { critical: 12, high: 6, medium: 3, low: 1, info: 0 };
    return total + weights[issue.severity];
  }, 0);
  const overallScore = Math.max(0, Math.min(100, 100 - Math.round(weightedIssueScore / Math.max(1, pages.length))));

  await writeProgress(audit.id, {
    progress: 92,
    currentPhase: 'Scoring',
    currentUrl: null,
    currentCheck: 'Score calculation',
  }, { type: 'score_updated', message: `Overall score updated to ${overallScore}`, data: { overallScore } });

  await writeProgress(audit.id, {
    progress: 95,
    currentPhase: 'Building report',
    currentCheck: 'Final report',
  }, { type: 'report_building', message: 'Building final report' });

  const report: ResourceAuditReport = {
    scores: { overall: overallScore },
    summary: `Audited ${pages.length} page${pages.length === 1 ? '' : 's'} and found ${issues.length} issue${issues.length === 1 ? '' : 's'}.`,
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

  await auditRepository.updateAudit(audit.id, {
    status: 'completed',
    progress: 100,
    currentPhase: 'Completed',
    currentUrl: null,
    currentCheck: null,
    pagesCrawled: pages.length,
    checksCompleted: pages.length * 2,
    completedAt: nowIso(),
    lockedBy: null,
    lockedAt: null,
    leaseExpiresAt: null,
  });
  await auditRepository.appendEvent(audit.id, {
    type: 'audit_completed',
    message: `Audit completed in ${Math.max(1, Math.round((Date.now() - new Date(workerStart).getTime()) / 1000))}s`,
    progress: 100,
  });
}

export async function runOneAudit(workerId = process.env.AUDIT_WORKER_ID || `worker-${process.pid}`) {
  const audit = await auditRepository.claimNextQueuedAudit(workerId);
  if (!audit) return false;

  try {
    await processAudit(audit);
  } catch (error: any) {
    if (error?.message === 'AUDIT_CANCELLED') {
      await auditRepository.cancelAudit(audit.id);
      return true;
    }
    await auditRepository.updateAudit(audit.id, {
      status: 'failed',
      error: error?.message || 'Unknown audit worker error',
      currentPhase: 'Failed',
      completedAt: nowIso(),
      lockedBy: null,
      lockedAt: null,
      leaseExpiresAt: null,
    });
    await auditRepository.appendEvent(audit.id, {
      type: 'audit_failed',
      message: error?.message || 'Unknown audit worker error',
      progress: (await auditRepository.getAudit(audit.id))?.progress,
    });
  }
  return true;
}

export async function runAuditWorkerLoop() {
  const intervalMs = Number(process.env.AUDIT_POLL_INTERVAL_MS || AUDIT_LIMITS.workerPollIntervalMs);
  const workerId = process.env.AUDIT_WORKER_ID || `worker-${process.pid}`;
  console.log(`SEOIntel audit worker started as ${workerId}`);
  while (true) {
    const claimed = await runOneAudit(workerId);
    if (!claimed) {
      await wait(intervalMs);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAuditWorkerLoop().catch((error) => {
    console.error('Audit worker crashed', error);
    process.exit(1);
  });
}
