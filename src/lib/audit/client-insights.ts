import type { ResourceAuditDocument, ResourceAuditIssue, ResourceAuditLiveData, ResourceAuditPage } from './resource-types';
import { extractReportScores, type ReportScoreSnapshot } from './report-insights';

export type ChecklistStatus = 'not_started' | 'in_progress' | 'fixed' | 'ignored';
export type IssueBucket = 'all' | 'seo' | 'technical' | 'security';

export interface AuditHistoryEntry {
  auditId: string;
  projectId: string | null;
  normalizedUrl: string;
  hostname: string;
  status: string;
  score: number;
  scoreSource?: 'final_report' | 'issue_weight';
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
  }>;
}

export interface IssueInsight {
  whatHappened: string;
  whyItMatters: string;
  howToFix: string;
  technicalDetails: string;
}

const HISTORY_KEY = 'seointel_audit_history_v1';
const CHECKLIST_PREFIX = 'seointel_fix_checklist_v1:';

function hasStorage() {
  return typeof window !== 'undefined' && !!window.localStorage;
}

export function scoreFromAudit(audit: Pick<ResourceAuditDocument, 'criticalCount' | 'highCount' | 'mediumCount' | 'lowCount'>) {
  return Math.max(0, Math.min(100, 100 - audit.criticalCount * 12 - audit.highCount * 7 - audit.mediumCount * 3 - audit.lowCount));
}

export function issueSignature(issue: Pick<ResourceAuditIssue, 'title' | 'affectedUrl' | 'category'>) {
  return [issue.category, issue.title, issue.affectedUrl].map((value) => String(value || '').trim().toLowerCase()).join('|');
}

export function issueBucket(issue: Pick<ResourceAuditIssue, 'category' | 'title' | 'description'>): Exclude<IssueBucket, 'all'> {
  const text = `${issue.category} ${issue.title} ${issue.description}`.toLowerCase();
  if (/security|https|header|cookie|csp|hsts|cors|mixed content|browser/.test(text)) return 'security';
  if (/status|redirect|sitemap|robots|canonical|index|crawl|performance|speed|mobile|schema/.test(text)) return 'technical';
  return 'seo';
}

export function buildIssueInsight(issue: ResourceAuditIssue): IssueInsight {
  const bucket = issueBucket(issue);
  const affected = issue.affectedUrl ? ` on ${issue.affectedUrl}` : '';
  const recommendation = issue.recommendation || 'Review the page and apply the recommended SEOIntel fix.';

  const why = {
    seo: 'This can make the page harder to understand in search results and can reduce click quality.',
    technical: 'This can make the page harder for search engines to access, understand, or trust reliably.',
    security: 'This can reduce browser-side protection signals and client trust, even though SEOIntel only runs passive checks.',
  }[bucket];

  return {
    whatHappened: issue.description || `${issue.title}${affected}.`,
    whyItMatters: why,
    howToFix: recommendation,
    technicalDetails: issue.evidence || `${issue.category} issue detected${affected}.`,
  };
}

export function readAuditHistory(): AuditHistoryEntry[] {
  if (!hasStorage()) return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAuditHistory(entries: AuditHistoryEntry[]) {
  if (!hasStorage()) return;
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 40)));
}

export function buildHistoryEntry(data: ResourceAuditLiveData): AuditHistoryEntry | null {
  const audit = data.audit;
  if (!audit) return null;
  const scores = extractReportScores(data.finalReport?.scores);
  const score = scores.overall ?? scoreFromAudit(audit);
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
    scoreSource: scores.overall == null ? 'issue_weight' : 'final_report',
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
    issueSignatures: data.latestIssues.map(issueSignature),
    topIssues: data.latestIssues.slice(0, 12),
    pageSummaries: data.latestPages.map((page) => ({
      url: page.url,
      statusCode: page.statusCode,
      crawlDepth: page.crawlDepth,
      issueCount: page.issueCount,
      responseTimeMs: page.responseTimeMs,
      pageSizeBytes: page.pageSizeBytes,
      title: page.title,
      metaDescription: page.metaDescription,
    })),
  };
}

export function upsertAuditHistory(data: ResourceAuditLiveData) {
  const entry = buildHistoryEntry(data);
  if (!entry || !entry.normalizedUrl) return;
  const existing = readAuditHistory().filter((item) => item.auditId !== entry.auditId);
  writeAuditHistory([entry, ...existing].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
}

export function findPreviousAudit(current: AuditHistoryEntry | null, history = readAuditHistory()) {
  if (!current) return null;
  return history
    .filter((entry) => entry.auditId !== current.auditId && entry.normalizedUrl === current.normalizedUrl && entry.status === 'completed')
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
    scoreDelta: previous && currentScore != null ? currentScore - previous.score : null,
  };
}

export function scoreFromIssues(issues: Array<Pick<ResourceAuditIssue, 'severity'>>) {
  const counts = issues.reduce(
    (acc, issue) => {
      if (issue.severity === 'critical') acc.critical += 1;
      else if (issue.severity === 'high') acc.high += 1;
      else if (issue.severity === 'medium') acc.medium += 1;
      else if (issue.severity === 'low') acc.low += 1;
      return acc;
    },
    { critical: 0, high: 0, medium: 0, low: 0 },
  );
  return Math.max(0, Math.min(100, 100 - counts.critical * 12 - counts.high * 7 - counts.medium * 3 - counts.low));
}

export function scoreTrendForUrl(normalizedUrl: string, history = readAuditHistory()) {
  return history
    .filter((entry) => entry.normalizedUrl === normalizedUrl && entry.status === 'completed')
    .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
    .slice(-6);
}

export function readChecklist(auditId: string): Record<string, ChecklistStatus> {
  if (!hasStorage()) return {};
  try {
    const raw = window.localStorage.getItem(`${CHECKLIST_PREFIX}${auditId}`);
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
