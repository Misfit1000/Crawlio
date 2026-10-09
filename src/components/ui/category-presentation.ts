import type { AuditCheckGroup } from '../../lib/audit/audit-scope';

export type CategoryTone = 'cobalt' | 'teal' | 'cyan' | 'violet';
export const CATEGORY_TONES: Record<AuditCheckGroup, CategoryTone> = {
  seo: 'cobalt', technical: 'teal', crawlability: 'cyan', links: 'violet',
  performance: 'cyan', 'structured-data': 'violet', accessibility: 'teal', security: 'violet',
};

export function categoryColor(group: AuditCheckGroup) {
  return `var(--category-${CATEGORY_TONES[group]})`;
}
