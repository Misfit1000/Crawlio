import type { ResourceAuditDocument, ResourceAuditIssue, ResourceAuditLiveData, ResourceAuditPage } from './resource-types';
import { extractReportScores, type ReportScoreSnapshot } from './report-insights';
import { isCompletedAuditStatus, isTerminalAuditStatus } from './audit-time';
import { findingWorkflowKey, type FindingWorkflowStatus } from './finding-workflow';

export type ChecklistStatus = FindingWorkflowStatus;
export type IssueBucket = 'all' | 'seo' | 'technical' | 'accessibility' | 'security';

export interface AuditHistoryEntry {
  auditId: string;
  projectId: string | null;
  normalizedUrl: string;
  hostname: string;
  status: string;
  score: number | null;
  scoreSource?: 'final_report' | 'unavailable';
  scores?: ReportScoreSnapshot;
  issuesFound: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  pagesCrawled: number;
  pageLimit?: number;
  completedAt: string | null;
  createdAt?: string;
  startedAt?: string | null;
  durationSeconds?: number | null;
  mode?: ResourceAuditDocument['mode'];
  processingTier?: ResourceAuditDocument['processingTier'];
  updatedAt: string;
  issueSignatures: string[];
  topIssues?: ResourceAuditIssue[];
  pageSummaries: Array<{
    url: string;
    statusCode: number;
    crawlDepth: number;
    issueCount: number;
    responseTimeMs?: number;
    pageSizeBytes?: number;
    title?: string;
    metaDescription?: string;
    h1?: string;
    canonicalUrl?: string;
    siteName?: string;
    faviconUrl?: string;
    openGraphImage?: string;
    themeColor?: string;
    screenshotUrl?: string;
  }>;
}

export interface IssueInsight {
  whatHappened: string;
  whyItMatters: string;
  howToFix: string;
  technicalDetails: string;
}

const HISTORY_KEY = 'crawlio_audit_history_v1';
const LEGACY_HISTORY_KEY = 'seointel_audit_history_v1';
const CHECKLIST_PREFIX = 'crawlio_fix_checklist_v1:';
const LEGACY_CHECKLIST_PREFIX = 'seointel_fix_checklist_v1:';
const FINDING_NOTES_PREFIX = 'crawlio_finding_notes_v1:';
const LEGACY_FINDING_NOTES_PREFIX = 'seointel_finding_notes_v1:';
const HISTORY_LIMIT = 40;
const HISTORY_PAGE_LIMIT = 48;
const HISTORY_SIGNATURE_LIMIT = 512;
const HISTORY_CHARACTER_LIMIT = 750_000;
const HISTORY_WRITE_INTERVAL_MS = 5000;
const pendingHistory = new Map<string, AuditHistoryEntry>();
let historyTimer: number | undefined;
let lastHistoryWrite = 0;
let storageListenersInstalled = false;

function hasStorage() {
  try { return typeof window !== 'undefined' && !!window.localStorage; } catch { return false; }
}

export function issueSignature(issue: Pick<ResourceAuditIssue, 'findingKey' | 'title' | 'affectedUrl' | 'category'>) {
  return findingWorkflowKey(issue);
}

export function issueBucket(issue: Pick<ResourceAuditIssue, 'category' | 'title' | 'description'>): Exclude<IssueBucket, 'all'> {
  const text = `${issue.category} ${issue.title} ${issue.description}`.toLowerCase();
  if (/accessibility|accessible name|assistive|aria|tabindex|landmark|page zoom/.test(text)) return 'accessibility';
  if (/security|https|header|cookie|csp|hsts|cors|mixed content|browser/.test(text)) return 'security';
  if (/status|redirect|sitemap|robots|canonical|index|crawl|performance|speed|mobile|schema/.test(text)) return 'technical';
  return 'seo';
}

