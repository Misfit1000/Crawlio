import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import AppErrorBoundary from '../src/components/AppErrorBoundary';
import {
  browserTracingSampleRate,
  buildBrowserSentryOptions,
  captureBrowserException,
  initializeBrowserMonitoring,
} from '../src/lib/monitoring/sentry-browser';
import {
  resolveSentryBuildConfiguration,
  resolveSentryEnvironment,
  resolveSentryRelease,
} from '../src/lib/monitoring/sentry-build';
import {
  captureApiException,
  captureAdminSentryTestEvent,
  captureWorkerException,
  flushNodeMonitoring,
  initializeNodeMonitoring,
  resetNodeMonitoringForTests,
  shouldCaptureApiError,
  shouldCaptureWorkerError,
} from '../src/lib/monitoring/sentry-node';
import {
  isExpectedMonitoringError,
  sanitizeUrl,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  scrubSentrySpan,
} from '../src/lib/monitoring/sentry-privacy';

const mockDsn = 'https://public@example.ingest.sentry.io/1';

const browserCalls = {
  init: [] as Array<Record<string, unknown>>,
  captures: [] as Array<{ error: unknown; hint?: Record<string, unknown> }>,
  breadcrumbs: [] as Array<Record<string, unknown>>,
};
const browserSdk = {
  init(options: Record<string, unknown>) { browserCalls.init.push(options); },
  captureException(error: unknown, hint?: Record<string, unknown>) {
    browserCalls.captures.push({ error, hint });
    return 'browser-event';
  },
  addBreadcrumb(breadcrumb: Record<string, unknown>) { browserCalls.breadcrumbs.push(breadcrumb); },
};

assert.equal(initializeBrowserMonitoring({ MODE: 'production' }, browserSdk), false);
assert.equal(browserCalls.init.length, 0);
assert.equal(initializeBrowserMonitoring({
  MODE: 'development',
  VITE_SENTRY_DSN: mockDsn,
  SENTRY_ENVIRONMENT: 'development',
}, browserSdk), false);
assert.equal(initializeBrowserMonitoring({
  MODE: 'preview',
  VITE_SENTRY_DSN: mockDsn,
  SENTRY_ENVIRONMENT: 'preview',
  SENTRY_RELEASE: 'abc123',
}, browserSdk), true);
assert.equal(browserCalls.init.length, 1);
assert.equal(browserCalls.init[0].sendDefaultPii, false);
assert.equal(browserCalls.init[0].sampleRate, 1);
assert.equal(browserCalls.init[0].tracesSampleRate, 0.02);
assert.equal(browserTracingSampleRate('production'), 0.05);
assert.equal(browserTracingSampleRate('development'), 0);
assert.equal(buildBrowserSentryOptions({ MODE: 'test', VITE_SENTRY_DSN: mockDsn }).enabled, false);

assert.equal(captureBrowserException(new Error('unexpected render state'), { operation: 'state-sync' }, browserSdk), true);
assert.equal(browserCalls.captures.length, 1);
const cancelled = new Error('cancelled');
cancelled.name = 'AbortError';
assert.equal(captureBrowserException(cancelled, {}, browserSdk), false);
assert.equal(isExpectedMonitoringError(cancelled), true);

