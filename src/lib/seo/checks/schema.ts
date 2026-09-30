import { AuditIssue } from '../../audit/types';
import { CHECK_REGISTRY } from './registry';

export function run(pageData: any, auditId?: string): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const url = pageData.url || '';
  const d = pageData;

  const p = (id: string, evidence: string) => {
    const c = CHECK_REGISTRY[id];
    if (c) {
      const recommendation = id === 'json-ld-missing'
        ? 'Add appropriate JSON-LD where useful. JSON syntax alone does not establish search-feature eligibility.'
        : c.recommendation;
      issues.push({ id: c.id, category: c.category, severity: c.severity, title: c.title, description: c.description, recommendation, affectedUrl: url, evidence });
    }
  };

  if (!Array.isArray(d.jsonLd)) return issues;
  if (d.jsonLd.length === 0) p('json-ld-missing', 'No JSON-LD script tags in the downloaded HTML.');
  const invalidScripts: number[] = [];
  d.jsonLd.forEach((source: unknown, index: number) => {
    if (typeof source !== 'string') return;
    try {
      JSON.parse(source);
    } catch {
      invalidScripts.push(index + 1);
    }
  });
  if (invalidScripts.length > 0) {
    p('invalid-json-ld', `Invalid JSON syntax in JSON-LD script(s): ${invalidScripts.join(', ')}. Only syntax was checked, not schema semantics or search-feature eligibility.`);
  }

  return issues;
}
