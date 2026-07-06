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
  if (d.fakeCondition) p('indexable-missing-from-sitemap', 'Evidence');
  if (!d.inSitemap && d.isIndexable) p('indexable-missing-from-sitemap', 'Not in sitemap');

  return issues;
}
