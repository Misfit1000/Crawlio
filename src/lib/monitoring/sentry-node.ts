import { createHash } from 'node:crypto';
import * as Sentry from '@sentry/node';
import {
  isExpectedMonitoringError,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  scrubSentrySpan,
  scrubUnknown,
} from './sentry-privacy';
import { resolveSentryEnvironment, resolveSentryRelease } from './sentry-build';

export type MonitoringRuntime = 'vercel-api' | 'audit-worker';
type NodeSentry = {
  init(options: Record<string, unknown>): unknown;
  captureException(error: unknown, hint?: Record<string, unknown>): unknown;
  captureMessage(message: string, hint?: Record<string, unknown>): unknown;
  flush(timeout: number): Promise<boolean>;
};

const initializedRuntimes = new Set<MonitoringRuntime>();
const workerCaptureTimes = new Map<string, number>();
let pendingNodeEvents = false;
const WORKER_CAPTURE_COOLDOWN_MS = 60_000;

const EXPECTED_WORKER_FAILURES = new Set([
  'AUDIT_CANCELLED',
  'AUDIT_OWNERSHIP_LOST',
  'ROBOTS_BLOCKED',
  'SSRF_BLOCKED',
  'DNS_FAILURE',
  'CONNECTION_REFUSED',
  'PAGE_TIMEOUT',
  'FETCH_ABORTED',
  'HTTP_400',
  'HTTP_401',
  'HTTP_403',
  'HTTP_404',
  'HTTP_408',
  'HTTP_429',
  'HTTP_500',
  'HTTP_502',
  'HTTP_503',
  'HTTP_504',
  'AUDIT_DEADLINE_EXCEEDED',
  'PAGE_QUOTA_REACHED',
  'QUEUE_EXHAUSTED',
]);

function serviceFor(runtime: MonitoringRuntime) {
  return runtime === 'audit-worker' ? 'crawlio-worker' : 'crawlio-api';
}

export function buildNodeSentryOptions(
  runtime: MonitoringRuntime,
  env: Record<string, string | undefined> = process.env,
) {
  const environment = resolveSentryEnvironment(env, env.NODE_ENV || 'production');
  const release = resolveSentryRelease(env);
  const dsn = String(env.SENTRY_DSN || '').trim();
  const enabled = Boolean(dsn && environment !== 'test');
  return {
    enabled,
    options: {
      dsn,
      enabled,
      environment,
      release,
      sendDefaultPii: false,
      sampleRate: 1,
      tracesSampleRate: runtime === 'audit-worker'
        ? 0
        : environment === 'production' ? 0.02 : environment === 'preview' ? 0.01 : 0,
      includeLocalVariables: false,
      maxValueLength: 1_000,
      initialScope: {
        tags: {
          runtime,
          service: serviceFor(runtime),
        },
      },
      beforeSend(event: Record<string, unknown>, hint: Record<string, unknown>) {
        return scrubSentryEvent(event, hint);
      },
      beforeBreadcrumb(breadcrumb: Record<string, unknown>) {
        return scrubSentryBreadcrumb(breadcrumb);
      },
      beforeSendTransaction(event: Record<string, unknown>) {
        return scrubSentryEvent(event);
      },
      beforeSendSpan(span: Record<string, unknown>) {
        return scrubSentrySpan(span);
      },
    },
  };
}

export function initializeNodeMonitoring(
  runtime: MonitoringRuntime,
  env: Record<string, string | undefined> = process.env,
  sdk: NodeSentry = Sentry as unknown as NodeSentry,
) {
  if (initializedRuntimes.has(runtime)) return true;
  const configuration = buildNodeSentryOptions(runtime, env);
  if (!configuration.enabled) return false;
  sdk.init(configuration.options);
  initializedRuntimes.add(runtime);
  return true;
}

export function initializeApiMonitoring() {
  return initializeNodeMonitoring('vercel-api');
}

export function initializeWorkerMonitoring() {
  return initializeNodeMonitoring('audit-worker');
}

export function isNodeMonitoringConfigured(
  env: Record<string, string | undefined> = process.env,
) {
  return Boolean(env.SENTRY_DSN?.trim())
    && resolveSentryEnvironment(env, env.NODE_ENV || 'production') !== 'test';
}

export function auditCorrelationId(auditId: string) {
  return createHash('sha256').update(`crawlio-audit:${auditId}`).digest('hex').slice(0, 16);
}

export function shouldCaptureApiError(status: number, expected = false) {
  return !expected && status >= 500;
}

