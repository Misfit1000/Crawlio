import type { ResourceAuditIssue } from './resource-types';

export const FINDING_WORKFLOW_STATUSES = ['not_started', 'in_progress', 'fixed', 'ignored', 'reopened', 'accepted_risk'] as const;
export const FINDING_PRIORITY_OVERRIDES = ['critical', 'high', 'medium', 'low', 'info'] as const;

export type FindingWorkflowStatus = typeof FINDING_WORKFLOW_STATUSES[number];
export type FindingPriorityOverride = typeof FINDING_PRIORITY_OVERRIDES[number];

export interface FindingWorkflowRecord {
  id: string;
  auditId: string;
  findingId: string | null;
  findingKey: string;
  status: FindingWorkflowStatus;
  priorityOverride: FindingPriorityOverride | null;
  notes: string;
  dueAt: string | null;
  assignedTo: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
}

export function findingWorkflowKey(issue: Pick<ResourceAuditIssue, 'findingKey' | 'category' | 'title' | 'affectedUrl'>) {
  const stored = String(issue.findingKey || '').trim().toLowerCase();
  if (stored) return stored.slice(0, 512);
  return [issue.category, issue.title, issue.affectedUrl]
    .map((value) => String(value || '').trim().toLowerCase())
    .join('|')
    .slice(0, 512);
}

export function isFindingWorkflowStatus(value: unknown): value is FindingWorkflowStatus {
  return FINDING_WORKFLOW_STATUSES.includes(value as FindingWorkflowStatus);
}

export function isFindingPriorityOverride(value: unknown): value is FindingPriorityOverride {
  return FINDING_PRIORITY_OVERRIDES.includes(value as FindingPriorityOverride);
}
