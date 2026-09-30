import { AuditIssue } from '../../audit/types';
import { CHECK_REGISTRY } from './registry';

export function run(pageData: any, auditId?: string): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const url = pageData.url || '';
  const d = pageData;

  const p = (id: string, evidence: string, details: Partial<Pick<AuditIssue, 'title' | 'description' | 'recommendation'>>) => {
    const c = CHECK_REGISTRY[id];
    if (c) {
      issues.push({ id: c.id, category: c.category, severity: c.severity, title: c.title, description: c.description, recommendation: c.recommendation, ...details, affectedUrl: url, evidence });
    }
  };

  const requestDurationMs = d.responseTimeMs ?? d.loadTimeMs;
  if (Number.isFinite(requestDurationMs) && requestDurationMs > 1_500) {
    p('slow-server-response', `${requestDurationMs}ms full HTML request duration, including redirects and body download; not TTFB.`, {
      title: 'Slow HTML Request',
      description: 'The full HTML request took more than 1500ms. Time to first byte was not measured.',
    });
  }
  if (Number.isFinite(d.pageSizeBytes) && d.pageSizeBytes > 1_000_000) {
    p('large-page-size', `${d.pageSizeBytes} bytes (${Math.round(d.pageSizeBytes / 1000)}KB) in the fetched HTML response body.`, {
      description: 'The fetched HTML response body exceeds 1MB; linked asset sizes were not measured.',
      recommendation: 'Reduce the HTML response size, including unnecessary markup and inline scripts or styles.',
    });
  }

  return issues;
}
