import { createHash } from 'node:crypto';
import type { SafePublicFetchOptions, SafePublicResponse } from '../security/safe-public-fetch';
import { CHECKS, runCheckSetSafely } from '../seo/checks/runner';
import { isSameDomain } from '../seo/url-utils';
import { createRobotsFetchEvidence, parseRobotsTxt, isBlockedByRobots } from '../seo/robots-evaluator';
import { parseSitemapXml } from '../../audit-core/sitemap/sitemap-parser';
import { collectToolEvidence, readToolEvidence } from '../tools/audit-tools';
import { SCORING_VERSION, LEGACY_SCORING_VERSION } from '../platform/version';
import { categoryForIssue, deduplicatePageIssues, normalizedIssueKey } from './audit-scoring';
import { getAuditModeConfig } from './audit-config';
import { getAuditProfileForDocument, isSeoIssueAllowedForProfile } from './audit-profiles';
import { measuredAuditCategories, storedMeasuredAuditCategories } from './audit-evidence-quality';
import { classifyAuditFailure, failureForCode, failureForHttpStatus, type AuditFailure } from './audit-failures';
import { AUDIT_GROUP_DETAILS, isFocusedAudit, scopeIncludesGroup, scopeScoreCategories } from './audit-scope';
import { retryDelayMs } from './scalable-policy';
import { buildSecurityIssues, mapAuditIssue, normalizeCrawlUrl, parseFetchedPage } from './worker-page-analysis';
import type { ResourceAuditDocument, ResourceAuditIssue, ResourceAuditPage } from './resource-types';

export interface ScalableAnalysisRun {
  metadata: Record<string, unknown>;
}

export interface ScalableFrontierItem {
  key: string;
  url: string;
  kind: 'robots' | 'sitemap' | 'page';
  depth: number;
  source_url?: string;
  anchor?: string;
  attempts: number;
  next_attempt_at?: string;
  discovery_offset?: number;
}

export interface ScalableAnalysisScheduler {
  schedule<T>(url: string, operation: () => Promise<T>): Promise<T>;
}

export type ScalableAnalysisFetcher = (url: string, options: SafePublicFetchOptions) => Promise<SafePublicResponse>;

const severityRanks = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
const stableId = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 40);
const QUICK_CHECK_MODULES = new Set(['images', 'indexability', 'robots', 'sitemap', 'security', 'on-page', 'content', 'accessibility']);

export function scoreOptions(run: ScalableAnalysisRun & { analysed: number }, audit: ResourceAuditDocument): { scoringVersion: '2.1' | '2.2'; measuredCategories?: ReturnType<typeof measuredAuditCategories>; selectedCategories?: ReturnType<typeof scopeScoreCategories> } {
  const scoringVersion = run.metadata.scoringVersion === SCORING_VERSION ? SCORING_VERSION : LEGACY_SCORING_VERSION;
  return {
    scoringVersion,
    measuredCategories: !run.analysed ? [] : scoringVersion === SCORING_VERSION
      ? storedMeasuredAuditCategories(run.metadata.measuredCategories).filter(category => !audit.scope || scopeScoreCategories(audit.scope).includes(category)) : undefined,
    ...(audit.scope ? { selectedCategories: scopeScoreCategories(audit.scope) } : {}),
  };
}

export { scoreOptions as scalableScoreOptions };

export function scoreGroups(issues: ResourceAuditIssue[]) {
  const groups = new Map<string, { key: string; category: string; title: string; severity: string; rank: number }>();
  for (const issue of issues) {
    if (issue.severity === 'info') continue;
    const key = normalizedIssueKey(issue);
    const rank = severityRanks[issue.severity];
    if (!groups.has(key) || groups.get(key)!.rank < rank) groups.set(key, { key, category: categoryForIssue(issue), title: issue.title, severity: issue.severity, rank });
  }
  return [...groups.values()];
}

export function analysisFrontierItem(url: string, kind: ScalableFrontierItem['kind'], depth = 0, source?: string, anchor?: string): ScalableFrontierItem {
  return { key: createHash('sha256').update(`${kind}:${url}`).digest('hex'), url, kind, depth, source_url: source?.slice(0, 2048), anchor: anchor?.slice(0, 160), attempts: 0 };
}

function eligibleChild(audit: ResourceAuditDocument, url: string, kind: ScalableFrontierItem['kind'], depth: number, source?: string, anchor?: string) {
  if (audit.scope?.coverage === 'page' && kind === 'page') return null;
  const clean = normalizeCrawlUrl(url, source || audit.normalizedUrl);
  if (!clean || new TextEncoder().encode(clean).byteLength > 2048 || depth > 100 || !isSameDomain(clean, audit.normalizedUrl)) return null;
  return analysisFrontierItem(clean, kind, depth, source, anchor);
}

