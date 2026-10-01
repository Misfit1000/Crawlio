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

export function getCanonicalProfile(mode: string = 'quick'): AuditProfile {
  if (mode === 'deep') {
    return {
      id: 'deep',
      label: 'Deep audit',
      pageLimit: 75,
      candidateLimit: 300,
      concurrency: 4,
      fetchTimeoutMs: 12000,
      auditDeadlineMs: 10 * 60 * 1000,
      redirectLimit: 5,
      sitemapDocumentLimit: 30,
      maxLinkExtractionPerPage: 2000,
      maxResponseBytes: 2_000_000,
      deepSitemapExpansion: true,
      hostPolitenessDelayMs: 150,
    };
  }
  if (mode === 'standard') {
    return {
      id: 'standard',
      label: 'Standard audit',
      pageLimit: 50,
      candidateLimit: 200,
      concurrency: 3,
      fetchTimeoutMs: 8000,
      auditDeadlineMs: 8 * 60 * 1000,
      redirectLimit: 5,
      sitemapDocumentLimit: 12,
      maxLinkExtractionPerPage: 2000,
      maxResponseBytes: 2_000_000,
      deepSitemapExpansion: false,
      hostPolitenessDelayMs: 150,
    };
  }
  return {
    id: 'quick',
    label: 'Quick audit',
    pageLimit: 5,
    candidateLimit: 25,
    concurrency: 2,
    fetchTimeoutMs: 6000,
    auditDeadlineMs: 60 * 1000,
    redirectLimit: 5,
    sitemapDocumentLimit: 3,
    maxLinkExtractionPerPage: 2000,
    maxResponseBytes: 2_000_000,
    deepSitemapExpansion: false,
    hostPolitenessDelayMs: 150,
  };
}
