import type { AuditIssue } from '../../lib/audit/types';
import type { AuditSeverity, ResourceAuditIssue } from '../../lib/audit/resource-types';
import { runAllChecksSafely, runAllChecks, CHECKS, AUDIT_CHECK_COUNT, type SafeCheckRunResult, type UnavailableAuditCheck } from '../../lib/seo/checks/runner';
import { CHECK_REGISTRY, registerCheck, type SeoCheck } from '../../lib/seo/checks/registry';
import { buildSecurityIssues, type SecurityCheckInput } from './security-checks';

export {
  runAllChecksSafely,
  runAllChecks,
  CHECKS,
  AUDIT_CHECK_COUNT,
  CHECK_REGISTRY,
  registerCheck,
  buildSecurityIssues,
  type SafeCheckRunResult,
  type UnavailableAuditCheck,
  type SeoCheck,
  type SecurityCheckInput,
};

function toSeverity(value: string | undefined): AuditSeverity {
  if (value === 'critical' || value === 'high' || value === 'medium' || value === 'low' || value === 'info') {
    return value;
  }
  return 'medium';
}

export function mapAuditIssue(issue: AuditIssue, fallbackUrl: string): Omit<ResourceAuditIssue, 'id' | 'detectedAt'> {
  const affectedUrl = issue.affectedUrl || fallbackUrl;
  return {
    severity: toSeverity(issue.severity),
    category: String(issue.category || 'seo'),
    title: issue.title || 'Audit issue',
    description: issue.description || issue.title || 'Audit issue detected.',
    affectedUrl,
    evidence: issue.evidence || issue.element || '',
    recommendation: issue.recommendation || 'Review this item and update the affected page.',
    checkId: issue.id,
    findingKey: `${issue.id}|${affectedUrl}`.toLowerCase(),
    sourceUrls: [],
    affectedPageCount: 1,
  };
}
