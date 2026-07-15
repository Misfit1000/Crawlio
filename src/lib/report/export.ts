import type { ResourceAuditLiveData } from '../audit/resource-types';
import { BRAND } from '../brand';

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
    report: data.finalReport ?? null,
    pages: data.latestPages,
    issues: data.latestIssues,
    events: data.latestEvents,
  };
}
