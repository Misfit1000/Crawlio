import { AuditIssue } from '../../audit/types';
import { CHECK_REGISTRY } from './registry';

export function run(pageData: any, auditId?: string): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const url = pageData.finalUrl || pageData.url || '';
  const d = pageData;

  const p = (id: string, evidence: string) => {
    const c = CHECK_REGISTRY[id];
    if (c) {
      issues.push({ id: c.id, category: c.category, severity: c.severity, title: c.title, description: c.description, recommendation: c.recommendation, affectedUrl: url, evidence });
    }
  };

  try {
    if (new URL(url).protocol !== 'https:') return issues;
  } catch {
    return issues;
  }

  const headers = d.headers ?? d.securityHeaders;
  if (headers && typeof headers === 'object') {
    const hasHsts = Object.entries(headers).some(([name, value]) => name.toLowerCase() === 'strict-transport-security' && String(value || '').trim());
    if (!hasHsts) p('missing-hsts', 'Strict-Transport-Security header is absent from the observed HTTPS response.');
  }

  return issues;
}