export function buildIssueInsight(issue: ResourceAuditIssue): IssueInsight {
  const bucket = issueBucket(issue);
  const affected = issue.affectedUrl ? ` on ${issue.affectedUrl}` : '';
  const recommendation = issue.recommendation || `Review the evidence for ${issue.title.toLowerCase()} and correct the affected page or server configuration.`;

  let why = {
    seo: 'This can make the page harder to understand in search results and can reduce click quality.',
    technical: 'This can make the page harder for search engines to access, understand, or trust reliably.',
    accessibility: 'This can make the page harder to understand or operate with a keyboard or assistive technology.',
    security: 'This can reduce browser-side protection signals and client trust, even though Crawlio only runs passive checks.',
  }[bucket];

  const failureCode = String(issue.failureCode || '').toUpperCase();
  const issueText = `${issue.title} ${issue.description}`.toLowerCase();
  if (failureCode === 'HTTP_404' || /\b404\b|not found|4xx pages/.test(issueText)) {
    why = 'Broken destinations create a poor visitor experience, waste internal crawl paths, prevent access to content, and can weaken the value passed through internal links. Sitemap entries and source links should be cleaned up.';
  } else if (failureCode === 'NOINDEX_DETECTED' || /\bnoindex\b/.test(issueText)) {
    why = 'The page is excluded from search indexing. That may be intentional, so review whether it appears in a sitemap, how prominently it is linked internally, and whether the page is meant to rank before changing the directive.';
  } else if (/\b5\d\d\b|server error/.test(issueText)) {
    why = 'Search engines and visitors cannot reliably reach content while the server returns an error. Repeated failures can reduce crawl coverage and leave important pages unavailable.';
  } else if (/missing title|title too (short|long)|multiple title/.test(issueText)) {
    why = 'The page title helps search engines identify the topic and often supplies the main search-result link. A missing, duplicated, or poorly sized title makes that result less clear.';
  } else if (/meta description/.test(issueText)) {
    why = 'Search engines may use the description in the result snippet. Clear, page-specific copy helps people understand the page before they click, although a search engine may choose different text.';
  } else if (/missing h1|multiple h1|heading/.test(issueText)) {
    why = 'A clear heading structure helps visitors scan the page and gives search engines useful context about the main topic and supporting sections.';
  } else if (/canonical|preferred (page )?url/.test(issueText)) {
    why = 'Preferred URL signals help search engines consolidate duplicate addresses. Conflicting or invalid signals can split indexing attention across several versions of the same content.';
  } else if (/robots|crawl blocked|disallow/.test(issueText)) {
    why = 'Search access rules can prevent crawlers from retrieving the page or its supporting resources. A block may be intentional, but important public content should remain reachable.';
  } else if (/sitemap/.test(issueText)) {
    why = 'A sitemap helps search engines discover canonical public pages. Missing, invalid, redirected, or inaccessible entries can slow discovery and waste crawl requests.';
  } else if (/broken link|link.*(404|unavailable)|destination/.test(issueText)) {
    why = 'Links that lead to unavailable destinations interrupt navigation and prevent visitors and crawlers from reaching the intended content.';
  } else if (/alt text|image description|missing alt/.test(issueText)) {
    why = 'Useful image text gives assistive technology and search engines context when an image carries meaning. Decorative images should use an empty alt attribute instead.';
  } else if (/redirect/.test(issueText)) {
    why = 'Unnecessary or conflicting redirects slow navigation and make the final preferred address less clear to visitors and crawlers.';
  } else if (/schema|structured data/.test(issueText)) {
    why = 'Valid structured data helps search engines interpret supported page entities and features. Invalid markup may be ignored and does not guarantee a rich result.';
  } else if (/response time|page size|resource|performance/.test(issueText)) {
    why = 'Large pages and slow server responses can delay navigation and crawling. These audit observations are useful diagnostics, but they are not browser-measured Core Web Vitals.';
  } else if (bucket === 'security') {
    why = 'This public configuration affects browser-side protection or the amount of implementation detail exposed to visitors. The audit reports the signal passively and does not attempt exploitation.';
  }

  return {
    whatHappened: issue.description || `${issue.title}${affected}.`,
    whyItMatters: why,
    howToFix: recommendation,
    technicalDetails: issue.evidence || `No additional evidence was stored for this finding${affected}.`,
  };
}

export function readAuditHistory(): AuditHistoryEntry[] {
  if (!hasStorage()) return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY) || window.localStorage.getItem(LEGACY_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(entry => entry && typeof entry.auditId === 'string').slice(0, HISTORY_LIMIT).map((entry) => ({
      ...entry,
      score: entry?.scoreSource === 'final_report' && Number.isFinite(Number(entry.score)) ? Number(entry.score) : null,
      scoreSource: entry?.scoreSource === 'final_report' ? 'final_report' : 'unavailable',
      issueSignatures: Array.isArray(entry.issueSignatures) ? entry.issueSignatures.slice(0, HISTORY_SIGNATURE_LIMIT) : [],
      topIssues: Array.isArray(entry.topIssues) ? entry.topIssues.slice(0, 12) : [],
      pageSummaries: Array.isArray(entry.pageSummaries) ? entry.pageSummaries.slice(0, HISTORY_PAGE_LIMIT) : [],
    })) : [];
  } catch {
    return [];
  }
}

function writeAuditHistory(entries: AuditHistoryEntry[]) {
  if (!hasStorage()) return;
  const bounded = entries.slice(0, HISTORY_LIMIT);
  while (bounded.length) {
    const serialized = JSON.stringify(bounded);
    if (serialized.length > HISTORY_CHARACTER_LIMIT) { bounded.pop(); continue; }
    try { window.localStorage.setItem(HISTORY_KEY, serialized); return; }
    catch { bounded.pop(); }
  }
}

