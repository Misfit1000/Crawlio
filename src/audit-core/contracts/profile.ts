/**
 * Canonical audit profile contract (Phase 3).
 */
export interface AuditProfile {
  id: 'quick' | 'standard' | 'deep';
  label: string;
  pageLimit: number;
  candidateLimit: number;
  concurrency: number;
  fetchTimeoutMs: number;
  auditDeadlineMs: number;
  redirectLimit: number;
  sitemapDocumentLimit: number;
  maxLinkExtractionPerPage: number;
  maxResponseBytes: number;
  deepSitemapExpansion: boolean;
  hostPolitenessDelayMs: number;
}
