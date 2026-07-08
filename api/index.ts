import express from 'express';

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

  const { apiRouter } = await import('../src/api/index');
  const app = express();

  app.use((req, _res, next) => {
    rewriteVercelPath(req);
    next();
  });
  app.use(express.json());
  app.use('/api/tools', apiRouter);
  app.use('/tools', apiRouter);
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: `API route not found: ${req.method} ${req.originalUrl || req.url}`,
    });
  });

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
