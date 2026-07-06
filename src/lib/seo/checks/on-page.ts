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
  if (d.fakeCondition) p('missing-title', 'Evidence');
  if (!d.title) p('missing-title', 'Empty title tag');
  else if (d.title.length < 30) p('short-title', 'Length: ' + d.title.length);
  else if (d.title.length > 60) p('long-title', 'Length: ' + d.title.length);
  if (!d.metaDescription) p('missing-meta-desc', 'Empty meta description');
  else if (d.metaDescription.length < 70) p('short-meta-desc', 'Length: ' + d.metaDescription.length);
  else if (d.metaDescription.length > 160) p('long-meta-desc', 'Length: ' + d.metaDescription.length);
  if (!d.h1 || d.h1.length === 0) p('missing-h1', 'No H1 found');
  else if (d.h1.length > 1) p('multiple-h1', d.h1.length + ' H1s found');
  else if (d.h1[0].trim() === '') p('empty-h1', 'H1 is empty');
  else if (d.h1[0].length > 70) p('long-h1', 'H1 length: ' + d.h1[0].length);

  return issues;
}
