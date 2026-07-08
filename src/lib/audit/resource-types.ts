import {
  AUDIT_LIMITS,
  AUDIT_MODE_CONFIG,
  getAuditModeConfig,
  getAuditModeLabel,
  type AuditMode,
  type AuditModeConfig,
} from './audit-config';

export {
  AUDIT_LIMITS,
  AUDIT_MODE_CONFIG,
  getAuditModeConfig,
  getAuditModeLabel,
  type AuditMode,
  type AuditModeConfig,
};

export type AuditStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AuditSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface ResourceAuditDocument {
  id: string;
  userId: string | null;
  projectId: string | null;
  submittedInput: string;
  normalizedUrl: string;
  finalUrl: string | null;
  hostname: string;
  mode: AuditMode;
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
  completedAt: string | null;
  expiresAt: string;
  cancelledAt: string | null;
  error: string | null;
  lockedBy: string | null;
  lockedAt: string | null;
  leaseExpiresAt: string | null;
  usedHttpFallback?: boolean;
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
  detectedAt: string;
}

export interface ResourceAuditReport {
  scores: Record<string, number>;
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
