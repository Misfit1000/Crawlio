import { AUDIT_LIMITS } from '../lib/audit/audit-config';
import { normalizeSupabaseProjectUrl } from '../lib/supabase/url';
import type { WorkerHeartbeat, WorkerHeartbeatStatus } from '../lib/supabase/audit-repository';
import { AUDIT_ENGINE_VERSION, CHECK_REGISTRY_VERSION, SCORING_VERSION } from '../lib/platform/version';
import { isNodeMonitoringConfigured } from '../lib/monitoring/sentry-node';

export { type WorkerHeartbeatStatus };

export const WORKER_ENV_ERROR =
  'Audit worker cannot start: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. The online worker must use Supabase, not memory storage.';

type WorkerEnv = Record<string, string | undefined>;

export interface AuditWorkerConfig {
  workerId: string;
  pollIntervalMs: number;
  supabaseUrl: string;
  supabaseHost: string;
  version: string;
  auditEngineVersion: string;
  scoringVersion: string;
  checkRegistryVersion: string;
  runtime: string;
  supportedModes: Array<'quick' | 'standard' | 'deep'>;
  deepAuditEnabled: boolean;
  sentryConfigured: boolean;
}

export interface AuditWorkerRuntimeState {
  workerId: string;
  status: WorkerHeartbeatStatus;
  lastSeenAt: string;
  pollIntervalMs: number;
  currentAuditId: string | null;
  version: string;
  auditEngineVersion: string;
  scoringVersion: string;
  checkRegistryVersion: string;
  runtime: string;
  supportedModes: Array<'quick' | 'standard' | 'deep'>;
  deepAuditEnabled: boolean;
  sentryConfigured: boolean;
  queuePollingStatus: 'starting' | 'active' | 'error' | 'stopped';
  databaseConnected: boolean;
  lastCompletedAuditId: string | null;
  lastCompletedAuditAt: string | null;
  lastFatalWorkerError: string | null;
  maintenanceMode: boolean;
}

function parsePollInterval(value: string | undefined) {
  const parsed = Number(value || AUDIT_LIMITS.workerPollIntervalMs);
  if (!Number.isFinite(parsed) || parsed < 1000) {
    return AUDIT_LIMITS.workerPollIntervalMs;
  }
  return Math.floor(parsed);
}

export function loadWorkerConfig(env: WorkerEnv = process.env): AuditWorkerConfig {
  const supabaseUrl = normalizeSupabaseProjectUrl(env.SUPABASE_URL);
  if (!supabaseUrl || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(WORKER_ENV_ERROR);
  }

  return {
    workerId: env.AUDIT_WORKER_ID || 'worker-production-1',
    pollIntervalMs: parsePollInterval(env.AUDIT_POLL_INTERVAL_MS),
    supabaseUrl,
    supabaseHost: new URL(supabaseUrl).hostname,
    version:
      env.RENDER_GIT_COMMIT?.slice(0, 12) ||
      env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) ||
      env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
      env.npm_package_version ||
      '0.0.0',
    runtime: env.WORKER_RUNTIME || (env.RENDER || env.PORT ? 'render-web-service' : 'node-worker'),
    auditEngineVersion: AUDIT_ENGINE_VERSION,
    scoringVersion: SCORING_VERSION,
    checkRegistryVersion: CHECK_REGISTRY_VERSION,
    supportedModes: env.DEEP_AUDIT_ENABLED === 'true' ? ['quick', 'standard', 'deep'] : ['quick', 'standard'],
    deepAuditEnabled: env.DEEP_AUDIT_ENABLED === 'true',
    sentryConfigured: isNodeMonitoringConfigured(env),
  };
}

export function createInitialWorkerState(config: AuditWorkerConfig): AuditWorkerRuntimeState {
  return {
    workerId: config.workerId,
    status: 'starting',
    lastSeenAt: new Date().toISOString(),
    pollIntervalMs: config.pollIntervalMs,
    currentAuditId: null,
    version: config.version,
    runtime: config.runtime,
    auditEngineVersion: config.auditEngineVersion,
    scoringVersion: config.scoringVersion,
    checkRegistryVersion: config.checkRegistryVersion,
    supportedModes: config.supportedModes,
    deepAuditEnabled: config.deepAuditEnabled,
    sentryConfigured: config.sentryConfigured,
    queuePollingStatus: 'starting',
    databaseConnected: true,
    lastCompletedAuditId: null,
    lastCompletedAuditAt: null,
    lastFatalWorkerError: null,
    maintenanceMode: false,
  };
}

export function updateWorkerState(
  state: AuditWorkerRuntimeState,
  patch: Partial<AuditWorkerRuntimeState>,
) {
  if (patch.status) state.status = patch.status;
  if ('currentAuditId' in patch) state.currentAuditId = patch.currentAuditId ?? null;
  if (patch.queuePollingStatus) state.queuePollingStatus = patch.queuePollingStatus;
  if (typeof patch.databaseConnected === 'boolean') state.databaseConnected = patch.databaseConnected;
  if ('lastCompletedAuditId' in patch) state.lastCompletedAuditId = patch.lastCompletedAuditId ?? null;
  if ('lastCompletedAuditAt' in patch) state.lastCompletedAuditAt = patch.lastCompletedAuditAt ?? null;
  if ('lastFatalWorkerError' in patch) state.lastFatalWorkerError = patch.lastFatalWorkerError ?? null;
  if (typeof patch.maintenanceMode === 'boolean') state.maintenanceMode = patch.maintenanceMode;
  state.lastSeenAt = new Date().toISOString();
  return state;
}

export function buildWorkerHeartbeat(state: AuditWorkerRuntimeState): WorkerHeartbeat {
  return {
    workerId: state.workerId,
    status: state.status,
    lastSeenAt: state.lastSeenAt,
    pollIntervalMs: state.pollIntervalMs,
    currentAuditId: state.currentAuditId,
    version: state.version,
    auditEngineVersion: state.auditEngineVersion,
    scoringVersion: state.scoringVersion,
    checkRegistryVersion: state.checkRegistryVersion,
    runtime: state.runtime,
    supportedModes: state.supportedModes,
    deepAuditEnabled: state.deepAuditEnabled,
    queuePollingStatus: state.queuePollingStatus,
    databaseConnected: state.databaseConnected,
    lastCompletedAuditId: state.lastCompletedAuditId,
    lastCompletedAuditAt: state.lastCompletedAuditAt,
    lastFatalWorkerError: state.lastFatalWorkerError,
    maintenanceMode: state.maintenanceMode,
    sentryConfigured: state.sentryConfigured,
  };
}
