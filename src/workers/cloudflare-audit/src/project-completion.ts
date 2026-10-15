import type { ResourceAuditDocument, ResourceAuditReport } from '../../../lib/audit/resource-types';

export interface ProjectCompletionEnvironment {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export interface ProjectCompletionOptions {
  fetchImpl?: typeof fetch;
  subrequestBudget?: { consume(): void };
  signal?: AbortSignal;
}

export type ProjectCompletionResult = {
  status: 'recorded';
  outcome: 'completed' | 'failed';
  notificationsInserted: number;
  notificationsExisting: number;
  requests: number;
} | {
  status: 'skipped';
  reason: 'not_project_owned' | 'not_terminal' | 'project_missing' | 'alerts_disabled';
  requests: number;
};

type ErrorCode = 'PROJECT_COMPLETION_CONFIGURATION' | 'PROJECT_COMPLETION_INVALID_DATA'
  | 'PROJECT_COMPLETION_TIMEOUT' | 'PROJECT_COMPLETION_CANCELLED' | 'PROJECT_COMPLETION_NETWORK'
  | 'PROJECT_COMPLETION_DATABASE' | 'PROJECT_COMPLETION_RESPONSE_LIMIT' | 'PROJECT_COMPLETION_REQUEST_LIMIT';

export class ProjectCompletionError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(code);
    this.name = 'ProjectCompletionError';
  }
}

type AuditIdentity = Pick<ResourceAuditDocument, 'id' | 'projectId' | 'userId'>;
type ReportEvidence = Pick<ResourceAuditReport, 'scores' | 'topIssues'>;
type Row = Record<string, unknown>;
type Table = 'audits' | 'projects' | 'audit_reports' | 'project_notifications';
type NotificationKind = 'audit_completed' | 'audit_failed' | 'score_drop' | 'new_critical';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RESPONSE_BYTES = 262_144;
const MAX_REQUESTS = 8;
const DEADLINE_MS = 10_000;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

function isRow(value: unknown): value is Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function singleRow(value: unknown): Row | null {
  if (!Array.isArray(value) || value.length > 1 || (value.length && !isRow(value[0]))) {
    throw new ProjectCompletionError('PROJECT_COMPLETION_INVALID_DATA');
  }
  return value[0] ?? null;
}

function truncated(value: string, length: number) {
  let result = '';
  let count = 0;
  for (const character of value) {
    if (count++ === length) break;
    result += character;
  }
  return result;
}

function scoreOf(scores: unknown) {
  if (!isRow(scores) || scores.overall == null) return null;
  const value = Number(scores.overall);
  return Number.isFinite(value) ? Math.round(value) : null;
}

function criticalKeys(issues: unknown) {
  if (issues == null) return [];
  if (!Array.isArray(issues) || issues.length > 1000 || issues.some((issue) => !isRow(issue))) {
    throw new ProjectCompletionError('PROJECT_COMPLETION_INVALID_DATA');
  }
  return issues.filter((issue: Row) => issue.severity === 'critical').map((issue: Row) =>
    String(issue.findingKey || `${issue.category}|${issue.title}|${issue.affectedUrl}`).toLowerCase());
}

function aborted(signal: AbortSignal) {
  return signal.reason instanceof ProjectCompletionError ? signal.reason
    : new ProjectCompletionError('PROJECT_COMPLETION_CANCELLED');
}