const rawEvent = {
  request: {
    url: 'https://keywordsintel.vercel.app/api/tools/audit?id=secret#fragment',
    query_string: 'id=secret',
    cookies: 'session=secret',
    data: { password: 'secret', html: '<main>customer</main>' },
    headers: {
      Authorization: 'Bearer secret.jwt.value',
      Cookie: 'session=secret',
      Accept: 'application/json',
    },
  },
  user: {
    id: 'user-1',
    email: 'person@example.com',
    ip_address: '127.0.0.1',
  },
  contexts: {
    audit: {
      targetUrl: 'https://customer.example/private/path?access_token=secret',
      rawHtml: '<main>customer</main>',
      auditMode: 'standard',
    },
  },
  extra: {
    refresh_token: 'secret',
    GROQ_API_KEY: 'gsk_secret',
    report: { pages: ['private'] },
  },
  breadcrumbs: [{
    category: 'fetch',
    message: 'GET https://customer.example/private?q=secret',
    data: { url: 'https://customer.example/private?q=secret' },
  }],
};
const hint = {
  attachments: [{ filename: 'report.json', data: '{"private":true}' }],
};
const scrubbed = scrubSentryEvent(structuredClone(rawEvent), hint) as any;
assert.equal(scrubbed.request.url, 'https://keywordsintel.vercel.app/api/tools/audit');
assert.equal(scrubbed.request.query_string, undefined);
assert.equal(scrubbed.request.data, undefined);
assert.equal(scrubbed.request.headers.Authorization, undefined);
assert.equal(scrubbed.request.headers.Cookie, undefined);
assert.equal(scrubbed.request.headers.Accept, 'application/json');
assert.equal(scrubbed.user, undefined);
assert.equal(scrubbed.contexts.audit.targetUrl, 'https://customer.example');
assert.equal(scrubbed.contexts.audit.rawHtml, '[omitted]');
assert.equal(scrubbed.extra.refresh_token, '[redacted]');
assert.equal(scrubbed.extra.report, '[omitted]');
assert.deepEqual(hint.attachments, []);
const serializedScrubbed = JSON.stringify(scrubbed);
for (const forbidden of ['secret.jwt.value', 'person@example.com', '<main>customer</main>', 'gsk_secret', '?q=secret']) {
  assert.equal(serializedScrubbed.includes(forbidden), false, `Sensitive Sentry value remained: ${forbidden}`);
}
assert.equal(sanitizeUrl('https://user:pass@example.com/path?q=1#two'), 'https://example.com');
assert.equal(scrubSentryBreadcrumb({ category: 'console', message: 'secret' }), null);
assert.equal(scrubSentryBreadcrumb({ category: 'ui.input', message: 'password field' }), null);
assert.equal(
  scrubSentrySpan({ description: 'GET https://customer.example/private?q=secret', data: { targetUrl: 'https://customer.example/path?q=secret' } }).description,
  'GET https://customer.example',
);

let boundaryCapture: { error: unknown; componentStack: string } | null = null;
const boundary = new AppErrorBoundary({
  children: null,
  onCapture(error, componentStack) {
    boundaryCapture = { error, componentStack };
  },
});
boundary.componentDidCatch(new Error('render failed'), { componentStack: '\n at BrokenView' });
assert.equal((boundaryCapture as any)?.componentStack, '\n at BrokenView');
boundary.state = { failed: true };
const fallback = renderToStaticMarkup(boundary.render());
assert.match(fallback, /This view could not be displayed/);
assert.match(fallback, /Try again/);
assert.doesNotMatch(fallback, /render failed|BrokenView|stack/i);

const nodeCalls = {
  init: [] as Array<Record<string, unknown>>,
  captures: [] as Array<{ error: unknown; hint?: Record<string, unknown> }>,
  messages: [] as Array<{ message: string; hint?: Record<string, unknown> }>,
  flush: [] as number[],
};
const nodeSdk = {
  init(options: Record<string, unknown>) { nodeCalls.init.push(options); },
  captureException(error: unknown, hint?: Record<string, unknown>) {
    nodeCalls.captures.push({ error, hint });
    return 'node-event';
  },
  captureMessage(message: string, hint?: Record<string, unknown>) {
    nodeCalls.messages.push({ message, hint });
    return 'node-message';
  },
  async flush(timeout: number) {
    nodeCalls.flush.push(timeout);
    return true;
  },
};

resetNodeMonitoringForTests();
assert.equal(initializeNodeMonitoring('vercel-api', { NODE_ENV: 'test', SENTRY_DSN: mockDsn }, nodeSdk), false);
assert.equal(initializeNodeMonitoring('vercel-api', {
  NODE_ENV: 'production',
  SENTRY_DSN: mockDsn,
  VERCEL_GIT_COMMIT_SHA: 'full-release-sha',
}, nodeSdk), true);
assert.equal(nodeCalls.init.at(-1)?.sendDefaultPii, false);
assert.equal(shouldCaptureApiError(500), true);
assert.equal(shouldCaptureApiError(403), false);
assert.equal(captureApiException(new Error('database write failed'), {
  status: 500,
  apiRoute: '/admin/diagnostics',
  httpMethod: 'GET',
  requestId: 'request-safe-id',
}, nodeSdk), true);
assert.equal(captureApiException(new Error('not authorized'), { status: 403 }, nodeSdk), false);
assert.equal(captureAdminSentryTestEvent(nodeSdk), true);
assert.match(String((nodeCalls.captures.at(-1)?.error as Error)?.message), /administrator Sentry verification event/);
assert.equal(nodeCalls.captures.at(-1)?.hint?.tags && (nodeCalls.captures.at(-1)?.hint?.tags as any).testEvent, 'true');

