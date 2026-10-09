import { AUDIT_GROUP_DETAILS, AUDIT_CHECK_GROUPS, type AuditCheckGroup } from '../lib/audit/audit-scope';

const pages: Record<string, { title: string; description: string; kind: string; slug?: string }> = {
  '/': { title: 'Crawlio website audits', description: 'Find SEO problems, inspect the evidence and choose what to check next.', kind: 'home' },
  '/audits': { title: 'Website audits', description: 'Choose a full audit or focus on one part of your website.', kind: 'audits' },
  '/tools': { title: 'Free SEO tools', description: 'Local tools for metadata, structured data, robots rules and headers.', kind: 'tools' },
  '/pricing': { title: 'Crawlio plans and limits', description: 'Compare Free, Plus and Pro audit allowances and report capabilities.', kind: 'pricing' },
  '/reports/example': { title: 'Example website audit report', description: 'Explore sample findings, evidence and recommended fixes.', kind: 'example' },
};

// Route recognition stays small; detailed copy and tool code load with their page.
export function publicPageForPath(path: string) {
  if (pages[path]) return pages[path];
  const audit = path.match(/^\/audits\/(full|custom|[^/]+)$/)?.[1];
  if (audit === 'full' || audit === 'custom') return { kind: 'audit', slug: audit, title: `${audit === 'full' ? 'Full' : 'Custom'} website audit`, description: 'Choose check groups, coverage and depth for your website.' };
  if (audit && AUDIT_CHECK_GROUPS.includes(audit as AuditCheckGroup)) {
    const group = AUDIT_GROUP_DETAILS[audit as AuditCheckGroup];
    return { kind: 'audit', slug: audit, title: `${group.label} audit`, description: group.description };
  }
  const tool = path.match(/^\/tools\/(metadata|structured-data|robots|headers)$/)?.[1];
  if (tool) return { kind: 'tool', slug: tool, title: `${tool.replace('-', ' ')} tool`, description: 'Work with supplied evidence locally in your browser.' };
  if (['/privacy','/terms','/acceptable-use','/cookies','/contact'].includes(path)) return { kind: 'legal', title: '', description: '' };
  return undefined;
}
