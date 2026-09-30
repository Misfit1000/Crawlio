import { addBreadcrumb, browserTracingIntegration, captureException, init } from '@sentry/react';
import type { BrowserSentry } from './sentry-browser';

export const sentryBrowserSdk = {
  init,
  captureException,
  addBreadcrumb,
  browserTracingIntegration,
} as unknown as BrowserSentry;
