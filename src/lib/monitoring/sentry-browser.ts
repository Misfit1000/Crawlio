import {
  isExpectedMonitoringError,
  redactSensitiveString,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  scrubSentrySpan,
  scrubUnknown,
} from './sentry-privacy';

type BrowserEnvironment = Record<string, string | boolean | undefined>;
export type BrowserSentry = {
  init(options: Record<string, unknown>): unknown;
  captureException(error: unknown, hint?: Record<string, unknown>): unknown;
  addBreadcrumb(breadcrumb: Record<string, unknown>): unknown;
  browserTracingIntegration?(): unknown;
};

type PendingOperation =
  | { type: 'capture'; error: unknown; hint: Record<string, unknown> }
  | { type: 'breadcrumb'; breadcrumb: Record<string, unknown> };

const MAX_PENDING_OPERATIONS = 20;
const pendingOperations: PendingOperation[] = [];
let browserMonitoringConfigured = false;
let browserMonitoringEnabled = false;
let browserSdk: BrowserSentry | null = null;
let browserEnvironment: BrowserEnvironment = import.meta.env;
let loadingPromise: Promise<boolean> | null = null;
let removeBootstrapListeners: (() => void) | null = null;

function queue(operation: PendingOperation) {
  pendingOperations.push(operation);
  if (pendingOperations.length > MAX_PENDING_OPERATIONS) pendingOperations.splice(0, pendingOperations.length - MAX_PENDING_OPERATIONS);
}

function safeQueuedError(error: unknown) {
  const source = error instanceof Error ? error : new Error(String(error || 'Unknown browser error'));
  const safe = new Error(redactSensitiveString(source.message || source.name || 'Browser error'));
  safe.name = String(source.name || 'Error').slice(0, 80);
  if (source.stack) safe.stack = redactSensitiveString(source.stack);
  return safe;
}

function flushPendingOperations() {
  if (!browserSdk || !browserMonitoringEnabled) return;
  for (const operation of pendingOperations.splice(0)) {
    if (operation.type === 'capture') browserSdk.captureException(operation.error, operation.hint);
    else browserSdk.addBreadcrumb(operation.breadcrumb);
  }
}

function installBootstrapListeners() {
  if (typeof window === 'undefined' || removeBootstrapListeners) return;
  const onError = (event: ErrorEvent) => {
    queue({ type: 'capture', error: safeQueuedError(event.error || event.message), hint: { tags: { operation: 'window-error' } } });
    void loadBrowserMonitoring();
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const error = safeQueuedError(event.reason);
    if (isExpectedMonitoringError(error)) return;
    queue({ type: 'capture', error, hint: { tags: { operation: 'unhandled-rejection' } } });
    void loadBrowserMonitoring();
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);
  removeBootstrapListeners = () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
    removeBootstrapListeners = null;
  };
}

export function browserTracingSampleRate(environment: string) {
  if (environment === 'production') return 0.05;
  if (environment === 'preview') return 0.02;
  return 0;
}

export function buildBrowserSentryOptions(env: BrowserEnvironment = import.meta.env, sdk?: BrowserSentry) {
  const dsn = String(env.VITE_SENTRY_DSN || '').trim();
  const environment = String(env.SENTRY_ENVIRONMENT || (typeof __CRAWLIO_ENVIRONMENT__ !== 'undefined' ? __CRAWLIO_ENVIRONMENT__ : '') || env.MODE || 'development');
  const release = String(env.SENTRY_RELEASE || (typeof __CRAWLIO_RELEASE__ !== 'undefined' ? __CRAWLIO_RELEASE__ : '') || 'local');
  const developmentEnabled = env.VITE_SENTRY_ENABLE_DEVELOPMENT === true || env.VITE_SENTRY_ENABLE_DEVELOPMENT === 'true';
  const enabled = Boolean(dsn && environment !== 'test' && (environment !== 'development' || developmentEnabled));
  const tracing = sdk?.browserTracingIntegration?.();
  return {
    enabled,
    options: {
      dsn,
      enabled,
      environment,
      release,
      sendDefaultPii: false,
      sampleRate: 1,
      tracesSampleRate: browserTracingSampleRate(environment),
      integrations: tracing ? [tracing] : [],
      initialScope: { tags: { runtime: 'browser', service: 'crawlio-web' } },
      beforeSend(event: Record<string, unknown>, hint: Record<string, unknown>) {
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        if (isExpectedMonitoringError(hint?.originalException, offline)) return null;
        return scrubSentryEvent(event, hint);
      },
      beforeBreadcrumb(breadcrumb: Record<string, unknown>) { return scrubSentryBreadcrumb(breadcrumb); },
      beforeSendTransaction(event: Record<string, unknown>) { return scrubSentryEvent(event); },
      beforeSendSpan(span: Record<string, unknown>) { return scrubSentrySpan(span); },
    },
  };
}

