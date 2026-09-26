import {
  AUDIT_LIMITS,
  getAuditModeConfig,
  type AuditMode,
} from './audit-config';

export {
  AUDIT_LIMITS,
  getAuditModeConfig,
  type AuditMode,
};

export type AuditStatus = 'queued' | 'running' | 'completed' | 'completed_with_warnings' | 'failed' | 'cancelled' | 'abandoned';
export type AuditSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type UserPlan = 'free' | 'paid' | 'agency' | 'admin';
export type ProcessingTier = 'free' | 'paid' | 'agency' | 'admin';

export interface ResourceAuditDocument {
  id: string;
  userId: string | null;
  guestKeyHash: string | null;
  projectId: string | null;
  submittedInput: string;
  normalizedUrl: string;
  finalUrl: string | null;
  hostname: string;
  mode: AuditMode;
  plan: UserPlan;
  requestedMode: AuditMode;
  effectiveMode: AuditMode;
  queuePriority: number;
  processingTier: ProcessingTier;
  quotaCounted: boolean;
  workerRuntime: string | null;
  estimatedWaitSeconds: number | null;
  status: AuditStatus;
  progress: number;
  currentPhase: string;
  currentUrl: string | null;
  currentCheck: string | null;
  pageLimit: number;
  pagesDiscovered: number;
  pagesCrawled: number;
  checksTotal: number;
  checksCompleted: number;
  issuesFound: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string;
  cancelledAt: string | null;
  error: string | null;
  lockedBy: string | null;
  lockedAt: string | null;
  leaseExpiresAt: string | null;
  usedHttpFallback?: boolean;
  warningCount?: number;
  failureCounts?: Record<string, number>;
  archivedAt?: string | null;
  deletedAt?: string | null;
  recoveryAttempts?: number;
  lastRecoveredAt?: string | null;
  checkpointPagesCrawled?: number;
  checkpointUpdatedAt?: string | null;
  checkpointState?: Record<string, unknown> | null;
}

export interface ResourceAuditEvent {
  id: string;
  type: string;
  timestamp: string;
  message: string;
  phase?: string;
  currentUrl?: string | null;
  affectedUrl?: string | null;
  category?: string;
  checkId?: string;
  checkTitle?: string;
  severity?: AuditSeverity;
  progress?: number;
  data?: unknown;
}

export interface ResourceAuditPage {
  id: string;
  url: string;
  statusCode: number;
  responseTimeMs: number;
  pageSizeBytes: number;
  title: string;
  metaDescription: string;
  h1: string;
  canonicalUrl?: string;
  siteName?: string;
  faviconUrl?: string;
  openGraphImage?: string;
  themeColor?: string;
  screenshotUrl?: string;
  fetchStatus?: 'success' | 'failed' | 'blocked';
  failureCode?: string;
  failureCategory?: string;
  safeTitle?: string;
  safeExplanation?: string;
  suggestedAction?: string;
  retryable?: boolean;
  attemptCount?: number;
  recoveredAfterRetry?: boolean;
  sourceUrl?: string;
  anchorText?: string;
  wordCount: number;
  crawlDepth: number;
  issueCount: number;
  crawledAt: string;
}

export interface ResourceAuditIssue {
  id: string;
  severity: AuditSeverity;
  category: string;
  title: string;
  description: string;
  affectedUrl: string;
  evidence: string;
  recommendation: string;
  checkId?: string;
  failureCode?: string;
  findingKey?: string;
  sourceUrls?: string[];
  affectedPageCount?: number;
  detectedAt: string;
}

export interface ResourceAuditReport {
  scores: Record<string, unknown>;
  summary: string;
  topIssues: ResourceAuditIssue[];
  pages: ResourceAuditPage[];
  exports: {
    json: string;
    issuesCsv: string;
    pagesCsv: string;
  };
  generatedAt: string;
}

export interface ResourceAuditLiveData {
  audit: ResourceAuditDocument | null;
  latestEvents: ResourceAuditEvent[];
  latestPages: ResourceAuditPage[];
  latestIssues: ResourceAuditIssue[];
  finalReport?: ResourceAuditReport | null;
}

export interface ResourceAuditLivePatch {
  partial: true;
  audit: ResourceAuditDocument;
  latestEvents?: ResourceAuditEvent[];
  latestPages?: ResourceAuditPage[];
  latestIssues?: ResourceAuditIssue[];
  finalReport?: ResourceAuditReport | null;
}

export type AuditReportSummary = Pick<ResourceAuditReport, 'scores' | 'summary' | 'generatedAt'>;

export interface AuditHistoryItem<TReport = ResourceAuditReport> {
  audit: ResourceAuditDocument;
  finalReport: TReport | null;
}

export interface AuditHistoryPage<TReport = ResourceAuditReport> {
  items: AuditHistoryItem<TReport>[];
  total: number;
  limit: number;
  offset: number;
}

export interface AuditComparison {
  currentAuditId: string;
  baselineAuditId: string;
  normalizedUrl: string;
  currentScore: number | null;
  baselineScore: number | null;
  scoreDelta: number | null;
  newIssues: ResourceAuditIssue[];
  resolvedIssues: ResourceAuditIssue[];
  persistentIssues: Array<{ current: ResourceAuditIssue; baseline: ResourceAuditIssue }>;
}
