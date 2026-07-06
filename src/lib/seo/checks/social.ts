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
  if (d.fakeCondition) p('missing-og-title', 'Evidence');
  if (!d.ogTitle) p('missing-og-title', 'Missing og:title');
  if (!d.ogDescription) p('missing-og-description', 'Missing og:description');
  if (!d.ogImage) p('missing-og-image', 'Missing og:image');
  if (!d.twitterCard) p('missing-twitter-card', 'Missing twitter:card');

  return issues;
}
