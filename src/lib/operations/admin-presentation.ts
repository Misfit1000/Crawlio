import { customerSafeDiagnosticText } from '../audit/audit-failures';
import { MINIMUM_AUDIT_DATABASE_SCHEMA_VERSION } from '../platform/version';
import type { OperationalStatus } from './health';

export function classifyOperationalFailure(code?: string | null) {
  if (!code) return 'unknown';
  if (/SSRF|PRIVATE|UNSAFE|DISALLOWED/i.test(code)) return 'security-policy';
  if (/WORKER|DATABASE|QUEUE|LEASE|SCORING|REPORT|INTERNAL/i.test(code)) return 'system';
  if (/TARGET|DNS|TIMEOUT|TLS|HTTP|ROBOTS|FETCH|NETWORK|RESPONSE|CONTENT|REDIRECT/i.test(code)) return 'target-site';
  return 'unknown';
}

export function safeAdminAction(row: Record<string, any>) {
  const metadata = row.metadata || {};
  return { id: row.id, action: row.action, targetType: row.target_type, targetId: row.target_id,
    requestId: row.request_id || undefined, reason: customerSafeDiagnosticText(metadata.reason) || '', createdAt: row.created_at,
    outcome: metadata.outcome || metadata.result?.outcome || 'recorded',
    before: redactAdminValues(metadata.before), after: redactAdminValues(metadata.after) };
}

export function redactAdminValues(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[bounded]';
  if (Array.isArray(value)) return value.slice(0, 25).map(item => redactAdminValues(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/secret|token|password|credential|guest.?key|ip.?hash|internal|connection.?string/i.test(key))
    .slice(0, 30).map(([key, item]) => [key, redactAdminValues(item, depth + 1)]));
  return typeof value === 'string' ? customerSafeDiagnosticText(value)?.slice(0, 2000) || '' : value;
}

