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
  if (d.fakeCondition) p('url-reachable', 'Evidence');
  if (d.status !== 200) {
    if (d.status >= 400 && d.status < 500) p('4xx-detected', 'Status ' + d.status);
    if (d.status >= 500) p('5xx-detected', 'Status ' + d.status);
  }
  if (d.url !== d.finalUrl && d.finalUrl) p('redirect-differs', 'Redirects to ' + d.finalUrl);
  if (url.startsWith('http://')) p('https-missing', 'Using HTTP');

  return issues;
}
