import { createHash, randomUUID } from 'node:crypto';
import {
  AUDIT_LIMITS,
  type AuditMode,
  type ResourceAuditDocument,
  type AuditComparison,
  type AuditHistoryPage,
  type ResourceAuditEvent,
  type ResourceAuditIssue,
  type ResourceAuditLiveData,
  type ResourceAuditPage,
  type ResourceAuditReport,
  getAuditModeConfig,
} from '../audit/resource-types';
import {
  getSupabaseAdminClient,
  isSupabaseAdminEnabled,
  requireSupabaseAdminClient,
} from './server';
import { deploymentVersionRow } from '../platform/version';

type DbRow = Record<string, any>;
export type WorkerHeartbeatStatus = 'starting' | 'idle' | 'running' | 'stopping' | 'stopped' | 'failed';

export interface WorkerHeartbeat {
  workerId: string;
  status: WorkerHeartbeatStatus;
  lastSeenAt: string;
  pollIntervalMs: number;
  currentAuditId: string | null;
  version: string;
  auditEngineVersion?: string;
  scoringVersion?: string;
  checkRegistryVersion?: string;
  runtime?: string;
  supportedModes?: string[];
  deepAuditEnabled?: boolean;
  queuePollingStatus?: 'starting' | 'active' | 'error' | 'stopped';
  databaseConnected?: boolean;
  lastCompletedAuditId?: string | null;
  lastCompletedAuditAt?: string | null;
  lastFatalWorkerError?: string | null;
  maintenanceMode?: boolean;
  sentryConfigured?: boolean;
}

