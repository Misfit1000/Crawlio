import { calculateTransparentAuditScore, toReportScoreRecord } from './audit-scoring';
import type { ResourceAuditIssue, ResourceAuditPage } from './resource-types';

export const PROVISIONAL_SCORE_PAGE_INTERVAL = 5;
export const PROVISIONAL_SCORE_MIN_INTERVAL_MS = 1_500;

export interface ProvisionalScoreCheckpoint {
  pagesAnalysed: number;
  lastPublishedPages: number;
  nowMs: number;
  lastPublishedAtMs: number;
  force?: boolean;
}

export function shouldPublishProvisionalScore(checkpoint: ProvisionalScoreCheckpoint) {
  if (checkpoint.pagesAnalysed < 1 || checkpoint.pagesAnalysed <= checkpoint.lastPublishedPages) return false;
  if (checkpoint.force || checkpoint.lastPublishedPages === 0) return true;
  if (checkpoint.pagesAnalysed - checkpoint.lastPublishedPages < PROVISIONAL_SCORE_PAGE_INTERVAL) return false;
  if (checkpoint.lastPublishedAtMs && checkpoint.nowMs - checkpoint.lastPublishedAtMs < PROVISIONAL_SCORE_MIN_INTERVAL_MS) return false;
  return true;
}

export function buildProvisionalAuditScore(input: {
  issues: ResourceAuditIssue[];
  pages: ResourceAuditPage[];
  pagesAnalysed: number;
  pagesDiscovered: number;
  pageLimit: number;
  unavailableChecks?: string[];
  updatedAt: string;
}) {
  const result = calculateTransparentAuditScore({
    issues: input.issues,
    pages: input.pages,
    unavailableChecks: {
      mobile: ['Browser-rendered device metrics were not collected.'],
      technical: input.unavailableChecks || [],
    },
  });
  const scores = toReportScoreRecord(result);
  return {
    overallScore: result.overall,
    categoryScores: {
      onPage: scores.seo,
      technical: scores.technical,
      crawlability: scores.crawlability,
      internalLinks: scores.internalLinks,
      performance: scores.performance,
      mobile: scores.mobile,
      security: scores.security,
      structuredData: scores.structuredData,
    },
    scoreState: 'provisional' as const,
    pagesAnalysed: input.pagesAnalysed,
    pagesDiscovered: input.pagesDiscovered,
    pageLimit: input.pageLimit,
    unavailableCount: result.unavailableChecks.length,
    updatedAt: input.updatedAt,
  };
}
