import type { ResourceAuditDocument, ResourceAuditLiveData } from './resource-types';

const ADMISSION_FIELDS = [
  'id', 'processingVersion', 'scope', 'scopeFingerprint', 'planPageLimit', 'userId', 'projectId', 'submittedInput', 'normalizedUrl', 'finalUrl',
  'hostname', 'mode', 'plan', 'requestedMode', 'effectiveMode', 'queuePriority', 'processingTier',
  'quotaCounted', 'workerRuntime', 'estimatedWaitSeconds', 'status', 'progress', 'currentPhase',
  'currentUrl', 'currentCheck', 'pageLimit', 'pagesDiscovered', 'pagesCrawled', 'checksTotal',
  'checksCompleted', 'issuesFound', 'criticalCount', 'highCount', 'mediumCount', 'lowCount',
  'createdAt', 'updatedAt', 'startedAt', 'completedAt', 'expiresAt', 'cancelledAt', 'error',
] as const satisfies readonly (keyof ResourceAuditDocument)[];

export type AuditAdmissionSummary = Pick<ResourceAuditDocument, typeof ADMISSION_FIELDS[number]>;

export interface AuditStartResult {
  auditId: string;
  reusedExistingAudit?: boolean;
  initialAudit?: AuditAdmissionSummary;
}

export function projectAuditAdmission(audit: ResourceAuditDocument): AuditAdmissionSummary {
  return Object.fromEntries(ADMISSION_FIELDS.map(key => [key, audit[key]])) as unknown as AuditAdmissionSummary;
}

const STATUS_FIELDS = [...ADMISSION_FIELDS, 'presentationSummary', 'warningCount', 'failureCounts',
  'usedHttpFallback', 'recoveryAttempts', 'lastRecoveredAt', 'checkpointPagesCrawled', 'checkpointUpdatedAt'] as const satisfies readonly (keyof ResourceAuditDocument)[];
export type AuditStatusSummary = Pick<ResourceAuditDocument, typeof STATUS_FIELDS[number]>;
export function projectAuditStatus(audit: ResourceAuditDocument): AuditStatusSummary {
  return Object.fromEntries(STATUS_FIELDS.map(key => [key, audit[key]])) as unknown as AuditStatusSummary;
}

export function snapshotFromAdmission(result: AuditStartResult): ResourceAuditLiveData | undefined {
  if (result.reusedExistingAudit || !result.initialAudit || result.initialAudit.id !== result.auditId) return undefined;
  const audit = result.initialAudit;
  // Only a newly admitted job has known-empty evidence. Private lease/identity fields are withheld.
  return {
    audit: { ...audit, guestKeyHash: null, lockedBy: null, lockedAt: null, leaseExpiresAt: null },
    latestEvents: [], latestPages: [], latestIssues: [], finalReport: null,
  };
}