export function captureApiException(
  error: unknown,
  context: {
    status: number;
    expected?: boolean;
    apiRoute?: string;
    httpMethod?: string;
    operation?: string;
    auditMode?: string;
    plan?: string;
    requestId?: string;
  },
  sdk: NodeSentry = Sentry as unknown as NodeSentry,
) {
  if (
    !initializedRuntimes.has('vercel-api')
    || !shouldCaptureApiError(context.status, context.expected)
    || isExpectedMonitoringError(error)
  ) return false;
  sdk.captureException(error, {
    tags: {
      apiRoute: String(context.apiRoute || 'unknown').slice(0, 200),
      httpMethod: String(context.httpMethod || 'unknown').slice(0, 12),
      operation: String(context.operation || 'api-request').slice(0, 80),
      ...(context.auditMode ? { auditMode: context.auditMode.slice(0, 30) } : {}),
      ...(context.plan ? { plan: context.plan.slice(0, 30) } : {}),
    },
    extra: scrubUnknown({ requestId: context.requestId }) as Record<string, unknown>,
  });
  pendingNodeEvents = true;
  return true;
}

export function shouldCaptureWorkerError(failureCategory = '') {
  const category = failureCategory.toUpperCase();
  if (EXPECTED_WORKER_FAILURES.has(category)) return false;
  return !/^(?:HTTP_|DNS_|ROBOTS_|SSRF_|TARGET_|PAGE_|FETCH_|CRAWL_QUEUE_|AUDIT_CANCELLED|AUDIT_OWNERSHIP_LOST|CHECK_UNAVAILABLE)/.test(category);
}

export function captureWorkerException(
  error: unknown,
  context: {
    jobStage: string;
    failureCategory: string;
    auditId?: string;
    auditMode?: string;
    workerVersion?: string;
    schemaVersion?: string | number;
    engineVersion?: string;
    scoringVersion?: string;
    attemptNumber?: number;
  },
  sdk: NodeSentry = Sentry as unknown as NodeSentry,
  nowMs = Date.now(),
) {
  if (
    !initializedRuntimes.has('audit-worker')
    || !shouldCaptureWorkerError(context.failureCategory)
    || isExpectedMonitoringError(error)
  ) return false;

  const dedupeKey = `${context.jobStage}:${context.failureCategory}`;
  const lastCapture = workerCaptureTimes.get(dedupeKey) || 0;
  if (nowMs - lastCapture < WORKER_CAPTURE_COOLDOWN_MS) return false;
  workerCaptureTimes.set(dedupeKey, nowMs);

  sdk.captureException(error, {
    tags: {
      jobStage: context.jobStage.slice(0, 80),
      failureCategory: context.failureCategory.slice(0, 80),
      ...(context.auditMode ? { auditMode: context.auditMode.slice(0, 30) } : {}),
      ...(context.workerVersion ? { workerVersion: context.workerVersion.slice(0, 40) } : {}),
      ...(context.schemaVersion != null ? { schemaVersion: String(context.schemaVersion).slice(0, 20) } : {}),
      ...(context.engineVersion ? { engineVersion: context.engineVersion.slice(0, 30) } : {}),
      ...(context.scoringVersion ? { scoringVersion: context.scoringVersion.slice(0, 30) } : {}),
      ...(context.auditId ? { auditCorrelationId: auditCorrelationId(context.auditId) } : {}),
    },
    extra: scrubUnknown({ attemptNumber: context.attemptNumber }) as Record<string, unknown>,
  });
  pendingNodeEvents = true;
  return true;
}

export function captureAdminSentryTestEvent(sdk: NodeSentry = Sentry as unknown as NodeSentry) {
  if (!initializedRuntimes.has('vercel-api')) return false;
  sdk.captureException(new Error('Crawlio administrator Sentry verification event'), {
    tags: {
      testEvent: 'true',
      service: 'crawlio-api',
      runtime: 'vercel-api',
    },
  });
  pendingNodeEvents = true;
  return true;
}

export async function flushNodeMonitoring(timeoutMs = 1_500, sdk: NodeSentry = Sentry as unknown as NodeSentry) {
  if (!initializedRuntimes.size || !pendingNodeEvents) return true;
  try {
    const flushed = await sdk.flush(Math.max(100, Math.min(5_000, timeoutMs)));
    if (flushed) pendingNodeEvents = false;
    return flushed;
  } catch {
    return false;
  }
}

export function resetNodeMonitoringForTests() {
  initializedRuntimes.clear();
  workerCaptureTimes.clear();
  pendingNodeEvents = false;
}