resetNodeMonitoringForTests();
assert.equal(initializeNodeMonitoring('audit-worker', {
  NODE_ENV: 'production',
  SENTRY_DSN: mockDsn,
  RENDER_GIT_COMMIT: 'worker-release-sha',
}, nodeSdk), true);
assert.equal(nodeCalls.init.at(-1)?.tracesSampleRate, 0);
assert.equal(shouldCaptureWorkerError('DNS_FAILURE'), false);
assert.equal(shouldCaptureWorkerError('ROBOTS_BLOCKED'), false);
assert.equal(shouldCaptureWorkerError('DATABASE_WRITE_FAILURE'), true);
assert.equal(captureWorkerException(new Error('target DNS failed'), {
  jobStage: 'page-fetch',
  failureCategory: 'DNS_FAILURE',
  auditId: 'audit-private-id',
}, nodeSdk), false);
assert.equal(captureWorkerException(new Error('database write failed'), {
  jobStage: 'report-write',
  failureCategory: 'DATABASE_WRITE_FAILURE',
  auditId: 'audit-private-id',
  auditMode: 'standard',
  engineVersion: '2026.07',
}, nodeSdk, 100_000), true);
const workerHint = nodeCalls.captures.at(-1)?.hint;
assert.equal(JSON.stringify(workerHint).includes('audit-private-id'), false);
assert.match(JSON.stringify(workerHint), /auditCorrelationId/);
assert.equal(await flushNodeMonitoring(900, nodeSdk), true);
assert.deepEqual(nodeCalls.flush.at(-1), 900);

const noUpload = resolveSentryBuildConfiguration({ VERCEL_ENV: 'production' }, 'production');
assert.equal(noUpload.sourceMapsConfigured, false);
assert.equal(noUpload.sourceMapOptions, null);
const upload = resolveSentryBuildConfiguration({
  VERCEL_ENV: 'production',
  VERCEL_GIT_COMMIT_SHA: 'release-sha',
  SENTRY_AUTH_TOKEN: 'test-token',
  SENTRY_ORG: 'test-org',
  SENTRY_PROJECT: 'test-project',
}, 'production');
assert.equal(upload.sourceMapsConfigured, true);
assert.equal(upload.release, 'release-sha');
assert.equal(upload.sourceMapOptions?.sourcemaps.filesToDeleteAfterUpload, './dist/**/*.map');
assert.equal(resolveSentryEnvironment({ VERCEL_ENV: 'preview' }), 'preview');
assert.equal(resolveSentryRelease({ RENDER_GIT_COMMIT: 'worker-sha' }), 'worker-sha');

const browserSource = await readFile('src/lib/monitoring/sentry-browser.ts', 'utf8');
const nodeSource = await readFile('src/lib/monitoring/sentry-node.ts', 'utf8');
const workerSource = await readFile('src/workers/audit-worker.ts', 'utf8');
const apiSource = await readFile('src/api/index.ts', 'utf8');
assert.doesNotMatch(browserSource, /@sentry\/node|SENTRY_AUTH_TOKEN|SUPABASE_SERVICE_ROLE_KEY/);
assert.doesNotMatch(nodeSource, /import\.meta\.env/);
assert.doesNotMatch(workerSource, /vercel-handler|src\/api|from ['"].*api\//);
assert.doesNotMatch(apiSource, /safe-public-fetch|runAllChecksSafely|audit-worker/);
assert.match(apiSource, /requireAdminRequester\(req, res\)/);
assert.match(apiSource, /sentry-test/);

console.log('Privacy-safe Sentry monitoring smoke test passed.');
