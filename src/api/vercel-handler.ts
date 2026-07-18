import express from 'express';
import {
  flushNodeMonitoring,
  initializeApiMonitoring,
} from '../lib/monitoring/sentry-node';
import {
  apiErrorHandler,
  apiSecurityHeaders,
  createRateLimiter,
  jsonBodyParser,
  jsonParseErrorHandler,
  requireJsonContentType,
  strictCorsAndOrigin,
} from '../lib/api/http-hardening';
import { ApiError, requestIdMiddleware, sendSafeApiError } from '../lib/api/errors';
import { publicVersionPayload } from '../lib/platform/version';

let cachedApp: express.Express | null = null;

initializeApiMonitoring();

function rewriteVercelPath(req: any) {
  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const path = requestUrl.searchParams.get('path');
  if (!path) return;

  requestUrl.searchParams.delete('path');
  const query = requestUrl.searchParams.toString();
  req.url = `/api/${path}${query ? `?${query}` : ''}`;
}

async function getApp() {
  if (cachedApp) return cachedApp;

  const { apiRouter } = await import('./index');
  const app = express();
  const parseJsonBody = jsonBodyParser();

  app.set('trust proxy', 1);
  app.use((req, _res, next) => {
    rewriteVercelPath(req);
    next();
  });
  app.use(requestIdMiddleware);
  app.use(apiSecurityHeaders);
  app.use(strictCorsAndOrigin);
  app.use(createRateLimiter({ namespace: 'vercel-api', windowMs: 60_000, maxRequests: 300 }));
  app.use((req, res, next) => {
    // Vercel may provide a parsed body before Express sees the request. Parsing
    // the already-consumed stream again throws "stream is not readable".
    if (req.body !== undefined) return next();
    return parseJsonBody(req, res, next);
  });
  app.use(jsonParseErrorHandler);
  app.use(requireJsonContentType);
  app.get(['/api/version', '/version'], (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json(publicVersionPayload());
  });
  app.use('/api/tools/audit/start', createRateLimiter({ namespace: 'audit-start', windowMs: 60_000, maxRequests: 20 }));
  app.use('/tools/audit/start', createRateLimiter({ namespace: 'audit-start-direct', windowMs: 60_000, maxRequests: 20 }));
  app.use('/api/tools', apiRouter);
  app.use('/tools', apiRouter);
  app.use((_req, _res, next) => next(new ApiError('API_ROUTE_NOT_FOUND', 'The requested API route was not found.', 404)));
  app.use(apiErrorHandler);

  cachedApp = app;
  return cachedApp;
}

export default async function handler(req: any, res: any) {
  try {
    const app = await getApp();
    await new Promise<void>((resolve, reject) => {
      const finish = () => resolve();
      res.once('finish', finish);
      res.once('close', finish);
      try {
        app(req, res);
      } catch (error) {
        reject(error);
      }
    });
  } catch (error: any) {
    if (!res.headersSent) {
      sendSafeApiError(req, res, error);
    }
  } finally {
    await flushNodeMonitoring(1_200);
  }
}
