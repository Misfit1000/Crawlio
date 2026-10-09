import { calculateTransparentAuditScore, toReportScoreRecord, type AuditScoreAggregate } from './audit-scoring';
import { scoreOptions } from './scalable-item-analysis';
import { readAuditPresentationSummary } from './audit-presentation-summary';
import { auditFocusLabel, scopeIncludesGroup } from './audit-scope';
import { AUDIT_ENGINE_VERSION, CHECK_REGISTRY_VERSION } from '../platform/version';
import type { CrawlRun } from '../supabase/scalable-audit-repository';
import type { ResourceAuditDocument, ResourceAuditIssue, ResourceAuditPage, ResourceAuditReport } from './resource-types';

export function buildScalableReport(audit: ResourceAuditDocument, run: CrawlRun, aggregate: AuditScoreAggregate,
  pages: ResourceAuditPage[], topIssues: ResourceAuditIssue[], timedOut: boolean): { report: ResourceAuditReport; reason: string } {
  const score = calculateTransparentAuditScore({ issues: [], pages: [], aggregate, ...scoreOptions(run, audit),
    limitations: ['Scores cover the automated checks actually run, not every possible requirement.',
      ...(scopeIncludesGroup(audit.scope, 'performance') ? ['Response timing measures the HTML request, not Core Web Vitals or time to first byte.'] : []),
      ...(scopeIncludesGroup(audit.scope, 'links') ? ['Internal-link observations do not verify every destination or measure external backlinks.'] : []),
      ...(scopeIncludesGroup(audit.scope, 'security') ? ['Passive security checks inspect HTTPS, headers and HTML; they are not penetration testing.'] : []),
      ...(scopeIncludesGroup(audit.scope, 'technical') ? ['Mobile observations inspect static HTML, not browser-rendered layout.'] : [])],
    unavailableChecks: { mobile: ['Browser-rendered layout and Core Web Vitals were not collected.'],
      technical: run.unavailable_count ? [`${run.unavailable_count} check groups could not complete.`] : [] } });
  const reason = run.analysed >= audit.pageLimit ? audit.scope?.coverage === 'page' ? 'selected_page_completed' : 'page_limit_reached'
    : timedOut ? 'audit_deadline_reached' : run.discovered >= run.candidate_limit ? 'safety_limit_reached' : 'crawl_queue_exhausted';
  const report: ResourceAuditReport = { scope: audit.scope, scores: { ...toReportScoreRecord(score), ...(audit.scope ? { scope: audit.scope } : {}),
    auditEngineVersion: AUDIT_ENGINE_VERSION, scoringVersion: scoreOptions(run, audit).scoringVersion, checkRegistryVersion: CHECK_REGISTRY_VERSION,
    processingVersion: 2, unavailableCount: run.unavailable_count, evidenceSample: true, checkCountUnit: 'groups',
    coverage: { pagesDiscovered: run.discovered, pagesAttempted: run.attempted, pagesAnalysed: run.analysed, pagesFailed: run.failed,
      pagesBlocked: run.blocked, pageLimit: audit.pageLimit, coveragePercent: Math.round(100 * run.analysed / audit.pageLimit),
      discoveredCoveragePercent: run.discovered ? Math.round(100 * run.analysed / run.discovered) : null,
      quotaReached: run.analysed >= audit.pageLimit, stopReason: reason } },
    summary: `${auditFocusLabel(audit.scope)}: analysed ${run.analysed} of up to ${audit.pageLimit} pages. ${run.failed} failed and ${run.blocked} were blocked. Evidence for the selected checks is available in the report and exports.`,
    presentationSummary: readAuditPresentationSummary(run.presentation_summary), pages, topIssues,
    exports: { json: `/api/tools/audit/export/${audit.id}/json`, issuesCsv: `/api/tools/audit/export/${audit.id}/issues.csv`, pagesCsv: `/api/tools/audit/export/${audit.id}/pages.csv` },
    generatedAt: new Date().toISOString() };
  return { report, reason };
}
