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

  const canonicalRaw = typeof d.canonicalRaw === 'string' ? d.canonicalRaw.trim() : undefined;
  if (!d.canonical) {
    p('missing-canonical', canonicalRaw
      ? `Canonical href does not resolve to a supported HTTP(S) URL: ${canonicalRaw}`
      : 'No canonical URL');
  } else {
    const canonicalHref = canonicalRaw ?? d.canonical;
    try {
      new URL(canonicalHref);
    } catch {
      p('relative-canonical', `Relative canonical href: ${canonicalHref}; resolved URL: ${d.canonical}`);
    }
  }
  if (d.metaRobots && d.metaRobots.toLowerCase().includes('noindex')) p('meta-noindex', 'Meta robots noindex');

  return issues;
}
