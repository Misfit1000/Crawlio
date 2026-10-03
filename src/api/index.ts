import { Router, type RequestHandler } from 'express';
import { apiRouter as middlewareRouter } from './middleware-router';
import { publicVersionPayload } from '../lib/platform/version';

export type ApiRouteFamily = 'core' | 'blog' | 'admin' | 'projects' | 'search' | 'exports' | 'providers' | 'tools' | 'evidence';

export function apiRouteFamily(path: string): ApiRouteFamily {
  path = path.toLowerCase().replace(/\/+$/, '') || '/';
  if (/^\/(?:admin\/blog|blog)(?:\/|$)/.test(path)) return 'blog';
  if (/^\/admin(?:\/|$)/.test(path)) return 'admin';
  if (/^\/(?:projects|imports)(?:\/|$)/.test(path)) return 'projects';
  if (/^\/search-console(?:\/|$)/.test(path)) return 'search';
  if (/^\/audit\/export(?:-status)?\//.test(path) || path === '/me/export') return 'exports';
  if (/^\/domain(?:\/|$)/.test(path)) return 'providers';
  if (['/keyword/research', '/clusters', '/content-brief', '/competitor-gap'].includes(path)) return 'tools';
  if (/^\/audit\/[^/]+\/(?:evidence|tool-evidence|shares|badge)(?:\/|$)/.test(path) || path.startsWith('/score-badges/')) return 'evidence';
  return 'core';
}

const loaders = {
  core: () => import('./core-router'),
  blog: () => import('./blog-router'),
  admin: () => import('./admin-router'),
  projects: () => import('./projects-router'),
  search: () => import('./search-router'),
  exports: () => import('./exports-router'),
  providers: () => import('./providers-router'),
  tools: () => import('./tools-router'),
  evidence: () => import('./evidence-router'),
};
const pending = new Map<ApiRouteFamily, Promise<RequestHandler>>();

function loadRouter(family: ApiRouteFamily) {
  const existing = pending.get(family);
  if (existing) return existing;
  const promise = loaders[family]().then(module => module.apiRouter).catch(error => {
    pending.delete(family);
    throw error;
  });
  pending.set(family, promise);
  return promise;
}

export const apiRouter = Router();
apiRouter.use(['/admin', '/audit', '/audits', '/me', '/imports', '/projects', '/search-console', '/shared-reports'], (_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});
apiRouter.use(middlewareRouter);
apiRouter.get('/version', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.json({ success: true, data: publicVersionPayload() });
});
apiRouter.use((req, res, next) => {
  void loadRouter(apiRouteFamily(req.path)).then(router => router(req, res, next)).catch(next);
});