export function buildHistoryEntry(data: Omit<ResourceAuditLiveData, 'finalReport'> & { finalReport?: Pick<NonNullable<ResourceAuditLiveData['finalReport']>, 'scores'> | null }): AuditHistoryEntry | null {
  const audit = data.audit;
  if (!audit) return null;
  const scores = extractReportScores(data.finalReport?.scores);
  const score = scores.overall;
  const startedAt = audit.startedAt || audit.createdAt;
  const endedAt = audit.completedAt || audit.cancelledAt || (audit.status === 'failed' ? audit.updatedAt : null);
  const durationSeconds = endedAt
    ? Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000))
    : null;
  return {
    auditId: audit.id,
    projectId: audit.projectId,
    normalizedUrl: audit.normalizedUrl,
    hostname: audit.hostname,
    status: audit.status,
    score,
    scoreSource: scores.overall == null ? 'unavailable' : 'final_report',
    scores,
    issuesFound: audit.issuesFound,
    criticalCount: audit.criticalCount,
    highCount: audit.highCount,
    mediumCount: audit.mediumCount,
    lowCount: audit.lowCount,
    pagesCrawled: audit.pagesCrawled,
    pageLimit: audit.pageLimit,
    completedAt: audit.completedAt,
    createdAt: audit.createdAt,
    startedAt: audit.startedAt,
    durationSeconds,
    mode: audit.effectiveMode || audit.mode,
    processingTier: audit.processingTier,
    updatedAt: audit.updatedAt,
    issueSignatures: data.latestIssues.slice(0, HISTORY_SIGNATURE_LIMIT).map(issueSignature),
    topIssues: data.latestIssues.slice(0, 12).map(issue => ({ ...issue, description: String(issue.description || '').slice(0, 1000), evidence: String(issue.evidence || '').slice(0, 1000), recommendation: String(issue.recommendation || '').slice(0, 1000), sourceUrls: issue.sourceUrls?.slice(0, 12) })),
    pageSummaries: data.latestPages.slice(0, HISTORY_PAGE_LIMIT).map((page) => ({
      url: page.url,
      statusCode: page.statusCode,
      crawlDepth: page.crawlDepth,
      issueCount: page.issueCount,
      responseTimeMs: page.responseTimeMs,
      pageSizeBytes: page.pageSizeBytes,
      title: String(page.title || '').slice(0, 256),
      metaDescription: String(page.metaDescription || '').slice(0, 512),
      h1: String(page.h1 || '').slice(0, 512),
      canonicalUrl: page.canonicalUrl,
      siteName: page.siteName,
      faviconUrl: page.faviconUrl,
      openGraphImage: page.openGraphImage,
      themeColor: page.themeColor,
      screenshotUrl: page.screenshotUrl,
    })),
  };
}

export function upsertAuditHistory(data: ResourceAuditLiveData) {
  if (!hasStorage()) return;
  const entry = buildHistoryEntry(data);
  if (!entry || !entry.normalizedUrl) return;
  pendingHistory.set(entry.auditId, entry);
  if (pendingHistory.size > HISTORY_LIMIT) pendingHistory.delete(pendingHistory.keys().next().value!);
  if (!storageListenersInstalled) {
    window.addEventListener('pagehide', flushAuditHistory);
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushAuditHistory(); });
    storageListenersInstalled = true;
  }
  if (isTerminalAuditStatus(data.audit!.status) || Date.now() - lastHistoryWrite >= HISTORY_WRITE_INTERVAL_MS) {
    flushAuditHistory();
  } else if (historyTimer == null) {
    historyTimer = window.setTimeout(flushAuditHistory, HISTORY_WRITE_INTERVAL_MS - (Date.now() - lastHistoryWrite));
  }
}

export function flushAuditHistory() {
  if (historyTimer != null) window.clearTimeout(historyTimer);
  historyTimer = undefined;
  if (!pendingHistory.size || !hasStorage()) return;
  const existing = readAuditHistory();
  const merged = new Map(existing.map(entry => [entry.auditId, entry]));
  for (const entry of pendingHistory.values()) {
    const stored = merged.get(entry.auditId);
    if (stored && isTerminalAuditStatus(stored.status as ResourceAuditDocument['status']) && !isTerminalAuditStatus(entry.status as ResourceAuditDocument['status'])) continue;
    // A delayed live snapshot must not remove a saved final score.
    const next = stored?.scoreSource === 'final_report' && entry.scoreSource !== 'final_report'
      ? { ...entry, score: stored.score, scores: stored.scores, scoreSource: stored.scoreSource }
      : entry;
    merged.set(entry.auditId, next);
  }
  const next = [...merged.values()].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  pendingHistory.clear();
  if (JSON.stringify(next) !== JSON.stringify(existing)) writeAuditHistory(next);
  lastHistoryWrite = Date.now();
}

