import * as Sentry from '@sentry/react';
import type { BrowserSentry } from './sentry-browser';

export const sentryBrowserSdk = Sentry as unknown as BrowserSentry;
