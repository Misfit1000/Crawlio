import * as Sentry from '@sentry/react';
import {
  isExpectedMonitoringError,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  scrubSentrySpan,
  scrubUnknown,
} from './sentry-privacy';

type BrowserEnvironment = Record<string, string | boolean | undefined>;
type BrowserSentry = {
  init(options: Record<string, unknown>): unknown;
  captureException(error: unknown, hint?: Record<string, unknown>): unknown;
  addBreadcrumb(breadcrumb: Record<string, unknown>): unknown;
};

let browserMonitoringEnabled = false;

export function browserTracingSampleRate(environment: string) {
  if (environment === 'production') return 0.05;
  if (environment === 'preview') return 0.02;
  return 0;
}

export function buildBrowserSentryOptions(env: BrowserEnvironment = import.meta.env) {
  const dsn = String(env.VITE_SENTRY_DSN || '').trim();
  const environment = String(
    env.SENTRY_ENVIRONMENT
    || (typeof __CRAWLIO_ENVIRONMENT__ !== 'undefined' ? __CRAWLIO_ENVIRONMENT__ : '')
    || env.MODE
    || 'development',
  );
  const release = String(
    env.SENTRY_RELEASE
    || (typeof __CRAWLIO_RELEASE__ !== 'undefined' ? __CRAWLIO_RELEASE__ : '')
    || 'local',
  );
  const developmentEnabled = env.VITE_SENTRY_ENABLE_DEVELOPMENT === true
    || env.VITE_SENTRY_ENABLE_DEVELOPMENT === 'true';
  const enabled = Boolean(
    dsn
    && environment !== 'test'
    && (environment !== 'development' || developmentEnabled),
  );

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
      integrations: [Sentry.browserTracingIntegration()],
      initialScope: {
        tags: {
          runtime: 'browser',
          service: 'crawlio-web',
        },
      },
      beforeSend(event: Record<string, unknown>, hint: Record<string, unknown>) {
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        if (isExpectedMonitoringError(hint?.originalException, offline)) return null;
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

export function initializeBrowserMonitoring(
  env: BrowserEnvironment = import.meta.env,
  sdk: BrowserSentry = Sentry as unknown as BrowserSentry,
) {
  const configuration = buildBrowserSentryOptions(env);
  if (!configuration.enabled) {
    browserMonitoringEnabled = false;
    return false;
  }
  sdk.init(configuration.options);
  browserMonitoringEnabled = true;
  return true;
}

export function captureBrowserException(
  error: unknown,
  context: Record<string, unknown> = {},
  sdk: BrowserSentry = Sentry as unknown as BrowserSentry,
) {
  if (!browserMonitoringEnabled || isExpectedMonitoringError(error)) return false;
  sdk.captureException(error, {
    tags: { operation: String(context.operation || 'browser-unexpected-failure') },
    extra: scrubUnknown(context) as Record<string, unknown>,
  });
  return true;
}

export function captureReactRenderError(
  error: unknown,
  componentStack = '',
  sdk: BrowserSentry = Sentry as unknown as BrowserSentry,
) {
  if (!browserMonitoringEnabled || isExpectedMonitoringError(error)) return false;
  sdk.captureException(error, {
    mechanism: { handled: true, type: 'react.error_boundary' },
    extra: { componentStack: componentStack.slice(0, 4_000) },
  });
  return true;
}

export function addSafeBrowserBreadcrumb(
  message: string,
  data: Record<string, unknown> = {},
  sdk: BrowserSentry = Sentry as unknown as BrowserSentry,
) {
  if (!browserMonitoringEnabled) return false;
  sdk.addBreadcrumb({
    category: 'crawlio.workflow',
    level: 'info',
    message: message.slice(0, 160),
    data: scrubUnknown(data) as Record<string, unknown>,
  });
  return true;
}

export function isBrowserMonitoringEnabled() {
  return browserMonitoringEnabled;
}
