import { AUDIT_CHECK_GROUPS, AUDIT_GROUP_DETAILS, auditFocusLabel, scopeIncludesGroup, scopeScoreCategories, type AuditCheckGroup, type AuditScope } from '../audit/audit-scope';
import { classifyReportSection, extractReportScores, type ReportSectionId } from '../audit/report-insights';
import type { AuditPresentationSummary, ResourceAuditEvent, ResourceAuditIssue } from '../audit/resource-types';

const SECTION_GROUP: Record<ReportSectionId, AuditCheckGroup> = {
  'on-page': 'seo', technical: 'technical', mobile: 'technical', crawlability: 'crawlability',
  'internal-links': 'links', performance: 'performance', 'structured-data': 'structured-data',
  accessibility: 'accessibility', security: 'security',
};

export function scopeIncludesReportSection(scope: AuditScope | null | undefined, section: string) {
  return !scope || (section in SECTION_GROUP && scopeIncludesGroup(scope, SECTION_GROUP[section as ReportSectionId]));
}

function checkGroup(checkId?: string): AuditCheckGroup | undefined {
  return AUDIT_CHECK_GROUPS.find(group => AUDIT_GROUP_DETAILS[group].modules.includes(checkId || ''));
}

export function isOperationalFinding(issue: Pick<ResourceAuditIssue, 'failureCode'>) {
  return Boolean(issue.failureCode && !['CHECK_UNAVAILABLE', 'NOINDEX_DETECTED'].includes(issue.failureCode));
}

export function scopeIncludesFinding(scope: AuditScope | null | undefined, issue: Pick<ResourceAuditIssue, 'category' | 'title' | 'description' | 'checkId' | 'failureCode'>) {
  if (!scope || isOperationalFinding(issue)) return true;
  const group = checkGroup(issue.checkId) || SECTION_GROUP[classifyReportSection(issue)];
  return scopeIncludesGroup(scope, group);
}

export function scopeFindings(scope: AuditScope | null | undefined, issues: ResourceAuditIssue[]) {
  return scope ? issues.filter(issue => scopeIncludesFinding(scope, issue)) : issues;
}

export function findingMatchesReportSection(scope: AuditScope | null | undefined, issue: ResourceAuditIssue, section: ReportSectionId) {
  if (scope && isOperationalFinding(issue)) return false;
  const moduleGroup = scope && checkGroup(issue.checkId);
  if (moduleGroup) return moduleGroup === SECTION_GROUP[section] && (section !== 'mobile' || issue.checkId === 'mobile');
  const classified = classifyReportSection(issue);
  return classified === section || (section === 'technical' && classified === 'mobile');
}

export function scopeEvents(scope: AuditScope | null | undefined, events: ResourceAuditEvent[]) {
  return scope ? events.filter(event => !event.checkId || !checkGroup(event.checkId) || scopeIncludesGroup(scope, checkGroup(event.checkId)!)) : events;
}

const SCORE_KEYS = ['onPage', 'seo', 'technical', 'crawlability', 'internalLinks', 'performance', 'mobile', 'security', 'structuredData', 'accessibility'];

export function scopeScoreMetadata(scope: AuditScope | null | undefined, scores?: Record<string, unknown> | null): Record<string, unknown> | null | undefined {
  if (!scores || !scope) return scores;
  const categories = new Set<string>(scopeScoreCategories(scope));
  if (categories.has('onPage')) categories.add('seo');
  const includesCheck = (value: unknown) => {
    if (typeof value !== 'string') return false;
    const group = checkGroup(value);
    return group ? scopeIncludesGroup(scope, group) : categories.has(value);
  };
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(scores)) {
    if (SCORE_KEYS.includes(key)) { if (categories.has(key)) result[key] = value; }
    else if (key === 'categories' && value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = Object.fromEntries(Object.entries(value).filter(([category]) => categories.has(category)));
    } else if (key === 'deductions' && Array.isArray(value)) {
      result[key] = value.filter(item => item && typeof item === 'object' && categories.has(item.category) && !isOperationalFinding(item));
    } else if (['measuredChecks', 'unavailableChecks'].includes(key) && Array.isArray(value)) {
      result[key] = value.filter(includesCheck);
    } else result[key] = value;
  }
  result.scope = scope;
  return result;
}

