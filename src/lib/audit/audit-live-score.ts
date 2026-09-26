import { isCompletedAuditStatus } from './audit-time';
import type { ResourceAuditDocument, ResourceAuditEvent, ResourceAuditReport } from './resource-types';

export type AuditScoreState = 'unavailable' | 'provisional' | 'final';

export interface AuditLiveScoreSnapshot {
  overallScore: number | null;
  categoryScores: Record<string, number | null>;
  scoreState: AuditScoreState;
  pagesAnalysed: number;
  pagesDiscovered: number;
  pageLimit: number;
  unavailableCount: number;
  updatedAt: string | null;
}

function score(value: unknown) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : null;
}

function categoryScores(value: unknown) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, score(item)]));
}

export function getAuditLiveScore(input: {
  audit: ResourceAuditDocument;
  events: ResourceAuditEvent[];
  finalReport?: ResourceAuditReport | null;
}): AuditLiveScoreSnapshot {
  const { audit, finalReport } = input;
  if (isCompletedAuditStatus(audit.status) && finalReport) {
    const scores = finalReport.scores || {};
    return {
      overallScore: score(scores.overall),
      categoryScores: {
        onPage: score(scores.seo), technical: score(scores.technical), crawlability: score(scores.crawlability),
        internalLinks: score(scores.internalLinks), performance: score(scores.performance), mobile: score(scores.mobile),
        security: score(scores.security), structuredData: score(scores.structuredData),
        accessibility: score(scores.accessibility),
      },
      scoreState: 'final',
      pagesAnalysed: audit.pagesCrawled,
      pagesDiscovered: audit.pagesDiscovered,
      pageLimit: audit.pageLimit,
      unavailableCount: Array.isArray(scores.unavailableChecks) ? scores.unavailableChecks.length : audit.warningCount || 0,
      updatedAt: finalReport.generatedAt || audit.completedAt || audit.updatedAt,
    };
  }

  if (audit.status === 'running') {
    const event = [...input.events].reverse().find((item) => item.type === 'score_updated' && (item.data as any)?.scoreState === 'provisional');
    const data = event?.data as Record<string, unknown> | undefined;
    if (event && data) {
      return {
        overallScore: score(data.overallScore),
        categoryScores: categoryScores(data.categoryScores),
        scoreState: 'provisional',
        pagesAnalysed: Number(data.pagesAnalysed ?? audit.pagesCrawled) || 0,
        pagesDiscovered: Number(data.pagesDiscovered ?? audit.pagesDiscovered) || 0,
        pageLimit: Number(data.pageLimit ?? audit.pageLimit) || audit.pageLimit,
        unavailableCount: Number(data.unavailableCount ?? audit.warningCount) || 0,
        updatedAt: String(data.updatedAt || event.timestamp || audit.updatedAt),
      };
    }
  }

  return {
    overallScore: null,
    categoryScores: {},
    scoreState: 'unavailable',
    pagesAnalysed: audit.pagesCrawled,
    pagesDiscovered: audit.pagesDiscovered,
    pageLimit: audit.pageLimit,
    unavailableCount: audit.warningCount || 0,
    updatedAt: null,
  };
}
