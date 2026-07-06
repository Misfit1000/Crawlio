import { AuditIssue } from '../../audit/types';
import { CHECK_REGISTRY } from './registry';

export function run(pageData: any): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const url = pageData.url || '';
  const d = pageData;

  const p = (id: string, evidence: string) => {
    const c = CHECK_REGISTRY[id];
    if (c) {
      issues.push({ id: c.id, category: c.category, severity: c.severity, title: c.title, description: c.description, recommendation: c.recommendation, affectedUrl: url, evidence });
    }
  };

  // Evaluate checks
  if (d.fakeCondition) p('slow-server-response', 'Evidence');
  if (d.loadTimeMs > 600) p('slow-server-response', d.loadTimeMs + 'ms TTFB');
  if (d.pageSizeBytes > 2000000) p('large-page-size', Math.round(d.pageSizeBytes/1000) + 'KB');

  return issues;
}