function interruptible<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(aborted(signal));
    if (signal.aborted) {
      void operation.catch(() => {});
      reject(aborted(signal));
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function discard(response: Response) {
  try { void response.body?.cancel().catch(() => {}); } catch { /* Already locked or closed. */ }
}

async function responseJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    discard(response);
    throw new ProjectCompletionError('PROJECT_COMPLETION_RESPONSE_LIMIT');
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  let complete = false;
  try {
    while (true) {
      const { done, value } = await interruptible(reader.read(), signal);
      if (done) { complete = true; break; }
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new ProjectCompletionError('PROJECT_COMPLETION_RESPONSE_LIMIT');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    if (!text) return null;
    try { return JSON.parse(text) as unknown; } catch {
      throw new ProjectCompletionError('PROJECT_COMPLETION_INVALID_DATA');
    }
  } finally {
    if (!complete) {
      try { void reader.cancel().catch(() => {}); } catch { /* Best-effort stream cleanup. */ }
    }
    reader.releaseLock();
  }
}

/**
 * Call only AFTER a successful, terminal scalable_audit_finish_slice commit, with the
 * exact report sent to that RPC. This helper rechecks persisted status and ownership.
 * Reserve eight shared subrequests and ten seconds; failures must not reopen the audit.
 * There is no existing completion outbox/RPC: these are retryable best-effort effects,
 * not an atomic extension of audit finalization. Notification uniqueness is enforced by
 * (project_id, audit_id, kind) in migration 021; do not bulk-insert duplicate-prone rows.
 * Matches Render's sampled topIssues comparison and change_alerts_enabled gate; its
 * current behavior does not apply notification_preferences or compare audit scopes.
 */
export async function recordSecondaryProjectAuditOutcome(
  env: ProjectCompletionEnvironment,
  identity: AuditIdentity,
  report: ReportEvidence | null,
  options: ProjectCompletionOptions = {},
): Promise<ProjectCompletionResult> {
  if (!identity.projectId || !identity.userId) {
    return { status: 'skipped', reason: 'not_project_owned', requests: 0 };
  }
  if (![identity.id, identity.projectId, identity.userId].every((id) => UUID.test(id))) {
    throw new ProjectCompletionError('PROJECT_COMPLETION_INVALID_DATA');
  }
  let origin: URL;
  try { origin = new URL(env.SUPABASE_URL || ''); } catch {
    throw new ProjectCompletionError('PROJECT_COMPLETION_CONFIGURATION');
  }
  if (origin.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/.test(origin.hostname)
    || origin.port || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
    || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new ProjectCompletionError('PROJECT_COMPLETION_CONFIGURATION');
  }
  const fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const controller = new AbortController();
  const onAbort = () => controller.abort(new ProjectCompletionError('PROJECT_COMPLETION_CANCELLED'));
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  const timer = setTimeout(() => controller.abort(new ProjectCompletionError('PROJECT_COMPLETION_TIMEOUT')), DEADLINE_MS);
  let requests = 0;
  const request = async (
    table: Table, query: Record<string, string>, method: 'GET' | 'PATCH' | 'POST' = 'GET', body?: Row,
  ) => {
    if (controller.signal.aborted) throw aborted(controller.signal);
    if (requests === MAX_REQUESTS) throw new ProjectCompletionError('PROJECT_COMPLETION_REQUEST_LIMIT');
    try { options.subrequestBudget?.consume(); } catch {
      throw new ProjectCompletionError('PROJECT_COMPLETION_REQUEST_LIMIT');
    }
    requests += 1;
    const url = new URL(`/rest/v1/${table}`, origin);
    url.search = new URLSearchParams(query).toString();
    const operation = fetchImpl(url, {
      method, redirect: 'manual', cache: 'no-store', signal: controller.signal,
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: 'application/json', 'Content-Type': 'application/json', Prefer: 'return=minimal',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    void operation.then((response) => { if (controller.signal.aborted) discard(response); }, () => {});
    const response = await interruptible(operation, controller.signal);
    const data = await responseJson(response, controller.signal);
    // Retrying individual notifications must continue past an existing kind.
    if (!response.ok && table === 'project_notifications' && method === 'POST'
      && response.status === 409 && isRow(data) && data.code === '23505') return { duplicate: true, data: null };
    if (!response.ok) throw new ProjectCompletionError('PROJECT_COMPLETION_DATABASE');
    return { duplicate: false, data };
  };
  const read = async (table: Table, select: string, query: Record<string, string>) =>
    singleRow((await request(table, { select, ...query, limit: '1' })).data);
  let notificationsInserted = 0;
  let notificationsExisting = 0;
  const notify = async (kind: NotificationKind, title: string, message: string) => {
    const result = await request('project_notifications', {}, 'POST', {
      project_id: identity.projectId, user_id: identity.userId, audit_id: identity.id, kind,
      title: truncated(title, 160), message: truncated(message, 600),
    });
    if (result.duplicate) notificationsExisting += 1;
    else notificationsInserted += 1;
  };
  try {
    const audit = await read('audits', 'id,project_id,user_id,status,completed_at,pages_crawled,issues_found,error', {
      id: `eq.${identity.id}`, project_id: `eq.${identity.projectId}`, user_id: `eq.${identity.userId}`,
    });
    if (!audit || !['completed', 'completed_with_warnings', 'failed'].includes(String(audit.status))) {
      return { status: 'skipped', reason: 'not_terminal', requests };
    }
    if (audit.id !== identity.id || audit.project_id !== identity.projectId || audit.user_id !== identity.userId) {
      throw new ProjectCompletionError('PROJECT_COMPLETION_INVALID_DATA');
    }
    const project = await read('projects', 'id,user_id,name,change_alerts_enabled,last_audit_at,last_audit_id', {
      id: `eq.${identity.projectId}`, user_id: `eq.${identity.userId}`,
    });
    if (!project) return { status: 'skipped', reason: 'project_missing', requests };
    if (project.id !== identity.projectId || project.user_id !== identity.userId || typeof project.name !== 'string'
      || typeof project.change_alerts_enabled !== 'boolean') {
      throw new ProjectCompletionError('PROJECT_COMPLETION_INVALID_DATA');
    }
    if (audit.status === 'failed') {
      if (!project.change_alerts_enabled) return { status: 'skipped', reason: 'alerts_disabled', requests };
      await notify('audit_failed', `${project.name} audit needs attention`,
        typeof audit.error === 'string' && audit.error ? audit.error : 'The audit could not complete.');
      return { status: 'recorded', outcome: 'failed', notificationsInserted, notificationsExisting, requests };
    }
    if (typeof audit.completed_at !== 'string' || !TIMESTAMP.test(audit.completed_at)
      || !Number.isFinite(Date.parse(audit.completed_at))) throw new ProjectCompletionError('PROJECT_COMPLETION_INVALID_DATA');
    // Keep PostgreSQL's microseconds; JavaScript Date would truncate them in the guard.
    const completedAt = audit.completed_at;
    if (project.last_audit_id !== identity.id) {
      // Conditional PATCH prevents a delayed/retried older completion regressing the pointer.
      await request('projects', {
        id: `eq.${identity.projectId}`, user_id: `eq.${identity.userId}`,
        or: `(last_audit_at.is.null,last_audit_at.lte.${completedAt})`,
      }, 'PATCH', { last_audit_id: identity.id, last_audit_at: completedAt, updated_at: new Date().toISOString() });
    }
    if (!project.change_alerts_enabled) return { status: 'skipped', reason: 'alerts_disabled', requests };
    if (!report || !isRow(report.scores) || !Array.isArray(report.topIssues)) {
      throw new ProjectCompletionError('PROJECT_COMPLETION_INVALID_DATA');
    }
    const currentCritical = criticalKeys(report.topIssues);
    const previous = await read('audits', 'id', {
      project_id: `eq.${identity.projectId}`, user_id: `eq.${identity.userId}`, id: `neq.${identity.id}`,
      status: 'in.(completed,completed_with_warnings)', completed_at: `lte.${completedAt}`, order: 'completed_at.desc,id.desc',
    });
    if (previous && (typeof previous.id !== 'string' || !UUID.test(previous.id) || previous.id === identity.id)) {
      throw new ProjectCompletionError('PROJECT_COMPLETION_INVALID_DATA');
    }
    const previousReport = previous ? await read('audit_reports', 'scores,top_issues', { audit_id: `eq.${previous.id}` }) : null;
    const currentScore = scoreOf(report.scores);
    const previousScore = scoreOf(previousReport?.scores);
    const previousCritical = new Set(criticalKeys(previousReport?.top_issues));
    const newCritical = currentCritical.filter((key) => !previousCritical.has(key)).length;
    if (!Number.isInteger(audit.pages_crawled) || Number(audit.pages_crawled) < 0
      || !Number.isInteger(audit.issues_found) || Number(audit.issues_found) < 0) {
      throw new ProjectCompletionError('PROJECT_COMPLETION_INVALID_DATA');
    }
    await notify('audit_completed', `${project.name} audit completed`,
      `Checked ${audit.pages_crawled} pages and recorded ${audit.issues_found} findings.`);
    if (currentScore != null && previousScore != null && currentScore <= previousScore - 5) {
      await notify('score_drop', `${project.name} score decreased`,
        `The measured audit score changed from ${previousScore} to ${currentScore}. Review new and persistent findings.`);
    }
    if (newCritical > 0) {
      await notify('new_critical', `New critical findings on ${project.name}`,
        `${newCritical} critical ${newCritical === 1 ? 'finding was' : 'findings were'} not present in the previous completed audit.`);
    }
    return { status: 'recorded', outcome: 'completed', notificationsInserted, notificationsExisting, requests };
  } catch (error) {
    if (controller.signal.aborted) throw aborted(controller.signal);
    if (error instanceof ProjectCompletionError) throw error;
    throw new ProjectCompletionError('PROJECT_COMPLETION_NETWORK');
  } finally {
    controller.abort();
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
