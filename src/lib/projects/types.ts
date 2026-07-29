import type { AuditMode, AuditStatus } from '../audit/resource-types';

export type ProjectAuditFrequency = 'manual' | 'weekly' | 'monthly';

export interface ProjectAuditSummary {
  id: string;
  status: AuditStatus;
  score: number | null;
  pagesCrawled: number;
  issuesFound: number;
  criticalCount: number;
  highCount: number;
  completedAt: string | null;
  createdAt: string;
}

export interface ProjectOverviewItem {
  id: string | null;
  name: string;
  normalizedUrl: string;
  hostname: string;
  auditFrequency: ProjectAuditFrequency;
  auditMode: AuditMode;
  nextAuditAt: string | null;
  changeAlertsEnabled: boolean;
  latestAudit: ProjectAuditSummary | null;
  previousAudit: ProjectAuditSummary | null;
  scoreDelta: number | null;
  newCriticalCount: number;
  resolvedFindingCount: number;
  openFindingCount: number;
  recommendedAction: string;
}

export interface ProjectOverviewResponse {
  projects: ProjectOverviewItem[];
  unreadNotifications: number;
  scheduledAuditsEnabled: boolean;
  generatedAt: string;
}