async function loadBrowserMonitoring() {
  if (!browserMonitoringConfigured) return false;
  if (browserMonitoringEnabled) return true;
  if (loadingPromise) return loadingPromise;
  loadingPromise = import('./sentry-browser-runtime')
    .then(({ sentryBrowserSdk }) => {
      const configuration = buildBrowserSentryOptions(browserEnvironment, sentryBrowserSdk);
      if (!configuration.enabled) return false;
      sentryBrowserSdk.init(configuration.options);
      browserSdk = sentryBrowserSdk;
      browserMonitoringEnabled = true;
      removeBootstrapListeners?.();
      flushPendingOperations();
      return true;
    })
    .catch(() => false)
    .finally(() => { loadingPromise = null; });
  return loadingPromise;
}

export function initializeBrowserMonitoring(env: BrowserEnvironment = import.meta.env, sdk?: BrowserSentry) {
  browserEnvironment = env;
  const configuration = buildBrowserSentryOptions(env, sdk);
  browserMonitoringConfigured = configuration.enabled;
  if (!configuration.enabled) {
    browserMonitoringEnabled = false;
    return false;
  }
  if (sdk) {
    sdk.init(configuration.options);
    browserSdk = sdk;
    browserMonitoringEnabled = true;
    flushPendingOperations();
    return true;
  }
  installBootstrapListeners();
  if (typeof window !== 'undefined') activateBrowserMonitoringForPath(window.location.pathname);
  return true;
}

export function activateBrowserMonitoringForPath(pathname: string) {
  if (/^\/(?:app|admin|audit|share)(?:\/|$)/.test(pathname)) void loadBrowserMonitoring();
}

export function captureBrowserException(error: unknown, context: Record<string, unknown> = {}, sdk?: BrowserSentry) {
  if (!browserMonitoringConfigured || isExpectedMonitoringError(error)) return false;
  const hint = { tags: { operation: String(context.operation || 'browser-unexpected-failure') }, extra: scrubUnknown(context) as Record<string, unknown> };
  const activeSdk = sdk || browserSdk;
  if (activeSdk && browserMonitoringEnabled) activeSdk.captureException(error, hint);
  else {
    queue({ type: 'capture', error: safeQueuedError(error), hint });
    void loadBrowserMonitoring();
  }
  return true;
}

export function captureReactRenderError(error: unknown, componentStack = '', sdk?: BrowserSentry) {
  if (!browserMonitoringConfigured || isExpectedMonitoringError(error)) return false;
  const hint = { mechanism: { handled: true, type: 'react.error_boundary' }, extra: { componentStack: redactSensitiveString(componentStack).slice(0, 4_000) } };
  const activeSdk = sdk || browserSdk;
  if (activeSdk && browserMonitoringEnabled) activeSdk.captureException(error, hint);
  else {
    queue({ type: 'capture', error: safeQueuedError(error), hint });
    void loadBrowserMonitoring();
  }
  return true;
}

export function addSafeBrowserBreadcrumb(message: string, data: Record<string, unknown> = {}, sdk?: BrowserSentry) {
  if (!browserMonitoringConfigured) return false;
  const breadcrumb = { category: 'crawlio.workflow', level: 'info', message: redactSensitiveString(message).slice(0, 160), data: scrubUnknown(data) as Record<string, unknown> };
  const activeSdk = sdk || browserSdk;
  if (activeSdk && browserMonitoringEnabled) activeSdk.addBreadcrumb(breadcrumb);
  else queue({ type: 'breadcrumb', breadcrumb });
  return true;
}

export function isBrowserMonitoringEnabled() { return browserMonitoringEnabled; }

export function resetBrowserMonitoringForTests() {
  removeBootstrapListeners?.();
  pendingOperations.splice(0);
  browserMonitoringConfigured = false;
  browserMonitoringEnabled = false;
  browserSdk = null;
  loadingPromise = null;
}
