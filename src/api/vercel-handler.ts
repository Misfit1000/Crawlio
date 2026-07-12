import express from 'express';
import {
  apiErrorHandler,
  apiSecurityHeaders,
  createRateLimiter,
  jsonBodyParser,
  jsonParseErrorHandler,
} from '../lib/api/http-hardening';

let cachedApp: express.Express | null = null;

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
  app.use(apiSecurityHeaders);
  app.use(createRateLimiter({ namespace: 'vercel-api', windowMs: 60_000, maxRequests: 300 }));
  app.use((req, res, next) => {
    // Vercel may provide a parsed body before Express sees the request. Parsing
    // the already-consumed stream again throws "stream is not readable".
    if (req.body !== undefined) return next();
    return parseJsonBody(req, res, next);
  });
  app.use(jsonParseErrorHandler);
  app.use('/api/tools/audit/start', createRateLimiter({ namespace: 'audit-start', windowMs: 60_000, maxRequests: 20 }));
  app.use('/tools/audit/start', createRateLimiter({ namespace: 'audit-start-direct', windowMs: 60_000, maxRequests: 20 }));
  app.use('/api/tools', apiRouter);
  app.use('/tools', apiRouter);
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: `API route not found: ${req.method} ${req.originalUrl || req.url}`,
    });
  });
  app.use(apiErrorHandler);

  cachedApp = app;
  return cachedApp;
}

export default async function handler(req: any, res: any) {
  try {
    const app = await getApp();
    return app(req, res);
  } catch (error: any) {
    console.error('[api/index] function failed', {
      message: error?.message,
      stack: error?.stack,
      url: req?.url,
      method: req?.method,
    });

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: error?.message || 'API function failed',
      });
    }
  }
}
