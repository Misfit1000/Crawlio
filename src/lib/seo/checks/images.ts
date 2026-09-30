import { AuditIssue } from '../../audit/types';
import { CHECK_REGISTRY } from './registry';

export function run(pageData: any, auditId?: string): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const url = pageData.url || '';
  const d = pageData;

  const p = (id: string, evidence: string) => {
    const c = CHECK_REGISTRY[id];
    if (c) {
      issues.push({ id: c.id, category: c.category, severity: c.severity, title: c.title, description: c.description, recommendation: c.recommendation, affectedUrl: url, evidence });
    }
  };

  if (Number.isInteger(d.imagesWithoutAlt) && d.imagesWithoutAlt > 0) {
    p('missing-alt-text', d.imagesWithoutAlt + ' images have no alt attribute; images with empty alt attributes are excluded.');
  }

  return issues;
}
