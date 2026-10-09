export type OperationsRange = '24h' | '7d' | '30d';
export type PriorityLevel = 'normal' | 'elevated' | 'urgent';
export type AuditAction = 'cancel' | 'retry' | 'requeue' | 'priority';
export type AdminRecord = Record<string, any> & { id: string };
export interface AdminPage<T> { rows: T[]; hasMore: boolean }
export interface ComponentHealth { status: string; reason: string }
export interface OperationsWorker {
  id: string; state: string; lastSeenAt: string | null; databaseConnected: boolean | null;
  currentAuditId: string | null; commitIdentifier: string | null; apiSchemaVersion: string | number | null;
  auditEngineVersion: string | null; scoringVersion: string | null; deepAuditEnabled: boolean | null; leaseExpiresAt?: string | null;
}
export interface AdminActionRecord {
  id: string; action: string; targetType: string | null; targetId: string | null; reason: string;
  createdAt: string; outcome: string | null; before?: unknown; after?: unknown; requestId?: string; actorId?: string;
}
export interface OperationsData {
  observedAt: string; status: string; reasons: string[];
  components: Record<'api' | 'database' | 'worker' | 'queue' | 'deployment', ComponentHealth>;
  metrics: { audits: number; completed: number; warnings: number; failed: number; abandoned: number; successRate: number | null; medianDurationSeconds: number | null }; // successRate is 0-100.
  queue: { queued: number; running: number; oldestQueuedSeconds: number | null; medianWaitSeconds: number | null; staleLeases: number; byMode: Record<string, number>; byPlan: Record<string, number> };
  workers: OperationsWorker[];
  deployment: { applicationCommit: string | null; workerCommit: string | null; expectedSchemaVersion: string | number | null; databaseSchemaVersion: string | number | null; appliedMigration: string | null; compatible: boolean | null; commitMismatch: boolean | null };
  trend: Array<{ day: string; audits: number; completed: number; warnings: number; failed: number; medianDurationSeconds: number | null }>;
  recentFailures: Array<{ id: string; domain: string; status: string; error: string | null; createdAt: string; failureClass: string | null; failureCode: string | null }>;
  recentActions: AdminActionRecord[];
}
export interface UserDetail {
  profile: AdminRecord;
  usage: { dailyUsed: number; monthlyUsed: number; dailyLimit: number; monthlyLimit: number; queued: number; running: number; totalAudits: number; completed: number; warnings: number; failed: number };
  latestAudit: AdminRecord | null;
}
export interface AuditDetail { audit: AdminRecord; diagnostics: AdminRecord[] | Record<string, unknown>; processing?: Record<string, unknown> | null; failureClass: string | null; retryEligible: boolean; worker: { id: string | null; leaseExpiresAt?: string | null; lastHeartbeatAtFailure?: string | null } | OperationsWorker | null }
export interface ActionResult {
  outcome?: string; confirmedState?: Record<string, unknown> | string; before?: unknown; after?: unknown;
  auditId?: string; originalAuditId?: string; newAuditId?: string; retryAuditId?: string; attemptId?: string; quotaCharged?: boolean; quotaExempt?: boolean;
  requestId?: string; reason?: string; status?: string; action?: string; warning?: string;
  [key: string]: unknown;
}
export interface AdminSearchResults { users: AdminRecord[]; audits: AdminRecord[]; schedules: AdminRecord[] }
export interface AdminResources {
  observedAt: string; relations: Array<{ name: string; bytes: number; approximateRows: number | null; oldestAt: string | null; retentionDays: number | null; retentionDescription?: string; automaticCleanup?: boolean }>;
  quotaAvailability: 'provider-dashboard-only';
}
export interface RetentionPreview { fingerprint: string; expiresAt: string; audits: number; associatedRows: number | Record<string, number>; totalEligible: number }