export function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return `"${(/^[\s]*[=+@-]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
}

export function presentAdminOperations(raw: Record<string, any>, expected: Record<string, any>, now = Date.now()) {
  const workers = (raw.workers || []).map((row: Record<string, any>) => {
    const value = row.value || {};
    const lastSeenAt = value.lastSeenAt || row.updated_at || null;
    const age = lastSeenAt ? now - Date.parse(lastSeenAt) : Infinity;
    const fresh = Number.isFinite(age) && age >= -60_000 && age <= 90_000;
    const state = !lastSeenAt ? 'unknown' : value.status === 'stopped' ? 'offline'
      : !fresh || value.databaseConnected === false || value.queuePollingStatus === 'error' || ['failed','stopping'].includes(value.status) ? 'degraded'
      : value.status === 'starting' ? 'starting' : value.databaseConnected === true && ['idle','running'].includes(value.status) ? 'healthy' : 'unknown';
    return { id: value.workerId || row.id, state, lastSeenAt,
      databaseConnected: typeof value.databaseConnected === 'boolean' ? value.databaseConnected : null,
      currentAuditId: value.currentAuditId || null, commitIdentifier: value.commitIdentifier || (/^[a-f0-9]{7,40}$/i.test(value.version || '') ? value.version : null),
      apiSchemaVersion: value.apiSchemaVersion ?? raw.workerDeployment?.api_schema_version ?? null, auditEngineVersion: value.auditEngineVersion || null,
      scoringVersion: value.scoringVersion || null, checkRegistryVersion: value.checkRegistryVersion || null, deepAuditEnabled: value.deepAuditEnabled === true };
  });
  const liveWorkers = workers.filter((worker: { state: string }) => worker.state === 'healthy');
  const worker = liveWorkers[0] || workers[0];
  const contractMismatch = !!worker && ((worker.apiSchemaVersion != null && worker.apiSchemaVersion !== expected.apiSchemaVersion)
    || (!!worker.auditEngineVersion && worker.auditEngineVersion !== expected.auditEngineVersion)
    || (!!worker.scoringVersion && worker.scoringVersion !== expected.scoringVersion)
    || (!!worker.checkRegistryVersion && expected.checkRegistryVersion && worker.checkRegistryVersion !== expected.checkRegistryVersion));
  const databaseSchemaVersion = raw.database?.api_schema_version ?? null;
  const databaseReady = databaseSchemaVersion != null && databaseSchemaVersion >= MINIMUM_AUDIT_DATABASE_SCHEMA_VERSION;
  const databaseIncompatible = databaseSchemaVersion != null && !databaseReady;
  const databaseReason = databaseSchemaVersion == null ? 'Database schema version metadata is missing.'
    : databaseIncompatible ? `Recorded database schema ${databaseSchemaVersion} is below the compatible minimum ${MINIMUM_AUDIT_DATABASE_SCHEMA_VERSION}.`
    : `Database operations RPC responded; recorded schema ${databaseSchemaVersion} meets the compatible minimum ${MINIMUM_AUDIT_DATABASE_SCHEMA_VERSION}.`;
  const commitMismatch = !!(worker?.commitIdentifier && expected.commitIdentifier !== 'local'
    && !expected.commitIdentifier.startsWith(worker.commitIdentifier) && !worker.commitIdentifier.startsWith(expected.commitIdentifier));
  const queue = raw.queue;
  const queueStatus: OperationalStatus = queue.oldestQueuedSeconds > 900 ? 'critical'
    : queue.oldestQueuedSeconds > 300 || queue.staleLeases > 0 ? 'degraded' : 'healthy';
  const workerStatus: OperationalStatus = liveWorkers.length ? 'healthy' : workers.length ? (queue.queued || queue.running ? 'critical' : 'degraded') : 'unknown';
  const versionEvidence = !!worker && worker.apiSchemaVersion != null && !!worker.auditEngineVersion && !!worker.scoringVersion;
  const deploymentStatus: OperationalStatus = contractMismatch || databaseIncompatible ? 'critical' : commitMismatch ? 'degraded' : versionEvidence && databaseReady ? 'healthy' : 'unknown';
  const components = {
    api: { status: 'healthy' as OperationalStatus, reason: 'The authorized API request completed.' },
    database: { status: databaseReady ? 'healthy' as OperationalStatus : databaseIncompatible ? 'critical' as OperationalStatus : 'unknown' as OperationalStatus, reason: databaseReason },
    worker: { status: workerStatus, reason: liveWorkers.length ? 'Fresh audit-engine heartbeat received.' : 'No fresh healthy heartbeat; sleeping is not established.' },
    queue: { status: queueStatus, reason: queue.staleLeases ? `${queue.staleLeases} expired processing lease(s).` : queue.oldestQueuedSeconds > 300 ? 'Queue waiting time needs attention.' : 'Queue within existing waiting-time thresholds.' },
    deployment: { status: deploymentStatus, reason: contractMismatch ? 'Worker API contract is incompatible.' : databaseIncompatible ? databaseReason : commitMismatch ? 'Commits differ; check whether a deployment is in progress.' : databaseReady && versionEvidence ? 'Observed database and worker contracts are compatible.' : 'Waiting for complete version evidence.' },
  };
  const statuses = Object.values(components).map(component => component.status);
  const status: OperationalStatus = statuses.includes('critical') ? 'critical' : statuses.includes('degraded') ? 'degraded' : statuses.includes('unknown') ? 'unknown' : 'healthy';
  return { observedAt: raw.observedAt, status, reasons: Object.values(components).filter(component => component.status !== 'healthy').map(component => component.reason),
    components, metrics: raw.metrics, queue, workers,
    deployment: { applicationCommit: expected.commitIdentifier, workerCommit: worker?.commitIdentifier || null,
      expectedSchemaVersion: expected.apiSchemaVersion, databaseSchemaVersion,
      appliedMigration: raw.database?.commit_identifier || null, compatible: databaseReady && !contractMismatch && versionEvidence, commitMismatch },
    trend: raw.trend, recentFailures: (raw.recentFailures || []).map((row: Record<string, any>) => ({ id: row.id, domain: row.domain, status: row.status,
      error: customerSafeDiagnosticText(row.error) || 'No safe failure summary recorded.', createdAt: row.created_at,
      failureClass: classifyOperationalFailure(row.failure_code), failureCode: row.failure_code || null })),
    recentActions: (raw.recentActions || []).map(safeAdminAction) };
}
