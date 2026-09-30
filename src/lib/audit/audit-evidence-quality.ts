import type { AuditScoreCategory } from './audit-scoring';
import type { ResourceAuditDocument } from './resource-types';

const MODULE_CATEGORIES: Record<string, AuditScoreCategory> = {
  images: 'onPage', 'on-page': 'onPage', content: 'onPage',
  indexability: 'crawlability', robots: 'crawlability', sitemap: 'crawlability',
  technical: 'technical', links: 'internalLinks', performance: 'performance',
  security: 'security', schema: 'structuredData', social: 'structuredData',
  accessibility: 'accessibility',
};

export function measuredAuditCategories(completedModules: string[]) {
  // Mobile layout and Core Web Vitals require browser evidence, not just a viewport tag.
  return [...new Set<AuditScoreCategory>(['technical', 'security',
    ...completedModules.flatMap((id) => MODULE_CATEGORIES[id] ? [MODULE_CATEGORIES[id]] : []),
  ])];
}

export function storedMeasuredAuditCategories(value: unknown): AuditScoreCategory[] {
  const supported = new Set<AuditScoreCategory>(Object.values(MODULE_CATEGORIES));
  return Array.isArray(value) ? [...new Set(value.filter((item): item is AuditScoreCategory => supported.has(item)))] : [];
}

export function auditCoverage(audit: Pick<ResourceAuditDocument, 'pagesCrawled' | 'pagesDiscovered' | 'pageLimit'>) {
  const analysed = Math.max(0, audit.pagesCrawled);
  const discovered = Math.max(analysed, audit.pagesDiscovered);
  return {
    analysed, discovered, allowance: Math.max(1, audit.pageLimit),
    discoveredPercent: discovered ? Math.min(100, Math.round(100 * analysed / discovered)) : null,
    allowancePercent: Math.min(100, Math.round(100 * analysed / Math.max(1, audit.pageLimit))),
  };
}