export function reportCategoryScores(scope: AuditScope | null | undefined, scores?: Record<string, unknown> | null) {
  const snapshot = extractReportScores(scopeScoreMetadata(scope, scores));
  return AUDIT_CHECK_GROUPS.filter(group => scopeIncludesGroup(scope, group)).map(group => ({
    label: AUDIT_GROUP_DETAILS[group].label,
    value: snapshot[group === 'seo' ? 'seo' : AUDIT_GROUP_DETAILS[group].category as keyof typeof snapshot],
  })).filter((item): item is { label: string; value: number } => item.value != null);
}

export function scopePresentationSummary(scope: AuditScope | null | undefined, summary: AuditPresentationSummary | null) {
  if (!summary || !scope) return summary;
  return { ...summary,
    findingsBySection: Object.fromEntries(Object.entries(summary.findingsBySection).filter(([section]) => scopeIncludesReportSection(scope, section))),
    topRecommendations: summary.topRecommendations.filter(item => scopeIncludesFinding(scope, { ...item, description: '' })),
  };
}

const PAGE_GROUP_FIELDS: Partial<Record<AuditCheckGroup, string[]>> = {
  seo: ['title', 'metaDescription', 'h1', 'wordCount'],
  crawlability: ['canonicalUrl'],
  links: ['anchorText'],
  performance: ['responseTimeMs', 'pageSizeBytes'],
  'structured-data': ['siteName', 'openGraphImage'],
};
const TOOL_GROUP_FIELDS: Record<AuditCheckGroup, string[]> = {
  seo: [], technical: ['contentType', 'redirected', 'lastModified'],
  crawlability: ['metaRobots', 'xRobotsTag', 'robotsAllowed'], links: ['outgoingInternalLinks'],
  performance: [], 'structured-data': ['ogTitle', 'ogDescription'], accessibility: [], security: ['securityHeaders'],
};

export function scopePageEvidence(scope: AuditScope | null | undefined, page: Record<string, unknown>) {
  if (!scope) return page;
  const result = { ...page };
  for (const group of AUDIT_CHECK_GROUPS) {
    if (!scopeIncludesGroup(scope, group)) for (const field of PAGE_GROUP_FIELDS[group] || []) delete result[field];
  }
  // A focused result does not retain an unrelated preview or fabricate tool measurements.
  if (scope.focus !== 'full') for (const field of ['faviconUrl', 'themeColor', 'screenshotUrl']) delete result[field];
  if (result.toolEvidence && typeof result.toolEvidence === 'object') {
    const evidence = result.toolEvidence as Record<string, unknown>;
    const fields = ['version', ...scope.checkGroups.flatMap(group => TOOL_GROUP_FIELDS[group])];
    result.toolEvidence = Object.fromEntries(Object.entries(evidence).filter(([field]) => fields.includes(field)));
  }
  return result;
}

export function pageCsvFields(scope?: AuditScope | null) {
  const fields = ['statusCode', 'url', 'responseTimeMs', 'pageSizeBytes', 'title', 'wordCount', 'crawlDepth', 'issueCount'];
  return fields.filter(field => !scope || Object.hasOwn(scopePageEvidence(scope, { [field]: true }), field));
}

export function auditScopeProgressLabel(audit: { scope?: AuditScope | null; currentPhase?: string; status?: string }) {
  if (!audit.scope) return audit.currentPhase || 'Audit progress';
  return `${auditFocusLabel(audit.scope)}: ${audit.status === 'queued' ? 'waiting to start' : `checking ${audit.scope.coverage === 'page' ? 'this page' : 'selected pages'}`}`;
}