// Keep the durable commit shapes independent of the database client's runtime.
export function analysisPageToRow(auditId: string, page: ResourceAuditPage) {
  return {
    ...(page.toolEvidence ? { tool_evidence: readToolEvidence(page.toolEvidence) } : {}),
    id: page.id,
    audit_id: auditId,
    url: page.url,
    status_code: page.statusCode,
    response_time_ms: page.responseTimeMs,
    page_size_bytes: page.pageSizeBytes,
    title: page.title,
    meta_description: page.metaDescription,
    h1: page.h1,
    canonical_url: page.canonicalUrl ?? '',
    site_name: page.siteName ?? '',
    favicon_url: page.faviconUrl ?? '',
    open_graph_image: page.openGraphImage ?? '',
    theme_color: page.themeColor ?? '',
    screenshot_url: page.screenshotUrl ?? '',
    fetch_status: page.fetchStatus ?? 'success',
    failure_code: page.failureCode ?? null,
    failure_category: page.failureCategory ?? null,
    safe_title: page.safeTitle ?? null,
    safe_explanation: page.safeExplanation ?? null,
    suggested_action: page.suggestedAction ?? null,
    retryable: page.retryable ?? false,
    attempt_count: page.attemptCount ?? 1,
    recovered_after_retry: page.recoveredAfterRetry ?? false,
    source_url: page.sourceUrl ?? null,
    anchor_text: page.anchorText ?? null,
    word_count: page.wordCount,
    crawl_depth: page.crawlDepth,
    issue_count: page.issueCount,
    crawled_at: page.crawledAt,
  };
}

export function analysisIssueToRow(auditId: string, issue: ResourceAuditIssue) {
  return {
    id: issue.id,
    audit_id: auditId,
    severity: issue.severity,
    category: issue.category,
    title: issue.title,
    description: issue.description,
    affected_url: issue.affectedUrl,
    evidence: issue.evidence,
    recommendation: issue.recommendation,
    check_id: issue.checkId ?? null,
    failure_code: issue.failureCode ?? null,
    finding_key: issue.findingKey ?? null,
    source_urls: issue.sourceUrls ?? [],
    affected_page_count: issue.affectedPageCount ?? 1,
    detected_at: issue.detectedAt,
  };
}

function failurePage(audit: ResourceAuditDocument, item: ScalableFrontierItem, failure: AuditFailure) {
  const now = new Date().toISOString();
  const page: ResourceAuditPage = { id: stableId(`${audit.id}:${item.url}`), url: item.url, statusCode: failure.httpStatus || 0,
    responseTimeMs: 0, pageSizeBytes: 0, title: '', metaDescription: '', h1: '', wordCount: 0, crawlDepth: item.depth,
    issueCount: 1, crawledAt: now, fetchStatus: failure.code === 'ROBOTS_BLOCKED' ? 'blocked' : 'failed',
    failureCode: failure.code, failureCategory: failure.category, safeTitle: failure.safeTitle, safeExplanation: failure.safeExplanation,
    suggestedAction: failure.suggestedAction, retryable: failure.retryable, attemptCount: item.attempts + 1, sourceUrl: item.source_url };
  const issue: ResourceAuditIssue = { id: stableId(`${audit.id}:${item.url}:${failure.code}`), severity: failure.code === 'ROBOTS_BLOCKED' ? 'info' : 'high',
    category: 'crawlability', title: failure.safeTitle, description: failure.safeExplanation, affectedUrl: item.url,
    evidence: failure.httpStatus ? `HTTP ${failure.httpStatus}` : failure.safeTitle, recommendation: failure.suggestedAction,
    checkId: failure.code, failureCode: failure.code, findingKey: `${failure.code}|${item.url}`.toLowerCase(), detectedAt: now };
  return { key: item.key, page: analysisPageToRow(audit.id, page), issues: [analysisIssueToRow(audit.id, issue)], groups: audit.scope ? [] : scoreGroups([issue]), checks: audit.scope ? 0 : 1, children: [] };
}

export function selectedCheckModules(audit: ResourceAuditDocument, scoringVersion: unknown) {
  const profile = getAuditProfileForDocument(audit);
  const planModules = scoringVersion === SCORING_VERSION && profile.processingTier === 'free'
    ? CHECKS.filter(check => QUICK_CHECK_MODULES.has(check.id)) : CHECKS;
  if (!audit.scope) return planModules;
  const selected = new Set(audit.scope.checkGroups.flatMap(group => AUDIT_GROUP_DETAILS[group].modules));
  // Focused tools use the selected local checks; depth still controls admission and discovery.
  return (isFocusedAudit(audit) ? CHECKS : planModules).filter(check => selected.has(check.id));
}

