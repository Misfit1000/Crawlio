export {
  calculateTransparentAuditScore,
  toReportScoreRecord,
  normalizedIssueKey,
  categoryForIssue,
  deduplicatePageIssues,
  type TransparentAuditScore,
  type ScoreDeduction,
  type CategoryScoreResult,
  type AuditScoreCategory,
  type AuditScoreAggregate,
} from '../../lib/audit/audit-scoring';

export {
  buildProvisionalAuditScore,
  shouldPublishProvisionalScore,
  type ProvisionalScoreCheckpoint,
} from '../../lib/audit/audit-provisional-score';

export type ProvisionalAuditScoreSnapshot = ReturnType<typeof import('../../lib/audit/audit-provisional-score').buildProvisionalAuditScore>;