export function findPreviousAudit(current: AuditHistoryEntry | null, history = readAuditHistory()) {
  if (!current) return null;
  return history
    .filter((entry) => entry.auditId !== current.auditId && entry.normalizedUrl === current.normalizedUrl && isCompletedAuditStatus(entry.status))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0] || null;
}

export function compareAuditIssues(currentIssues: ResourceAuditIssue[], previous: AuditHistoryEntry | null, currentScore?: number | null) {
  const current = new Set(currentIssues.map(issueSignature));
  const previousSet = new Set(previous?.issueSignatures || []);
  const newIssues = currentIssues.filter((issue) => !previousSet.has(issueSignature(issue)));
  const unchangedIssues = currentIssues.filter((issue) => previousSet.has(issueSignature(issue)));
  const fixedCount = Array.from(previousSet).filter((signature) => !current.has(signature)).length;
  return {
    newIssues,
    unchangedIssues,
    fixedCount,
    scoreDelta: previous && currentScore != null && previous.score != null ? currentScore - previous.score : null,
  };
}

export function scoreTrendForUrl(normalizedUrl: string, history = readAuditHistory()) {
  return history
    .filter((entry) => entry.normalizedUrl === normalizedUrl && isCompletedAuditStatus(entry.status))
    .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
    .slice(-6);
}

export function readChecklist(auditId: string): Record<string, ChecklistStatus> {
  if (!hasStorage()) return {};
  try {
    const raw = window.localStorage.getItem(`${CHECKLIST_PREFIX}${auditId}`) || window.localStorage.getItem(`${LEGACY_CHECKLIST_PREFIX}${auditId}`);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeChecklist(auditId: string, statuses: Record<string, ChecklistStatus>) {
  if (!hasStorage()) return;
  window.localStorage.setItem(`${CHECKLIST_PREFIX}${auditId}`, JSON.stringify(statuses));
}

export function clearChecklist(auditId: string) {
  if (!hasStorage() || !auditId) return;
  window.localStorage.removeItem(`${CHECKLIST_PREFIX}${auditId}`);
  window.localStorage.removeItem(`${LEGACY_CHECKLIST_PREFIX}${auditId}`);
}

export function readFindingNotes(auditId: string): Record<string, string> {
  if (!hasStorage() || !auditId) return {};
  try {
    const raw = window.localStorage.getItem(`${FINDING_NOTES_PREFIX}${auditId}`) || window.localStorage.getItem(`${LEGACY_FINDING_NOTES_PREFIX}${auditId}`);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string').slice(0, 200));
  } catch {
    return {};
  }
}

export function writeFindingNotes(auditId: string, notes: Record<string, string>) {
  if (!hasStorage() || !auditId) return;
  const safeNotes = Object.fromEntries(Object.entries(notes).slice(0, 200).map(([key, value]) => [key, String(value).slice(0, 2000)]));
  try {
    window.localStorage.setItem(`${FINDING_NOTES_PREFIX}${auditId}`, JSON.stringify(safeNotes));
  } catch {}
}

export function clearFindingNotes(auditId: string) {
  if (!hasStorage() || !auditId) return;
  window.localStorage.removeItem(`${FINDING_NOTES_PREFIX}${auditId}`);
  window.localStorage.removeItem(`${LEGACY_FINDING_NOTES_PREFIX}${auditId}`);
}

export function checklistCompletion(issues: ResourceAuditIssue[], statuses: Record<string, ChecklistStatus>) {
  const signatures = issues.map(issueSignature);
  const actionable = signatures.length;
  const fixed = signatures.filter((signature) => statuses[signature] === 'fixed').length;
  const ignored = signatures.filter((signature) => statuses[signature] === 'ignored').length;
  return {
    actionable,
    fixed,
    ignored,
    percent: actionable ? Math.round(((fixed + ignored) / actionable) * 100) : 0,
  };
}

export function crawlDepthDistribution(pages: ResourceAuditPage[]) {
  const counts = new Map<number, number>();
  pages.forEach((page) => counts.set(page.crawlDepth, (counts.get(page.crawlDepth) || 0) + 1));
  return Array.from(counts.entries())
    .sort(([a], [b]) => a - b)
    .map(([depth, count]) => ({ label: `Level ${depth}`, value: count }));
}

export function pageHealthBuckets(pages: ResourceAuditPage[]) {
  return [
    { label: 'Clean pages', value: pages.filter((page) => page.issueCount === 0).length },
    { label: 'Needs review', value: pages.filter((page) => page.issueCount > 0 && page.issueCount < 3).length },
    { label: 'High issue pages', value: pages.filter((page) => page.issueCount >= 3).length },
  ];
}