export function auditHtmlExtraction(audit: ResourceAuditDocument, scoringVersion: unknown) {
  const modules = new Set(selectedCheckModules(audit, scoringVersion).map(check => check.id));
  return {
    keywords: false,
    links: audit.scope?.coverage !== 'page' || modules.has('links'),
    images: modules.has('images'),
    structuredData: modules.has('schema'),
    accessibility: modules.has('accessibility'),
    security: scopeIncludesGroup(audit.scope, 'security'),
  };
}

function fetchOptions(timeoutMs: number): SafePublicFetchOptions {
  return { timeoutMs, dnsTimeoutMs: 3_000, maxRedirects: 5, allowedContentTypes: ['text/html', 'application/xhtml+xml'] };
}

export async function analyseScalableItem(
  audit: ResourceAuditDocument,
  run: ScalableAnalysisRun,
  item: ScalableFrontierItem,
  scheduler: ScalableAnalysisScheduler,
  fetcher: ScalableAnalysisFetcher,
): Promise<Record<string, unknown>> {
  const config = getAuditModeConfig(audit.effectiveMode);
  try {
    if (item.kind === 'sitemap' && run.metadata.robotsUnavailable) return {key:item.key,children:[]};
    if (item.kind !== 'page') {
      const response = await scheduler.schedule(item.url, () => fetcher(item.url, {
        ...fetchOptions(config.timeoutMs), maxBytes: item.kind === 'robots' ? 128_000 : 2_000_000,
        allowedContentTypes: item.kind === 'robots' ? ['text/plain','text/html'] : ['application/xml','text/xml','text/plain','application/xhtml+xml'],
      }));
      if ((response.status === 429 || response.status >= 500) && item.attempts < 2) {
        return { key: item.key, retryAt: new Date(Date.now() + retryDelayMs(response.headers['retry-after'], item.attempts)).toISOString() };
      }
      if (item.kind === 'robots') {
        const { document, ...robotsEvidence } = createRobotsFetchEvidence({ status: response.status, body: response.body, url: item.url });
        if (robotsEvidence.policy === 'disallow-all') return { key: item.key, children: [], robotsUnavailable: true, robotsEvidence };
        const rules = document || parseRobotsTxt('');
        const needsSitemap = audit.scope?.coverage !== 'page' || scopeIncludesGroup(audit.scope, 'crawlability');
        return { key: item.key, children: needsSitemap ? rules.sitemaps.map(url => eligibleChild(audit,url,'sitemap',0,item.url)).filter(Boolean) : [], robots: rules, robotsEvidence };
      }
      const parsed = response.status >= 200 && response.status < 300 ? parseSitemapXml(response.body) : { urls: [], sitemaps: [], errors: [`HTTP ${response.status}`] };
      const children = [ ...parsed.urls.map(url => eligibleChild(audit,url,'page',1,item.url)), ...parsed.sitemaps.map(url => eligibleChild(audit,url,'sitemap',0,item.url)) ].filter(Boolean);
      return { key: item.key, children, discoveryErrors: parsed.errors,
        sitemapInspected: parsed.errors.length === 0,
        sitemapContainsTarget: parsed.urls.some(url => normalizeCrawlUrl(url, item.url) === audit.normalizedUrl) };
    }
    if (run.metadata.robotsUnavailable || (run.metadata.robots && isBlockedByRobots(item.url, run.metadata.robots))) return failurePage(audit,item,failureForCode('ROBOTS_BLOCKED',{ affectedUrl: item.url }));
    const fetched = await scheduler.schedule(item.url, async () => parseFetchedPage(item.url,
      await fetcher(item.url, fetchOptions(config.timeoutMs)), auditHtmlExtraction(audit,run.metadata.scoringVersion)));
    if ([429,502,503,504].includes(fetched.statusCode) && item.attempts < 2) {
      return { key: item.key, retryAt: new Date(Date.now()+retryDelayMs(fetched.headers['retry-after'],item.attempts)).toISOString() };
    }
    if (!isSameDomain(fetched.finalUrl,audit.normalizedUrl)) return failurePage(audit,item,failureForCode('UNKNOWN_TARGET_FAILURE',{ affectedUrl: item.url, internalDetails: 'Redirect left the audited domain.' }));
    if (fetched.statusCode>=400) return failurePage(audit,item,failureForHttpStatus(fetched.statusCode,{ affectedUrl:item.url,attemptCount:item.attempts+1 }));
    if (!fetched.html.trim()) return failurePage(audit,item,failureForCode('EMPTY_RESPONSE',{ affectedUrl:item.url }));
    const profile = getAuditProfileForDocument(audit);
    const checkModules = selectedCheckModules(audit, run.metadata.scoringVersion).filter(check => check.id !== 'sitemap' || !audit.scope || run.metadata.sitemapInspected);
    const checks = runCheckSetSafely(checkModules, { ...fetched.parsed, url:fetched.finalUrl,finalUrl:fetched.finalUrl,status:fetched.statusCode,
      headers:fetched.headers,loadTimeMs:fetched.responseTimeMs,pageSizeBytes:fetched.pageSizeBytes,contentType:fetched.contentType,depth:item.depth,
      ...(audit.scope ? { blockedByRobots: false, inSitemap: run.metadata.sitemapContainsTarget === true,
        isIndexable: !/noindex|none/i.test(`${fetched.parsed?.metaRobots || ''},${fetched.headers['x-robots-tag'] || ''}`) } : {}) });
    const now = new Date().toISOString();
    const passiveIssues = scopeIncludesGroup(audit.scope, 'security')
      ? buildSecurityIssues(fetched, audit.scope ? new Set(checks.issues.map(issue => issue.id)) : undefined) : [];
    const recordedIssues: ResourceAuditIssue[] = [ ...checks.issues.filter(issue=>isFocusedAudit(audit) || isSeoIssueAllowedForProfile(profile,issue)).map(issue=>mapAuditIssue(issue,fetched.finalUrl)), ...passiveIssues ]
      .filter(issue => !audit.scope || scopeScoreCategories(audit.scope).includes(categoryForIssue(issue)) || (scopeIncludesGroup(audit.scope,'technical') && categoryForIssue(issue)==='mobile'))
      .map(issue=>({ ...issue, id:stableId(`${audit.id}:${fetched.finalUrl}:${issue.checkId || issue.title}:${issue.category}`),detectedAt:now }));
    const issues = run.metadata.scoringVersion === SCORING_VERSION ? deduplicatePageIssues(recordedIssues) : recordedIssues;
    const page: ResourceAuditPage = { id:stableId(`${audit.id}:${fetched.finalUrl}`),url:fetched.finalUrl,statusCode:fetched.statusCode,
      responseTimeMs:fetched.responseTimeMs,pageSizeBytes:fetched.pageSizeBytes,title:fetched.parsed?.title || '',metaDescription:fetched.parsed?.metaDescription || '',
      h1:fetched.parsed?.h1?.[0] || '',canonicalUrl:fetched.parsed?.canonical || '',siteName:fetched.parsed?.siteName || '',faviconUrl:fetched.parsed?.faviconUrl || '',
      openGraphImage:fetched.parsed?.ogImage || '',themeColor:fetched.parsed?.themeColor || '',wordCount:fetched.parsed?.wordCount || 0,
      crawlDepth:item.depth,issueCount:issues.length,crawledAt:now,fetchStatus:'success',attemptCount:item.attempts+1,recoveredAfterRetry:item.attempts>0,sourceUrl:item.source_url };
    page.toolEvidence = collectToolEvidence({ ...fetched, requestedUrl: item.url,
      robotsAllowed: run.metadata.robots && run.metadata.robotsState !== 'malformed' ? !isBlockedByRobots(item.url, run.metadata.robots) : null });
    const children = (fetched.parsed?.internalLinks || []).map(link=>eligibleChild(audit,link.href,'page',item.depth+1,fetched.finalUrl,link.text)).filter(Boolean);
    return { key:item.key,page:analysisPageToRow(audit.id,page),issues:issues.map(issue=>analysisIssueToRow(audit.id,issue)),groups:scoreGroups(issues),checks:checks.completedChecks+(audit.scope ? scopeIncludesGroup(audit.scope,'security') ? 1 : 0 : 2),unavailable:checks.unavailableChecks.length,children,
      measuredCategories: measuredAuditCategories([...checks.completedCheckIds, ...(passiveIssues.length || scopeIncludesGroup(audit.scope,'security') ? ['security'] : [])], audit.scope) };
  } catch (error) {
    if ((error as { code?: string })?.code === 'SUBREQUEST_BUDGET_EXCEEDED') throw error;
    if (item.kind === 'robots') return item.attempts < 2
      ? { key: item.key, retryAt: new Date(Date.now() + retryDelayMs(undefined, item.attempts)).toISOString() }
      : { key: item.key, children: [], robotsUnavailable: true, robotsEvidence: createRobotsFetchEvidence({ url: item.url, error: true }) };
    const failure = classifyAuditFailure(error,{ affectedUrl:item.url,attemptCount:item.attempts+1 });
    if (failure.retryable && item.attempts<2) return { key:item.key,retryAt:new Date(Date.now()+retryDelayMs(undefined,item.attempts)).toISOString() };
    if (item.kind === 'sitemap') return { key:item.key,children:[],discoveryErrors:['Sitemap unavailable'] };
    return failurePage(audit,item,failure);
  }
}
