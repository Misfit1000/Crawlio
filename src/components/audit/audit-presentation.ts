import type { ResourceAuditDocument, ResourceAuditIssue, ResourceAuditPage, ResourceAuditReport } from '../../lib/audit/resource-types';
import { readAuditPresentationSummary } from '../../lib/audit/audit-presentation-summary';
import { classifyReportSection, groupRecommendations, observedPageMetrics } from '../../lib/audit/report-insights';

export function completePresentationSummary(audit: ResourceAuditDocument | null, report?: ResourceAuditReport | null) {
  return readAuditPresentationSummary(report?.presentationSummary) ?? readAuditPresentationSummary(audit?.presentationSummary) ?? null;
}

export function samplePresentation(pages: ResourceAuditPage[], issues: ResourceAuditIssue[]) {
  const metrics = observedPageMetrics(pages);
  const responseOutcomes = { success: 0, redirect: 0, clientError: 0, serverError: 0, unavailable: 0 };
  const depthCounts: Record<string, number> = {};
  const findingsBySection: Record<string, number> = {};
  for (const page of pages) {
    const code = page.statusCode;
    if (code < 200 || code >= 600 || !Number.isFinite(code)) responseOutcomes.unavailable++;
    else if (code < 300) responseOutcomes.success++;
    else if (code < 400) responseOutcomes.redirect++;
    else if (code < 500) responseOutcomes.clientError++;
    else responseOutcomes.serverError++;
    depthCounts[String(Math.max(0, page.crawlDepth || 0))] = (depthCounts[String(Math.max(0, page.crawlDepth || 0))] || 0) + 1;
  }
  for (const issue of issues) {
    const section = classifyReportSection(issue);
    findingsBySection[section] = (findingsBySection[section] || 0) + 1;
  }
  return {
    responseOutcomes,
    delivery: { averageResponseMs: metrics.averageResponseMs, averagePageBytes: metrics.averagePageBytes },
    attemptedPages: pages.length,
    pagesWithFindings: pages.filter(page => page.issueCount > 0).length,
    depthCounts,
    findingsBySection,
    topRecommendations: groupRecommendations(issues).slice(0, 4).map(group => ({ key: group.id, title: group.title, category: group.category, severity: group.severity, affectedPages: group.affectedCount, recommendation: group.recommendation })),
  };
}