export interface AuditDiagnosticRow {
  id: string;
  status: string;
  submitted_input: string;
  normalized_url: string;
  current_phase: string | null;
  locked_by: string | null;
  lease_expires_at: string | null;
  plan?: string;
  requested_mode?: string;
  effective_mode?: string;
  queue_priority?: number;
  processing_tier?: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditInternalDiagnostic {
  auditId: string;
  affectedUrl: string;
  failureCode: string;
  phase: string;
  attemptCount: number;
  requestDurationMs?: number | null;
  workerId?: string | null;
  internalDetails: string;
  createdAt?: string;
}

function nowIso() {
  return new Date().toISOString();
}

function expiresAtIso() {
  const date = new Date();
  date.setDate(date.getDate() + AUDIT_LIMITS.defaultExpiresInDays);
  return date.toISOString();
}

function pageIdForAuditUrl(auditId: string, url: string) {
  return createHash('sha256').update(`${auditId}:${url}`).digest('hex').slice(0, 40);
}

function workerHeartbeatKey(workerId: string) {
  return `audit_worker:${workerId}`;
}

let workerDeploymentVersionRecorded = false;

function isClaimableLock(row: DbRow, timestamp: string) {
  if (!row.locked_by) return true;
  if (!row.lease_expires_at) return true;
  return String(row.lease_expires_at) <= timestamp;
}

function isStaleRunningLock(row: DbRow, timestamp: string) {
  if (!row.lease_expires_at) return true;
  return String(row.lease_expires_at) <= timestamp;
}

function toWorkerHeartbeat(row: DbRow): WorkerHeartbeat {
  const value = row.value ?? {};
  const fallbackWorkerId = String(row.id || '').replace(/^audit_worker:/, '') || 'unknown';
  return {
    workerId: String(value.workerId || fallbackWorkerId),
    status: value.status || 'failed',
    lastSeenAt: String(value.lastSeenAt || row.updated_at || nowIso()),
    pollIntervalMs: Number(value.pollIntervalMs || 0),
    currentAuditId: value.currentAuditId ?? null,
    version: String(value.version || 'unknown'),
    auditEngineVersion: value.auditEngineVersion || undefined,
    scoringVersion: value.scoringVersion || undefined,
    checkRegistryVersion: value.checkRegistryVersion || undefined,
    runtime: value.runtime || undefined,
    supportedModes: Array.isArray(value.supportedModes) ? value.supportedModes : undefined,
    deepAuditEnabled: typeof value.deepAuditEnabled === 'boolean' ? value.deepAuditEnabled : undefined,
    queuePollingStatus: value.queuePollingStatus || undefined,
    databaseConnected: typeof value.databaseConnected === 'boolean' ? value.databaseConnected : undefined,
    lastCompletedAuditId: value.lastCompletedAuditId ?? null,
    lastCompletedAuditAt: value.lastCompletedAuditAt ?? null,
    lastFatalWorkerError: value.lastFatalWorkerError ?? null,
    maintenanceMode: Boolean(value.maintenanceMode),
    sentryConfigured: Boolean(value.sentryConfigured),
  };
}

function assertNoError(error: { message?: string } | null | undefined, action: string) {
  if (error) {
    throw new Error(`${action}: ${error.message || 'Unknown Supabase error'}`);
  }
}

async function withTransientRetry<T>(action: string, operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const transient = /timeout|timed out|fetch failed|network|socket|429|502|503|504|temporar/i.test(message);
      if (!transient || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150 * (2 ** (attempt - 1))));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${action} failed.`);
}

function toAuditDocument(row: DbRow | null | undefined): ResourceAuditDocument | null {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id ?? null,
    guestKeyHash: row.guest_key_hash ?? null,
    projectId: row.project_id ?? null,
    submittedInput: row.submitted_input,
    normalizedUrl: row.normalized_url,
    finalUrl: row.final_url ?? null,
    hostname: row.hostname,
    mode: row.mode,
    plan: row.plan ?? 'free',
    requestedMode: row.requested_mode ?? row.mode ?? 'quick',
    effectiveMode: row.effective_mode ?? row.mode ?? 'quick',
    queuePriority: row.queue_priority ?? 10,
    processingTier: row.processing_tier ?? row.plan ?? 'free',
    quotaCounted: row.quota_counted ?? false,
    workerRuntime: row.worker_runtime ?? null,
    estimatedWaitSeconds: row.estimated_wait_seconds ?? null,
    status: row.status,
    progress: row.progress ?? 0,
    currentPhase: row.current_phase ?? 'Queued',
    currentUrl: row.current_url ?? null,
    currentCheck: row.current_check ?? null,
    pageLimit: row.page_limit ?? 0,
    pagesDiscovered: row.pages_discovered ?? 0,
    pagesCrawled: row.pages_crawled ?? 0,
    checksTotal: row.checks_total ?? 0,
    checksCompleted: row.checks_completed ?? 0,
    issuesFound: row.issues_found ?? 0,
    criticalCount: row.critical_count ?? 0,
    highCount: row.high_count ?? 0,
    mediumCount: row.medium_count ?? 0,
    lowCount: row.low_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    expiresAt: row.expires_at,
    cancelledAt: row.cancelled_at ?? null,
    error: row.error ?? null,
    lockedBy: row.locked_by ?? null,
    lockedAt: row.locked_at ?? null,
    leaseExpiresAt: row.lease_expires_at ?? null,
    usedHttpFallback: row.used_http_fallback ?? undefined,
    warningCount: row.warning_count ?? 0,
    failureCounts: row.failure_counts ?? {},
    archivedAt: row.archived_at ?? null,
    deletedAt: row.deleted_at ?? null,
    recoveryAttempts: row.recovery_attempts ?? 0,
    lastRecoveredAt: row.last_recovered_at ?? null,
  };
}

function auditToRow(audit: ResourceAuditDocument) {
  return {
    id: audit.id,
    user_id: audit.userId,
    guest_key_hash: audit.guestKeyHash,
    project_id: audit.projectId,
    submitted_input: audit.submittedInput,
    normalized_url: audit.normalizedUrl,
    final_url: audit.finalUrl,
    hostname: audit.hostname,
    mode: audit.mode,
    plan: audit.plan ?? 'free',
    requested_mode: audit.requestedMode ?? audit.mode,
    effective_mode: audit.effectiveMode ?? audit.mode,
    queue_priority: audit.queuePriority ?? 10,
    processing_tier: audit.processingTier ?? audit.plan ?? 'free',
    quota_counted: audit.quotaCounted ?? false,
    worker_runtime: audit.workerRuntime,
    estimated_wait_seconds: audit.estimatedWaitSeconds,
    status: audit.status,
    progress: audit.progress,
    current_phase: audit.currentPhase,
    current_url: audit.currentUrl,
    current_check: audit.currentCheck,
    page_limit: audit.pageLimit,
    pages_discovered: audit.pagesDiscovered,
    pages_crawled: audit.pagesCrawled,
    checks_total: audit.checksTotal,
    checks_completed: audit.checksCompleted,
    issues_found: audit.issuesFound,
    critical_count: audit.criticalCount,
    high_count: audit.highCount,
    medium_count: audit.mediumCount,
    low_count: audit.lowCount,
    created_at: audit.createdAt,
    updated_at: audit.updatedAt,
    started_at: audit.startedAt,
    completed_at: audit.completedAt,
    expires_at: audit.expiresAt,
    cancelled_at: audit.cancelledAt,
    error: audit.error,
    locked_by: audit.lockedBy,
    locked_at: audit.lockedAt,
    lease_expires_at: audit.leaseExpiresAt,
    used_http_fallback: audit.usedHttpFallback ?? false,
  };
}

function auditPatchToRow(patch: Partial<ResourceAuditDocument>) {
  const row: DbRow = { updated_at: nowIso() };
  if ('userId' in patch) row.user_id = patch.userId;
  if ('guestKeyHash' in patch) row.guest_key_hash = patch.guestKeyHash;
  if ('projectId' in patch) row.project_id = patch.projectId;
  if ('submittedInput' in patch) row.submitted_input = patch.submittedInput;
  if ('normalizedUrl' in patch) row.normalized_url = patch.normalizedUrl;
  if ('finalUrl' in patch) row.final_url = patch.finalUrl;
  if ('hostname' in patch) row.hostname = patch.hostname;
  if ('mode' in patch) row.mode = patch.mode;
  if ('plan' in patch) row.plan = patch.plan;
  if ('requestedMode' in patch) row.requested_mode = patch.requestedMode;
  if ('effectiveMode' in patch) row.effective_mode = patch.effectiveMode;
  if ('queuePriority' in patch) row.queue_priority = patch.queuePriority;
  if ('processingTier' in patch) row.processing_tier = patch.processingTier;
  if ('quotaCounted' in patch) row.quota_counted = patch.quotaCounted;
  if ('workerRuntime' in patch) row.worker_runtime = patch.workerRuntime;
  if ('estimatedWaitSeconds' in patch) row.estimated_wait_seconds = patch.estimatedWaitSeconds;
  if ('status' in patch) row.status = patch.status;
  if ('progress' in patch) row.progress = patch.progress;
  if ('currentPhase' in patch) row.current_phase = patch.currentPhase;
  if ('currentUrl' in patch) row.current_url = patch.currentUrl;
  if ('currentCheck' in patch) row.current_check = patch.currentCheck;
  if ('pageLimit' in patch) row.page_limit = patch.pageLimit;
  if ('pagesDiscovered' in patch) row.pages_discovered = patch.pagesDiscovered;
  if ('pagesCrawled' in patch) row.pages_crawled = patch.pagesCrawled;
  if ('checksTotal' in patch) row.checks_total = patch.checksTotal;
  if ('checksCompleted' in patch) row.checks_completed = patch.checksCompleted;
  if ('issuesFound' in patch) row.issues_found = patch.issuesFound;
  if ('criticalCount' in patch) row.critical_count = patch.criticalCount;
  if ('highCount' in patch) row.high_count = patch.highCount;
  if ('mediumCount' in patch) row.medium_count = patch.mediumCount;
  if ('lowCount' in patch) row.low_count = patch.lowCount;
  if ('completedAt' in patch) row.completed_at = patch.completedAt;
  if ('startedAt' in patch) row.started_at = patch.startedAt;
  if ('expiresAt' in patch) row.expires_at = patch.expiresAt;
  if ('cancelledAt' in patch) row.cancelled_at = patch.cancelledAt;
  if ('error' in patch) row.error = patch.error;
  if ('lockedBy' in patch) row.locked_by = patch.lockedBy;
  if ('lockedAt' in patch) row.locked_at = patch.lockedAt;
  if ('leaseExpiresAt' in patch) row.lease_expires_at = patch.leaseExpiresAt;
  if ('usedHttpFallback' in patch) row.used_http_fallback = patch.usedHttpFallback;
  if ('warningCount' in patch) row.warning_count = patch.warningCount;
  if ('failureCounts' in patch) row.failure_counts = patch.failureCounts;
  if ('archivedAt' in patch) row.archived_at = patch.archivedAt;
  if ('deletedAt' in patch) row.deleted_at = patch.deletedAt;
  if ('recoveryAttempts' in patch) row.recovery_attempts = patch.recoveryAttempts;
  if ('lastRecoveredAt' in patch) row.last_recovered_at = patch.lastRecoveredAt;
  return row;
}

function toAuditEvent(row: DbRow): ResourceAuditEvent {
  return {
    id: row.id,
    type: row.type,
    timestamp: row.created_at,
    message: row.message ?? '',
    phase: row.phase ?? undefined,
    currentUrl: row.current_url ?? undefined,
    affectedUrl: row.affected_url ?? undefined,
    category: row.category ?? undefined,
    checkId: row.check_id ?? undefined,
    checkTitle: row.check_title ?? undefined,
    severity: row.severity ?? undefined,
    progress: row.progress ?? undefined,
    data: row.data ?? undefined,
  };
}

function eventToRow(auditId: string, event: ResourceAuditEvent) {
  return {
    id: event.id,
    audit_id: auditId,
    type: event.type,
    created_at: event.timestamp,
    message: event.message,
    phase: event.phase,
    current_url: event.currentUrl,
    affected_url: event.affectedUrl,
    category: event.category,
    check_id: event.checkId,
    check_title: event.checkTitle,
    severity: event.severity,
    progress: event.progress,
    data: event.data ?? null,
  };
}

function toAuditPage(row: DbRow): ResourceAuditPage {
  return {
    id: row.id,
    url: row.url,
    statusCode: row.status_code ?? 0,
    responseTimeMs: row.response_time_ms ?? 0,
    pageSizeBytes: row.page_size_bytes ?? 0,
    title: row.title ?? '',
    metaDescription: row.meta_description ?? '',
    h1: row.h1 ?? '',
    canonicalUrl: row.canonical_url ?? '',
    siteName: row.site_name ?? '',
    faviconUrl: row.favicon_url ?? '',
    openGraphImage: row.open_graph_image ?? '',
    themeColor: row.theme_color ?? '',
    screenshotUrl: row.screenshot_url ?? '',
    fetchStatus: row.fetch_status ?? 'success',
    failureCode: row.failure_code ?? undefined,
    failureCategory: row.failure_category ?? undefined,
    safeTitle: row.safe_title ?? undefined,
    safeExplanation: row.safe_explanation ?? undefined,
    suggestedAction: row.suggested_action ?? undefined,
    retryable: row.retryable ?? false,
    attemptCount: row.attempt_count ?? 1,
    recoveredAfterRetry: row.recovered_after_retry ?? false,
    sourceUrl: row.source_url ?? undefined,
    anchorText: row.anchor_text ?? undefined,
    wordCount: row.word_count ?? 0,
    crawlDepth: row.crawl_depth ?? 0,
    issueCount: row.issue_count ?? 0,
    crawledAt: row.crawled_at,
  };
}

function pageToRow(auditId: string, page: ResourceAuditPage) {
  return {
    id: page.id,
    audit_id: auditId,
    url: page.url,
    status_code: page.statusCode,
    response_time_ms: page.responseTimeMs,
    page_size_bytes: page.pageSizeBytes,
    title: page.title,
    meta_description: page.metaDescription,
    h1: page.h1,
    canonical_url: page.canonicalUrl ?? '',
    site_name: page.siteName ?? '',
    favicon_url: page.faviconUrl ?? '',
    open_graph_image: page.openGraphImage ?? '',
    theme_color: page.themeColor ?? '',
    screenshot_url: page.screenshotUrl ?? '',
    fetch_status: page.fetchStatus ?? 'success',
    failure_code: page.failureCode ?? null,
    failure_category: page.failureCategory ?? null,
    safe_title: page.safeTitle ?? null,
    safe_explanation: page.safeExplanation ?? null,
    suggested_action: page.suggestedAction ?? null,
    retryable: page.retryable ?? false,
    attempt_count: page.attemptCount ?? 1,
    recovered_after_retry: page.recoveredAfterRetry ?? false,
    source_url: page.sourceUrl ?? null,
    anchor_text: page.anchorText ?? null,
    word_count: page.wordCount,
    crawl_depth: page.crawlDepth,
    issue_count: page.issueCount,
    crawled_at: page.crawledAt,
  };
}

const PREVIEW_METADATA_COLUMNS = new Set([
  'canonical_url',
  'site_name',
  'favicon_url',
  'open_graph_image',
  'theme_color',
  'screenshot_url',
]);

const RESILIENCE_PAGE_COLUMNS = new Set([
  'fetch_status', 'failure_code', 'failure_category', 'safe_title', 'safe_explanation',
  'suggested_action', 'retryable', 'attempt_count', 'recovered_after_retry', 'source_url', 'anchor_text',
]);

function pageToLegacyRow(auditId: string, page: ResourceAuditPage) {
  return Object.fromEntries(
    Object.entries(pageToRow(auditId, page)).filter(([column]) => !PREVIEW_METADATA_COLUMNS.has(column) && !RESILIENCE_PAGE_COLUMNS.has(column)),
  );
}

function isMissingPreviewMetadataColumn(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const details = [
    'message' in error ? String(error.message) : '',
    'details' in error ? String(error.details) : '',
    'hint' in error ? String(error.hint) : '',
  ].join(' ').toLowerCase();
  return [...PREVIEW_METADATA_COLUMNS, ...RESILIENCE_PAGE_COLUMNS].some((column) => details.includes(column));
}

async function upsertAuditPages(
  client: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  auditId: string,
  pages: ResourceAuditPage[],
) {
  const result = await client
    .from('audit_pages')
    .upsert(pages.map((page) => pageToRow(auditId, page)), { onConflict: 'id' });

  if (!result.error) return;
  if (!isMissingPreviewMetadataColumn(result.error)) {
    assertNoError(result.error, 'Append audit pages');
  }

  const legacyResult = await client
    .from('audit_pages')
    .upsert(pages.map((page) => pageToLegacyRow(auditId, page)), { onConflict: 'id' });
  assertNoError(legacyResult.error, 'Append audit pages without preview metadata');
}

function toAuditIssue(row: DbRow): ResourceAuditIssue {
  return {
    id: row.id,
    severity: row.severity,
    category: row.category,
    title: row.title,
    description: row.description,
    affectedUrl: row.affected_url,
    evidence: row.evidence ?? '',
    recommendation: row.recommendation ?? '',
    checkId: row.check_id ?? undefined,
    failureCode: row.failure_code ?? undefined,
    findingKey: row.finding_key ?? undefined,
    sourceUrls: Array.isArray(row.source_urls) ? row.source_urls : [],
    affectedPageCount: row.affected_page_count ?? 1,
    detectedAt: row.detected_at,
  };
}

function issueToRow(auditId: string, issue: ResourceAuditIssue) {
  return {
    id: issue.id,
    audit_id: auditId,
    severity: issue.severity,
    category: issue.category,
    title: issue.title,
    description: issue.description,
    affected_url: issue.affectedUrl,
    evidence: issue.evidence,
    recommendation: issue.recommendation,
    check_id: issue.checkId ?? null,
    failure_code: issue.failureCode ?? null,
    finding_key: issue.findingKey ?? null,
    source_urls: issue.sourceUrls ?? [],
    affected_page_count: issue.affectedPageCount ?? 1,
    detected_at: issue.detectedAt,
  };
}

const RESILIENCE_ISSUE_COLUMNS = new Set(['check_id', 'failure_code', 'finding_key', 'source_urls', 'affected_page_count']);

function issueToLegacyRow(auditId: string, issue: ResourceAuditIssue) {
  return Object.fromEntries(Object.entries(issueToRow(auditId, issue)).filter(([column]) => !RESILIENCE_ISSUE_COLUMNS.has(column)));
}

function errorText(error: unknown) {
  if (!error || typeof error !== 'object') return String(error || '');
  return ['message', 'details', 'hint'].map((key) => key in error ? String((error as DbRow)[key]) : '').join(' ').toLowerCase();
}

function isMissingResilienceSchema(error: unknown) {
  const text = errorText(error);
  return [...RESILIENCE_PAGE_COLUMNS, ...RESILIENCE_ISSUE_COLUMNS, 'warning_count', 'failure_counts', 'audit_diagnostics']
    .some((column) => text.includes(column)) || /violates check constraint.*status/i.test(text);
}

async function insertAuditIssues(
  client: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  auditId: string,
  issues: ResourceAuditIssue[],
) {
  const result = await client.from('audit_issues').insert(issues.map((issue) => issueToRow(auditId, issue)));
  if (!result.error) return;
  if (!isMissingResilienceSchema(result.error)) assertNoError(result.error, 'Append audit issues');
  const legacy = await client.from('audit_issues').insert(issues.map((issue) => issueToLegacyRow(auditId, issue)));
  assertNoError(legacy.error, 'Append audit issues without resilience metadata');
}

function toAuditReport(row: DbRow | null | undefined): ResourceAuditReport | null {
  if (!row) return null;
  return {
    scores: row.scores ?? {},
    summary: typeof row.summary === 'string' ? row.summary : row.summary?.text ?? '',
    topIssues: (row.top_issues ?? []) as ResourceAuditIssue[],
    pages: (row.pages ?? []) as ResourceAuditPage[],
    exports: row.exports ?? { json: '', issuesCsv: '', pagesCsv: '' },
    generatedAt: row.generated_at,
  };
}

function reportToRow(auditId: string, report: ResourceAuditReport) {
  return {
    audit_id: auditId,
    scores: report.scores,
    summary: { text: report.summary },
    top_issues: report.topIssues,
    pages: report.pages,
    exports: report.exports,
    generated_at: report.generatedAt,
  };
}

function reportOverallScore(report: ResourceAuditReport | null) {
  const value = report?.scores?.overall;
  const score = Number(value);
  return value == null || !Number.isFinite(score) ? null : Math.max(0, Math.min(100, score));
}

function comparisonIssueKey(issue: ResourceAuditIssue) {
  let path = issue.affectedUrl;
  try {
    const parsed = new URL(issue.affectedUrl);
    path = `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/$/, '') || '/'}`;
  } catch {
    path = issue.affectedUrl.toLowerCase();
  }
  return `${issue.category}|${issue.title}|${path}`.toLowerCase().replace(/\s+/g, ' ').trim();
}

const memory = {
  audits: new Map<string, ResourceAuditDocument>(),
  events: new Map<string, ResourceAuditEvent[]>(),
  pages: new Map<string, ResourceAuditPage[]>(),
  issues: new Map<string, ResourceAuditIssue[]>(),
  reports: new Map<string, ResourceAuditReport>(),
  diagnostics: new Map<string, AuditInternalDiagnostic[]>(),
};

export const auditRepository = {
  isSupabaseEnabled() {
    return isSupabaseAdminEnabled();
  },

  isSupabaseAdminEnabled() {
    return isSupabaseAdminEnabled();
  },

  requireSupabaseAdminClient() {
    return requireSupabaseAdminClient();
  },

  async upsertWorkerHeartbeat(heartbeat: WorkerHeartbeat) {
    const client = requireSupabaseAdminClient();
    const payload: WorkerHeartbeat = {
      workerId: heartbeat.workerId,
      status: heartbeat.status,
      lastSeenAt: heartbeat.lastSeenAt || nowIso(),
      pollIntervalMs: heartbeat.pollIntervalMs,
      currentAuditId: heartbeat.currentAuditId ?? null,
      version: heartbeat.version || 'unknown',
      auditEngineVersion: heartbeat.auditEngineVersion,
      scoringVersion: heartbeat.scoringVersion,
      checkRegistryVersion: heartbeat.checkRegistryVersion,
      runtime: heartbeat.runtime,
      supportedModes: heartbeat.supportedModes,
      deepAuditEnabled: heartbeat.deepAuditEnabled,
      queuePollingStatus: heartbeat.queuePollingStatus,
      databaseConnected: heartbeat.databaseConnected,
      lastCompletedAuditId: heartbeat.lastCompletedAuditId,
      lastCompletedAuditAt: heartbeat.lastCompletedAuditAt,
      lastFatalWorkerError: heartbeat.lastFatalWorkerError,
      maintenanceMode: heartbeat.maintenanceMode,
    };

    const { error } = await client
      .from('platform_settings')
      .upsert(
        {
          id: workerHeartbeatKey(payload.workerId),
          value: payload,
          updated_at: payload.lastSeenAt,
        },
        { onConflict: 'id' },
      );
    assertNoError(error, 'Upsert worker heartbeat');
    if (!workerDeploymentVersionRecorded) {
      const deployment = await client.from('deployment_versions').upsert(deploymentVersionRow('worker'), { onConflict: 'component' });
      workerDeploymentVersionRecorded = !deployment.error;
    }
    return payload;
  },

  async getWorkerHeartbeats(): Promise<WorkerHeartbeat[]> {
    const client = requireSupabaseAdminClient();
    const { data, error } = await client
      .from('platform_settings')
      .select('id,value,updated_at')
      .like('id', 'audit_worker:%')
      .order('updated_at', { ascending: false });
    assertNoError(error, 'Get worker heartbeats');
    return (data ?? []).map(toWorkerHeartbeat);
  },

  async getLatestAuditDiagnostics(limit = 5): Promise<AuditDiagnosticRow[]> {
    const client = requireSupabaseAdminClient();
    const { data, error } = await client
      .from('audits')
      .select('id,status,submitted_input,normalized_url,current_phase,locked_by,lease_expires_at,plan,requested_mode,effective_mode,queue_priority,processing_tier,error,created_at,updated_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    assertNoError(error, 'Get latest audit diagnostics');
    return (data ?? []) as AuditDiagnosticRow[];
  },

  async addInternalDiagnostic(input: AuditInternalDiagnostic) {
    const diagnostic = { ...input, createdAt: input.createdAt || nowIso() };
    const client = getSupabaseAdminClient();
    if (client) {
      const result = await client.from('audit_diagnostics').insert({
        audit_id: diagnostic.auditId,
        affected_url: diagnostic.affectedUrl,
        failure_code: diagnostic.failureCode,
        phase: diagnostic.phase,
        attempt_count: diagnostic.attemptCount,
        request_duration_ms: diagnostic.requestDurationMs ?? null,
        worker_id: diagnostic.workerId ?? null,
        internal_details: diagnostic.internalDetails,
        created_at: diagnostic.createdAt,
      });
      if (result.error && !isMissingResilienceSchema(result.error)) assertNoError(result.error, 'Store internal audit diagnostic');
      return diagnostic;
    }
    const current = memory.diagnostics.get(input.auditId) ?? [];
    memory.diagnostics.set(input.auditId, [...current, diagnostic].slice(-500));
    return diagnostic;
  },

  async createAuditJob(input: {
    id?: string;
    submittedInput: string;
    normalizedUrl: string;
    hostname: string;
    mode?: AuditMode;
    requestedMode?: AuditMode;
    effectiveMode?: AuditMode;
    plan?: ResourceAuditDocument['plan'];
    processingTier?: ResourceAuditDocument['processingTier'];
    pageLimit?: number;
    queuePriority?: number;
    estimatedWaitSeconds?: number | null;
    userId?: string | null;
    guestKeyHash?: string | null;
    projectId?: string | null;
  }): Promise<ResourceAuditDocument> {
    const id = input.id || randomUUID();
    const config = getAuditModeConfig(input.effectiveMode || input.mode);
    const timestamp = nowIso();
    const effectiveMode = input.effectiveMode || config.mode;
    const requestedMode = input.requestedMode || input.mode || effectiveMode;
    const plan = input.plan || 'free';
    const audit: ResourceAuditDocument = {
      id,
      userId: input.userId ?? null,
      guestKeyHash: input.guestKeyHash ?? null,
      projectId: input.projectId ?? null,
      submittedInput: input.submittedInput,
      normalizedUrl: input.normalizedUrl,
      finalUrl: null,
      hostname: input.hostname,
      mode: effectiveMode,
      plan,
      requestedMode,
      effectiveMode,
      queuePriority: input.queuePriority ?? 10,
      processingTier: input.processingTier ?? plan,
      quotaCounted: false,
      workerRuntime: null,
      estimatedWaitSeconds: input.estimatedWaitSeconds ?? null,
      status: 'queued',
      progress: 0,
      currentPhase: 'Queued',
      currentUrl: null,
      currentCheck: null,
      pageLimit: input.pageLimit ?? config.pageLimit,
      pagesDiscovered: 0,
      pagesCrawled: 0,
      checksTotal: 0,
      checksCompleted: 0,
      issuesFound: 0,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      completedAt: null,
      expiresAt: expiresAtIso(),
      cancelledAt: null,
      error: null,
      lockedBy: null,
      lockedAt: null,
      leaseExpiresAt: null,
      warningCount: 0,
      failureCounts: {},
      archivedAt: null,
      deletedAt: null,
      recoveryAttempts: 0,
      lastRecoveredAt: null,
    };

    const client = getSupabaseAdminClient();
    if (client) {
      const { error } = await client.from('audits').insert(auditToRow(audit));
      assertNoError(error, 'Create audit job');
    } else {
      memory.audits.set(id, audit);
      memory.events.set(id, []);
      memory.pages.set(id, []);
      memory.issues.set(id, []);
    }

    await this.appendAuditEvent(id, {
      type: 'audit_queued',
      message: `Audit queued for ${input.hostname}`,
      phase: 'Queued',
      progress: 0,
    });

    return audit;
  },

  async findActiveDuplicateAudit(input: {
    userId?: string | null;
    guestKeyHash?: string | null;
    normalizedUrl: string;
    createdAfterIso: string;
  }): Promise<ResourceAuditDocument | null> {
    const client = getSupabaseAdminClient();
    if (client) {
      let query = client
        .from('audits')
        .select('*')
        .eq('normalized_url', input.normalizedUrl)
        .in('status', ['queued', 'running'])
        .gte('created_at', input.createdAfterIso);

      if (input.userId) {
        query = query.eq('user_id', input.userId);
      } else if (input.guestKeyHash) {
        query = query.is('user_id', null).eq('guest_key_hash', input.guestKeyHash);
      } else {
        query = query.is('user_id', null).is('guest_key_hash', null);
      }

      const { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
      assertNoError(error, 'Find active duplicate audit');
      return toAuditDocument(data);
    }

    return Array.from(memory.audits.values())
      .filter((audit) => audit.normalizedUrl === input.normalizedUrl)
      .filter((audit) => audit.status === 'queued' || audit.status === 'running')
      .filter((audit) => audit.createdAt >= input.createdAfterIso)
      .filter((audit) => {
        if (input.userId) return audit.userId === input.userId;
        return !audit.userId && (audit.guestKeyHash ?? null) === (input.guestKeyHash ?? null);
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  },

  async findActiveAuditForOwner(input: {
    userId?: string | null;
    guestKeyHash?: string | null;
  }): Promise<ResourceAuditDocument | null> {
    const client = getSupabaseAdminClient();
    if (client) {
      let query = client
        .from('audits')
        .select('*')
        .in('status', ['queued', 'running']);

      if (input.userId) {
        query = query.eq('user_id', input.userId);
      } else if (input.guestKeyHash) {
        query = query.is('user_id', null).eq('guest_key_hash', input.guestKeyHash);
      } else {
        query = query.is('user_id', null).is('guest_key_hash', null);
      }

      const { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
      assertNoError(error, 'Find active audit for owner');
      return toAuditDocument(data);
    }

    return Array.from(memory.audits.values())
      .filter((audit) => audit.status === 'queued' || audit.status === 'running')
      .filter((audit) => {
        if (input.userId) return audit.userId === input.userId;
        return !audit.userId && (audit.guestKeyHash ?? null) === (input.guestKeyHash ?? null);
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  },

  async getAuditJob(id: string): Promise<ResourceAuditDocument | null> {
    const client = getSupabaseAdminClient();
    if (client) {
      const { data, error } = await client.from('audits').select('*').eq('id', id).maybeSingle();
      assertNoError(error, 'Get audit job');
      return toAuditDocument(data);
    }
    return memory.audits.get(id) ?? null;
  },

  async getAudit(id: string) {
    return this.getAuditJob(id);
  },

  async updateAuditJob(id: string, patch: Partial<ResourceAuditDocument>) {
    const update = { ...patch, updatedAt: nowIso() };
    const client = getSupabaseAdminClient();
    if (client) {
      const result = await client.from('audits').update(auditPatchToRow(update)).eq('id', id);
      if (result.error && isMissingResilienceSchema(result.error)) {
        const legacyPatch = { ...update };
        delete legacyPatch.warningCount;
        delete legacyPatch.failureCounts;
        if (legacyPatch.status === 'completed_with_warnings') legacyPatch.status = 'completed';
        const legacyResult = await client.from('audits').update(auditPatchToRow(legacyPatch)).eq('id', id);
        assertNoError(legacyResult.error, 'Update audit job without resilience metadata');
        return;
      }
      assertNoError(result.error, 'Update audit job');
      return;
    }
    const current = memory.audits.get(id);
    if (current) {
      memory.audits.set(id, { ...current, ...update });
    }
  },

  async updateAudit(id: string, patch: Partial<ResourceAuditDocument>) {
    return this.updateAuditJob(id, patch);
  },

  async updateAuditForWorker(id: string, workerId: string, patch: Partial<ResourceAuditDocument>) {
    const update = { ...patch, updatedAt: nowIso() };
    const client = getSupabaseAdminClient();
    if (client) {
      const { data, error } = await client
        .from('audits')
        .update(auditPatchToRow(update))
        .eq('id', id)
        .eq('status', 'running')
        .eq('locked_by', workerId)
        .select('id')
        .maybeSingle();
      assertNoError(error, 'Update worker-owned audit');
      return Boolean(data);
    }
    const current = memory.audits.get(id);
    if (!current || current.status !== 'running' || current.lockedBy !== workerId) return false;
    memory.audits.set(id, { ...current, ...update });
    return true;
  },

  async cancelAuditJob(id: string) {
    const timestamp = nowIso();
    const patch = {
      status: 'cancelled' as const,
      cancelledAt: timestamp,
      completedAt: timestamp,
      currentPhase: 'Cancelled by user',
      currentCheck: null,
      lockedBy: null,
      lockedAt: null,
      leaseExpiresAt: null,
      updatedAt: timestamp,
    };
    const client = getSupabaseAdminClient();
    if (client) {
      const { data, error } = await client.from('audits').update(auditPatchToRow(patch)).eq('id', id).in('status', ['queued', 'running']).select('id').maybeSingle();
      assertNoError(error, 'Cancel active audit');
      if (!data) return false;
    } else {
      const current = memory.audits.get(id);
      if (!current || !['queued', 'running'].includes(current.status)) return false;
      memory.audits.set(id, { ...current, ...patch });
    }
    await this.appendAuditEvent(id, {
      type: 'audit_cancelled',
      timestamp,
      message: 'Audit cancelled by user',
      phase: 'Cancelled by user',
    });
    return true;
  },

  async cancelAudit(id: string) {
    return this.cancelAuditJob(id);
  },

  async appendAuditEvent(auditId: string, event: Omit<Partial<ResourceAuditEvent>, 'id'>) {
    const id = randomUUID();
    const audit = await this.getAuditJob(auditId);
    const fullEvent: ResourceAuditEvent = {
      id,
      type: event.type || 'progress_update',
      timestamp: event.timestamp || nowIso(),
      message: event.message || '',
      phase: event.phase,
      currentUrl: event.currentUrl,
      affectedUrl: event.affectedUrl,
      category: event.category,
      checkId: event.checkId,
      checkTitle: event.checkTitle,
      severity: event.severity,
      progress: event.progress ?? audit?.progress,
      data: event.data,
    };

    const client = getSupabaseAdminClient();
    if (client) {
      const { error } = await client.from('audit_events').insert(eventToRow(auditId, fullEvent));
      assertNoError(error, 'Append audit event');

      const countResult = await client
        .from('audit_events')
        .select('id', { count: 'exact', head: true })
        .eq('audit_id', auditId);
      assertNoError(countResult.error, 'Count audit events');
      const overLimit = (countResult.count ?? 0) - AUDIT_LIMITS.maxEvents;
      if (overLimit > 0) {
        const { data: oldRows, error: oldRowsError } = await client
          .from('audit_events')
          .select('id')
          .eq('audit_id', auditId)
          .order('created_at', { ascending: true })
          .limit(overLimit);
        assertNoError(oldRowsError, 'Find old audit events');
        const ids = (oldRows ?? []).map((row) => row.id);
        if (ids.length) {
          const { error: deleteError } = await client.from('audit_events').delete().in('id', ids);
          assertNoError(deleteError, 'Delete old audit events');
        }
      }
      return;
    }

    const events = memory.events.get(auditId) ?? [];
    events.push(fullEvent);
    memory.events.set(auditId, events.slice(-AUDIT_LIMITS.maxEvents));
  },

  async appendEvent(auditId: string, event: Omit<Partial<ResourceAuditEvent>, 'id'>) {
    return this.appendAuditEvent(auditId, event);
  },

  async appendEvents(auditId: string, events: Array<Omit<Partial<ResourceAuditEvent>, 'id'>>) {
    if (!events.length) return [];
    const audit = await this.getAuditJob(auditId);
    const fullEvents: ResourceAuditEvent[] = events.map((event) => ({
      id: randomUUID(),
      type: event.type || 'progress_update',
      timestamp: event.timestamp || nowIso(),
      message: event.message || '',
      phase: event.phase,
      currentUrl: event.currentUrl,
      affectedUrl: event.affectedUrl,
      category: event.category,
      checkId: event.checkId,
      checkTitle: event.checkTitle,
      severity: event.severity,
      progress: event.progress ?? audit?.progress,
      data: event.data,
    }));
    const client = getSupabaseAdminClient();
    if (client) {
      await withTransientRetry('Append audit event batch', async () => {
        const { error } = await client.from('audit_events').insert(fullEvents.map((event) => eventToRow(auditId, event)));
        assertNoError(error, 'Append audit event batch');
      });
      return fullEvents;
    }
    const current = memory.events.get(auditId) ?? [];
    memory.events.set(auditId, [...current, ...fullEvents].slice(-AUDIT_LIMITS.maxEvents));
    return fullEvents;
  },

  async trimAuditEvents(auditId: string, limit = AUDIT_LIMITS.maxEvents) {
    const safeLimit = Math.max(1, Math.min(5_000, Math.floor(limit)));
    const client = getSupabaseAdminClient();
    if (client) {
      const countResult = await client.from('audit_events').select('id', { count: 'exact', head: true }).eq('audit_id', auditId);
      assertNoError(countResult.error, 'Count audit events before trim');
      const overLimit = (countResult.count ?? 0) - safeLimit;
      if (overLimit <= 0) return 0;
      const oldest = await client.from('audit_events').select('id').eq('audit_id', auditId).order('created_at', { ascending: true }).limit(overLimit);
      assertNoError(oldest.error, 'Find audit events to trim');
      const ids = (oldest.data ?? []).map((row) => row.id);
      if (ids.length) {
        const removed = await client.from('audit_events').delete().in('id', ids);
        assertNoError(removed.error, 'Trim audit events');
      }
      return ids.length;
    }
    const current = memory.events.get(auditId) ?? [];
    const removed = Math.max(0, current.length - safeLimit);
    memory.events.set(auditId, current.slice(-safeLimit));
    return removed;
  },

  async addCrawledPage(auditId: string, page: Omit<ResourceAuditPage, 'id'>) {
    const fullPage: ResourceAuditPage = { id: pageIdForAuditUrl(auditId, page.url), ...page };
    const client = getSupabaseAdminClient();
    if (client) {
      await upsertAuditPages(client, auditId, [fullPage]);
      return fullPage;
    }

    const pages = memory.pages.get(auditId) ?? [];
    const next = pages.filter((item) => item.id !== fullPage.id);
    next.push(fullPage);
    memory.pages.set(auditId, next);
    return fullPage;
  },

  async appendPage(auditId: string, page: Omit<ResourceAuditPage, 'id'>) {
    return this.addCrawledPage(auditId, page);
  },

  async appendPages(auditId: string, pages: Array<Omit<ResourceAuditPage, 'id'> & { id?: string }>) {
    if (!pages.length) return [];
    const fullPages = pages.map((page) => ({ id: page.id || pageIdForAuditUrl(auditId, page.url), ...page } as ResourceAuditPage));
    const client = getSupabaseAdminClient();
    if (client) {
      await withTransientRetry('Append audit page batch', async () => {
        await upsertAuditPages(client, auditId, fullPages);
      });
      return fullPages;
    }
    const current = memory.pages.get(auditId) ?? [];
    const byId = new Map(current.map((page) => [page.id, page]));
    fullPages.forEach((page) => byId.set(page.id, page));
    memory.pages.set(auditId, Array.from(byId.values()));
    return fullPages;
  },

  async addIssue(auditId: string, issue: Omit<ResourceAuditIssue, 'id' | 'detectedAt'> & { id?: string; detectedAt?: string }) {
    const fullIssue: ResourceAuditIssue = {
      id: issue.id || randomUUID(),
      severity: issue.severity,
      category: issue.category,
      title: issue.title,
      description: issue.description,
      affectedUrl: issue.affectedUrl,
      evidence: issue.evidence,
      recommendation: issue.recommendation,
      checkId: issue.checkId,
      failureCode: issue.failureCode,
      findingKey: issue.findingKey,
      sourceUrls: issue.sourceUrls,
      affectedPageCount: issue.affectedPageCount,
      detectedAt: issue.detectedAt || nowIso(),
    };

    const client = getSupabaseAdminClient();
    if (client) {
      const countResult = await client
        .from('audit_issues')
        .select('id', { count: 'exact', head: true })
        .eq('audit_id', auditId);
      assertNoError(countResult.error, 'Count audit issues');
      if ((countResult.count ?? 0) >= AUDIT_LIMITS.maxIssues) {
        return null;
      }

      await insertAuditIssues(client, auditId, [fullIssue]);
    } else {
      const issues = memory.issues.get(auditId) ?? [];
      if (issues.length >= AUDIT_LIMITS.maxIssues) {
        return null;
      }
      issues.push(fullIssue);
      memory.issues.set(auditId, issues);
    }

    const issues = await this.getLatestIssues(auditId, AUDIT_LIMITS.maxIssues);
    await this.updateAuditJob(auditId, {
      issuesFound: issues.length,
      criticalCount: issues.filter((item) => item.severity === 'critical').length,
      highCount: issues.filter((item) => item.severity === 'high').length,
      mediumCount: issues.filter((item) => item.severity === 'medium').length,
      lowCount: issues.filter((item) => item.severity === 'low').length,
    });

    await this.appendAuditEvent(auditId, {
      type: 'issue_found',
      message: fullIssue.title,
      affectedUrl: fullIssue.affectedUrl,
      category: fullIssue.category,
      severity: fullIssue.severity,
      data: {
        evidence: fullIssue.evidence,
        recommendation: fullIssue.recommendation,
      },
    });

    return fullIssue;
  },

  async appendIssue(auditId: string, issue: Omit<ResourceAuditIssue, 'id' | 'detectedAt'> & { id?: string; detectedAt?: string }) {
    return this.addIssue(auditId, issue);
  },

  async appendIssues(auditId: string, issues: Array<Omit<ResourceAuditIssue, 'id' | 'detectedAt'> & { id?: string; detectedAt?: string }>) {
    if (!issues.length) return [];
    const fullIssues: ResourceAuditIssue[] = issues.map((issue) => ({
      id: issue.id || randomUUID(),
      severity: issue.severity,
      category: issue.category,
      title: issue.title,
      description: issue.description,
      affectedUrl: issue.affectedUrl,
      evidence: issue.evidence,
      recommendation: issue.recommendation,
      checkId: issue.checkId,
      failureCode: issue.failureCode,
      findingKey: issue.findingKey,
      sourceUrls: issue.sourceUrls,
      affectedPageCount: issue.affectedPageCount,
      detectedAt: issue.detectedAt || nowIso(),
    }));
    const client = getSupabaseAdminClient();
    let stored = fullIssues;
    if (client) {
      const countResult = await client.from('audit_issues').select('id', { count: 'exact', head: true }).eq('audit_id', auditId);
      assertNoError(countResult.error, 'Count audit issues before batch');
      stored = fullIssues.slice(0, Math.max(0, AUDIT_LIMITS.maxIssues - (countResult.count ?? 0)));
      if (stored.length) {
        await withTransientRetry('Append audit issue batch', async () => {
          await insertAuditIssues(client, auditId, stored);
        });
      }
      const severityRows = await client.from('audit_issues').select('severity').eq('audit_id', auditId).limit(AUDIT_LIMITS.maxIssues);
      assertNoError(severityRows.error, 'Count audit issue severities');
      const rows = severityRows.data ?? [];
      await this.updateAuditJob(auditId, {
        issuesFound: rows.length,
        criticalCount: rows.filter((item) => item.severity === 'critical').length,
        highCount: rows.filter((item) => item.severity === 'high').length,
        mediumCount: rows.filter((item) => item.severity === 'medium').length,
        lowCount: rows.filter((item) => item.severity === 'low').length,
      });
      return stored;
    }
    const current = memory.issues.get(auditId) ?? [];
    stored = fullIssues.slice(0, Math.max(0, AUDIT_LIMITS.maxIssues - current.length));
    const next = [...current, ...stored];
    memory.issues.set(auditId, next);
    await this.updateAuditJob(auditId, {
      issuesFound: next.length,
      criticalCount: next.filter((item) => item.severity === 'critical').length,
      highCount: next.filter((item) => item.severity === 'high').length,
      mediumCount: next.filter((item) => item.severity === 'medium').length,
      lowCount: next.filter((item) => item.severity === 'low').length,
    });
    return stored;
  },

  async getLatestEvents(auditId: string, limit = 50): Promise<ResourceAuditEvent[]> {
    const client = getSupabaseAdminClient();
    if (client) {
      const { data, error } = await client
        .from('audit_events')
        .select('*')
        .eq('audit_id', auditId)
        .order('created_at', { ascending: false })
        .limit(limit);
      assertNoError(error, 'Get latest audit events');
      return (data ?? []).map(toAuditEvent).reverse();
    }
    return (memory.events.get(auditId) ?? []).slice(-limit);
  },

  async getEvents(auditId: string, limit = 50) {
    return this.getLatestEvents(auditId, limit);
  },

  async getLatestPages(auditId: string, limit = 100): Promise<ResourceAuditPage[]> {
    const client = getSupabaseAdminClient();
    if (client) {
      const { data, error } = await client
        .from('audit_pages')
        .select('*')
        .eq('audit_id', auditId)
        .order('crawled_at', { ascending: false })
        .limit(limit);
      assertNoError(error, 'Get latest audit pages');
      return (data ?? []).map(toAuditPage).reverse();
    }
    return (memory.pages.get(auditId) ?? []).slice(-limit);
  },

  async getPages(auditId: string, limit = 100) {
    return this.getLatestPages(auditId, limit);
  },

  async getLatestIssues(auditId: string, limit = 1000): Promise<ResourceAuditIssue[]> {
    const client = getSupabaseAdminClient();
    if (client) {
      const { data, error } = await client
        .from('audit_issues')
        .select('*')
        .eq('audit_id', auditId)
        .order('detected_at', { ascending: false })
        .limit(limit);
      assertNoError(error, 'Get latest audit issues');
      return (data ?? []).map(toAuditIssue).reverse();
    }
    return (memory.issues.get(auditId) ?? []).slice(-limit);
  },

  async getIssues(auditId: string, limit = 1000) {
    return this.getLatestIssues(auditId, limit);
  },

  async saveFinalReport(auditId: string, report: ResourceAuditReport) {
    const client = getSupabaseAdminClient();
    if (client) {
      const { error } = await client.from('audit_reports').upsert(reportToRow(auditId, report), { onConflict: 'audit_id' });
      assertNoError(error, 'Save final report');
      return;
    }
    memory.reports.set(auditId, report);
  },

  async setFinalReport(auditId: string, report: ResourceAuditReport) {
    return this.saveFinalReport(auditId, report);
  },

  async getFinalReport(auditId: string): Promise<ResourceAuditReport | null> {
    const client = getSupabaseAdminClient();
    if (client) {
      const { data, error } = await client.from('audit_reports').select('*').eq('audit_id', auditId).maybeSingle();
      assertNoError(error, 'Get final report');
      return toAuditReport(data);
    }
    return memory.reports.get(auditId) ?? null;
  },

  async getAuditLiveSnapshot(auditId: string): Promise<ResourceAuditLiveData> {
    return {
      audit: await this.getAuditJob(auditId),
      latestEvents: await this.getLatestEvents(auditId, 50),
      latestPages: await this.getLatestPages(auditId, 100),
      latestIssues: await this.getLatestIssues(auditId, 100),
      finalReport: await this.getFinalReport(auditId),
    };
  },

  async getLiveData(auditId: string) {
    return this.getAuditLiveSnapshot(auditId);
  },

  async listAuditHistoryForUser(input: {
    userId: string;
    status?: string;
    hostname?: string;
    includeArchived?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<AuditHistoryPage> {
    const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 25)));
    const offset = Math.max(0, Math.floor(input.offset ?? 0));
    const client = getSupabaseAdminClient();
    if (client) {
      let query = client
        .from('audits')
        .select('*', { count: 'exact' })
        .eq('user_id', input.userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (input.status) query = query.eq('status', input.status);
      if (input.hostname) query = query.eq('hostname', input.hostname);
      if (!input.includeArchived) query = query.is('archived_at', null);
      const { data, error, count } = await query;
      assertNoError(error, 'List audit history');
      const audits = (data ?? []).map(toAuditDocument).filter((audit): audit is ResourceAuditDocument => Boolean(audit));
      const reportByAudit = new Map<string, ResourceAuditReport>();
      if (audits.length) {
        const reports = await client.from('audit_reports').select('*').in('audit_id', audits.map((audit) => audit.id));
        assertNoError(reports.error, 'Load audit history reports');
        for (const row of reports.data ?? []) {
          const report = toAuditReport(row);
          if (report) reportByAudit.set(String(row.audit_id), report);
        }
      }
      return {
        items: audits.map((audit) => ({ audit, finalReport: reportByAudit.get(audit.id) ?? null })),
        total: count ?? audits.length,
        limit,
        offset,
      };
    }

    const all = Array.from(memory.audits.values())
      .filter((audit) => audit.userId === input.userId)
      .filter((audit) => !input.status || audit.status === input.status)
      .filter((audit) => !input.hostname || audit.hostname === input.hostname)
      .filter((audit) => input.includeArchived || !audit.archivedAt)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return {
      items: all.slice(offset, offset + limit).map((audit) => ({ audit, finalReport: memory.reports.get(audit.id) ?? null })),
      total: all.length,
      limit,
      offset,
    };
  },

  async compareAudits(currentAuditId: string, baselineAuditId: string): Promise<AuditComparison | null> {
    const [currentAudit, baselineAudit] = await Promise.all([
      this.getAuditJob(currentAuditId),
      this.getAuditJob(baselineAuditId),
    ]);
    if (!currentAudit || !baselineAudit) return null;
    const [currentIssuesResult, baselineIssuesResult, currentReport, baselineReport] = await Promise.all([
      this.getIssues(currentAuditId),
      this.getIssues(baselineAuditId),
      this.getFinalReport(currentAuditId),
      this.getFinalReport(baselineAuditId),
    ]);
    const currentIssues = currentIssuesResult as ResourceAuditIssue[];
    const baselineIssues = baselineIssuesResult as ResourceAuditIssue[];
    const currentByKey = new Map(currentIssues.map((issue) => [comparisonIssueKey(issue), issue]));
    const baselineByKey = new Map(baselineIssues.map((issue) => [comparisonIssueKey(issue), issue]));
    const currentScore = reportOverallScore(currentReport);
    const baselineScore = reportOverallScore(baselineReport);
    return {
      currentAuditId,
      baselineAuditId,
      normalizedUrl: currentAudit.normalizedUrl,
      currentScore,
      baselineScore,
      scoreDelta: currentScore == null || baselineScore == null ? null : currentScore - baselineScore,
      newIssues: Array.from(currentByKey.entries()).filter(([key]) => !baselineByKey.has(key)).map(([, issue]) => issue),
      resolvedIssues: Array.from(baselineByKey.entries()).filter(([key]) => !currentByKey.has(key)).map(([, issue]) => issue),
      persistentIssues: Array.from(currentByKey.entries())
        .filter(([key]) => baselineByKey.has(key))
        .map(([key, current]) => ({ current, baseline: baselineByKey.get(key)! })),
    };
  },

  async claimQueuedAuditJob(workerId: string, workerRuntime = 'node-worker'): Promise<ResourceAuditDocument | null> {
    const leaseExpiresAt = new Date(Date.now() + AUDIT_LIMITS.lockLeaseMs).toISOString();
    const timestamp = nowIso();
    const client = getSupabaseAdminClient();

    if (client) {
      const abandonPatch = {
        status: 'abandoned',
        current_phase: 'Stopped after recovery attempts',
        completed_at: timestamp,
        locked_by: null,
        locked_at: null,
        lease_expires_at: null,
        updated_at: timestamp,
      };
      const expiredAbandon = await client.from('audits').update(abandonPatch).eq('status', 'running').gte('recovery_attempts', AUDIT_LIMITS.maxRecoveryAttempts).lte('lease_expires_at', timestamp);
      assertNoError(expiredAbandon.error, 'Abandon expired audit after recovery limit');
      const missingLeaseAbandon = await client.from('audits').update(abandonPatch).eq('status', 'running').gte('recovery_attempts', AUDIT_LIMITS.maxRecoveryAttempts).is('lease_expires_at', null);
      assertNoError(missingLeaseAbandon.error, 'Abandon unleased audit after recovery limit');

      const queued = await client
        .from('audits')
        .select('*')
        .eq('status', 'queued')
        .order('queue_priority', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(100);
      assertNoError(queued.error, 'Find queued audit job');

      let candidate = (queued.data ?? []).find((row) => isClaimableLock(row, timestamp)) ?? null;
      if (!candidate) {
        const stale = await client
          .from('audits')
          .select('*')
          .eq('status', 'running')
          .lt('recovery_attempts', AUDIT_LIMITS.maxRecoveryAttempts)
          .order('lease_expires_at', { ascending: true, nullsFirst: true })
          .order('queue_priority', { ascending: false })
          .order('created_at', { ascending: true })
          .limit(100);
        assertNoError(stale.error, 'Find stale audit job');
        candidate = (stale.data ?? []).find((row) => isStaleRunningLock(row, timestamp)) ?? null;
      }

      if (!candidate) return null;

      const claimPatch = {
        status: 'running',
        progress: Math.max(candidate.progress ?? 0, 1),
        current_phase: candidate.status === 'running' ? 'Recovering stale audit' : 'Audit worker started',
        current_check: null,
        locked_by: workerId,
        locked_at: timestamp,
        lease_expires_at: leaseExpiresAt,
        worker_runtime: workerRuntime,
        started_at: candidate.started_at ?? timestamp,
        recovery_attempts: candidate.status === 'running' ? Number(candidate.recovery_attempts || 0) + 1 : Number(candidate.recovery_attempts || 0),
        last_recovered_at: candidate.status === 'running' ? timestamp : candidate.last_recovered_at ?? null,
        updated_at: timestamp,
      };

      const attempts: Array<(query: any) => any> = [];
      if (!candidate.locked_by) attempts.push((query) => query.is('locked_by', null));
      if (!candidate.lease_expires_at) attempts.push((query) => query.is('lease_expires_at', null));
      if (candidate.lease_expires_at && String(candidate.lease_expires_at) <= timestamp) {
        attempts.push((query) => query.lte('lease_expires_at', timestamp));
      }

      for (const applyCondition of attempts) {
        const query = applyCondition(
          client
            .from('audits')
            .update(claimPatch)
            .eq('id', candidate.id)
            .eq('status', candidate.status),
        );
        const { data, error } = await query.select('*').maybeSingle();
        assertNoError(error, 'Claim audit job');
        if (data) {
          if (candidate.status === 'running') {
            if (!(await this.prepareStaleAuditRetry(data.id, workerId))) return null;
            return this.getAuditJob(data.id);
          }
          return toAuditDocument(data);
        }
      }

      return null;
    }

    for (const audit of memory.audits.values()) {
      if (audit.status === 'running' && (!audit.leaseExpiresAt || audit.leaseExpiresAt <= timestamp) && (audit.recoveryAttempts || 0) >= AUDIT_LIMITS.maxRecoveryAttempts) {
        memory.audits.set(audit.id, { ...audit, status: 'abandoned', currentPhase: 'Stopped after recovery attempts', completedAt: timestamp, lockedBy: null, lockedAt: null, leaseExpiresAt: null, updatedAt: timestamp });
      }
    }
    const next = Array.from(memory.audits.values())
      .filter((audit) => {
        if (audit.status === 'queued') return !audit.lockedBy || !audit.leaseExpiresAt || audit.leaseExpiresAt <= timestamp;
        return audit.status === 'running' && (audit.recoveryAttempts || 0) < AUDIT_LIMITS.maxRecoveryAttempts && (!audit.leaseExpiresAt || audit.leaseExpiresAt <= timestamp);
      })
      .sort((a, b) => (b.queuePriority - a.queuePriority) || a.createdAt.localeCompare(b.createdAt))[0];
    if (!next) return null;

    const claimed = {
      ...next,
      status: 'running' as const,
      progress: Math.max(next.progress, 1),
      currentPhase: next.status === 'running' ? 'Recovering stale audit' : 'Audit worker started',
      lockedBy: workerId,
      lockedAt: timestamp,
      leaseExpiresAt,
      workerRuntime,
      startedAt: next.startedAt ?? timestamp,
      recoveryAttempts: next.status === 'running' ? (next.recoveryAttempts || 0) + 1 : next.recoveryAttempts || 0,
      lastRecoveredAt: next.status === 'running' ? timestamp : next.lastRecoveredAt ?? null,
      updatedAt: timestamp,
    };
    memory.audits.set(next.id, claimed);
    if (next.status === 'running') {
      if (!(await this.prepareStaleAuditRetry(next.id, workerId))) return null;
      return this.getAuditJob(next.id);
    }
    return claimed;
  },

  async claimNextQueuedAudit(workerId: string, workerRuntime?: string) {
    return this.claimQueuedAuditJob(workerId, workerRuntime);
  },

  async refreshAuditLease(auditId: string, workerId: string) {
    const timestamp = nowIso();
    const leaseExpiresAt = new Date(Date.now() + AUDIT_LIMITS.lockLeaseMs).toISOString();
    const client = getSupabaseAdminClient();
    if (client) {
      const { data, error } = await client
        .from('audits')
        .update({
          locked_by: workerId,
          lease_expires_at: leaseExpiresAt,
          updated_at: timestamp,
        })
        .eq('id', auditId)
        .eq('status', 'running')
        .eq('locked_by', workerId)
        .select('id')
        .maybeSingle();
      assertNoError(error, 'Refresh audit lease');
      return Boolean(data);
    }

    const current = memory.audits.get(auditId);
    if (!current || current.status !== 'running' || current.lockedBy !== workerId) return false;
    memory.audits.set(auditId, {
      ...current,
      leaseExpiresAt,
      updatedAt: timestamp,
    });
    return true;
  },

  async releaseAuditLease(auditId: string, workerId: string) {
    const timestamp = nowIso();
    const client = getSupabaseAdminClient();
    if (client) {
      const { error } = await client
        .from('audits')
        .update({
          locked_by: null,
          locked_at: null,
          lease_expires_at: null,
          updated_at: timestamp,
        })
        .eq('id', auditId)
        .eq('locked_by', workerId);
      assertNoError(error, 'Release audit lease');
      return;
    }

    const current = memory.audits.get(auditId);
    if (current?.lockedBy === workerId) {
      memory.audits.set(auditId, {
        ...current,
        lockedBy: null,
        lockedAt: null,
        leaseExpiresAt: null,
        updatedAt: timestamp,
      });
    }
  },

  async expireAuditLease(auditId: string, workerId: string) {
    const timestamp = nowIso();
    const client = getSupabaseAdminClient();
    if (client) {
      const { error } = await client
        .from('audits')
        .update({
          locked_by: null,
          locked_at: null,
          lease_expires_at: timestamp,
          current_phase: 'Worker stopped; waiting for another worker',
          current_check: null,
          updated_at: timestamp,
        })
        .eq('id', auditId)
        .eq('locked_by', workerId);
      assertNoError(error, 'Expire audit lease');
      return;
    }

    const current = memory.audits.get(auditId);
    if (current?.lockedBy === workerId) {
      memory.audits.set(auditId, {
        ...current,
        lockedBy: null,
        lockedAt: null,
        leaseExpiresAt: timestamp,
        currentPhase: 'Worker stopped; waiting for another worker',
        currentCheck: null,
        updatedAt: timestamp,
      });
    }
  },

  async prepareStaleAuditRetry(auditId: string, workerId: string) {
    const ownedAudit = await this.getAuditJob(auditId);
    if (!ownedAudit || ownedAudit.status !== 'running' || ownedAudit.lockedBy !== workerId) return false;
    const client = getSupabaseAdminClient();
    if (client) {
      for (const table of ['audit_pages', 'audit_issues', 'audit_reports']) {
        const { error } = await client.from(table).delete().eq('audit_id', auditId);
        assertNoError(error, `Clear stale ${table}`);
      }
    } else {
      memory.pages.set(auditId, []);
      memory.issues.set(auditId, []);
      memory.reports.delete(auditId);
    }

    await this.appendAuditEvent(auditId, {
      type: 'audit_recovered',
      message: `Audit recovered by ${workerId} after a stale worker lease.`,
      phase: 'Recovering stale audit',
    });
    const updated = await this.updateAuditForWorker(auditId, workerId, {
      status: 'running',
      progress: 1,
      currentPhase: 'Recovering stale audit',
      currentUrl: null,
      currentCheck: null,
      pagesDiscovered: 0,
      pagesCrawled: 0,
      checksTotal: 0,
      checksCompleted: 0,
      issuesFound: 0,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      finalUrl: null,
      error: null,
    });
    return updated;
  },

  async releaseAuditLock(id: string) {
    await this.updateAuditJob(id, {
      lockedBy: null,
      lockedAt: null,
      leaseExpiresAt: null,
    });
  },

  async cleanupOldAudits(limit = 25) {
    const client = getSupabaseAdminClient();
    const current = nowIso();
    if (!client) {
      for (const audit of memory.audits.values()) {
        if (audit.expiresAt < current) {
          memory.events.delete(audit.id);
          memory.pages.delete(audit.id);
          memory.issues.delete(audit.id);
          memory.reports.delete(audit.id);
          memory.audits.delete(audit.id);
        }
      }
      return;
    }

    const { error } = await client.from('audits').delete().lt('expires_at', current).limit(limit);
    assertNoError(error, 'Clean up old audits');
  },

  async clearExpiredAuditData() {
    return this.cleanupOldAudits();
  },
};
