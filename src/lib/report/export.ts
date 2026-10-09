import type { ResourceAuditLiveData } from '../audit/resource-types';
import { BRAND } from '../brand';
import { auditFocusLabel, auditScopeScoreLabel } from '../audit/audit-scope';
import { scopeEvents, scopeFindings, scopePageEvidence, scopePresentationSummary, scopeScoreMetadata } from './scope-presentation';

const FORMULA_PREFIX = /^[\t\r ]*[=+\-@]/;

export function csvCell(value: unknown) {
  const raw = String(value ?? '');
  const safe = FORMULA_PREFIX.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function csvRow(values: unknown[]) {
  return values.map(csvCell).join(',');
}

export function buildPublicAuditExport(data: ResourceAuditLiveData) {
  const audit = data.audit;
  if (!audit) return null;
  const scope = audit.scope;
  const report = data.finalReport;
  const publicReport = report && scope ? {
    ...report,
    scope,
    scores: scopeScoreMetadata(scope, report.scores),
    topIssues: scopeFindings(scope, report.topIssues),
    pages: report.pages.map(page => scopePageEvidence(scope, { ...page })),
    presentationSummary: scopePresentationSummary(scope, report.presentationSummary || null) || undefined,
  } : report;
  return {
    generator: {
      name: BRAND.name,
      tagline: BRAND.tagline,
    },
    audit: {
      id: audit.id,
      submittedInput: audit.submittedInput,
      normalizedUrl: audit.normalizedUrl,
      finalUrl: audit.finalUrl,
      hostname: audit.hostname,
      mode: audit.mode,
      requestedMode: audit.requestedMode,
      effectiveMode: audit.effectiveMode,
      plan: audit.plan,
      status: audit.status,
      progress: audit.progress,
      pageLimit: audit.pageLimit,
      ...(scope ? { scope, focusLabel: auditFocusLabel(scope), scoreLabel: auditScopeScoreLabel(scope), planPageLimit: audit.planPageLimit } : {}),
      pagesDiscovered: audit.pagesDiscovered,
      pagesCrawled: audit.pagesCrawled,
      checksTotal: audit.checksTotal,
      checksCompleted: audit.checksCompleted,
      issuesFound: audit.issuesFound,
      criticalCount: audit.criticalCount,
      highCount: audit.highCount,
      mediumCount: audit.mediumCount,
      lowCount: audit.lowCount,
      warningCount: audit.warningCount ?? 0,
      failureCounts: audit.failureCounts ?? {},
      usedHttpFallback: audit.usedHttpFallback ?? false,
      createdAt: audit.createdAt,
      startedAt: audit.startedAt,
      completedAt: audit.completedAt,
      cancelledAt: audit.cancelledAt,
      updatedAt: audit.updatedAt,
    },
    report: publicReport ?? null,
    pages: scope ? data.latestPages.map(page => scopePageEvidence(scope, { ...page })) : data.latestPages,
    issues: scopeFindings(scope, data.latestIssues),
    events: scopeEvents(scope, data.latestEvents),
  };
}
