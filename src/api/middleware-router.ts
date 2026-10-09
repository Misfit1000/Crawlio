import { Router } from 'express';

import { createRateLimiter } from '../lib/api/http-hardening';

import { durableRateLimit } from '../lib/api/production-controls';


export const apiRouter = Router();


apiRouter.use('/admin', durableRateLimit({ namespace: 'admin-api', limit: 120, windowSeconds: 60 }));

apiRouter.use('/admin/diagnostics/sentry-test', durableRateLimit({ namespace: 'sentry-test', limit: 3, windowSeconds: 3600 }));

apiRouter.use('/admin/blog/jobs', durableRateLimit({ namespace: 'blog-jobs', limit: 20, windowSeconds: 3600 }));

apiRouter.use('/admin/blog/batches', durableRateLimit({ namespace: 'blog-batches', limit: 5, windowSeconds: 3600 }));

apiRouter.use('/admin/blog/images/import', durableRateLimit({ namespace: 'blog-images', limit: 10, windowSeconds: 3600 }));

apiRouter.use('/admin/blog/provider/test', durableRateLimit({ namespace: 'blog-provider-test', limit: 5, windowSeconds: 3600 }));

apiRouter.use('/admin/blog/sources', durableRateLimit({ namespace: 'blog-sources', limit: 40, windowSeconds: 3600 }));

apiRouter.use('/admin/blog/source/inspect', durableRateLimit({ namespace: 'blog-source-inspect', limit: 30, windowSeconds: 3600 }));

apiRouter.use('/admin/blog/preflight', durableRateLimit({ namespace: 'blog-preflight', limit: 120, windowSeconds: 3600 }));

apiRouter.use('/admin/blog/editor-draft', durableRateLimit({ namespace: 'blog-editor-draft', limit: 180, windowSeconds: 3600 }));

apiRouter.use('/admin/blog/operations/action', durableRateLimit({ namespace: 'blog-operations', limit: 20, windowSeconds: 3600 }));

apiRouter.use('/admin/blog/sections', durableRateLimit({ namespace: 'blog-section-regeneration', limit: 10, windowSeconds: 3600 }));

apiRouter.use('/blog/scheduler', durableRateLimit({ namespace: 'blog-scheduler', limit: 10, windowSeconds: 300 }));

apiRouter.use('/audit/export', durableRateLimit({ namespace: 'report-export', limit: 10, windowSeconds: 300 }));

apiRouter.use('/audit/cancel', durableRateLimit({ namespace: 'audit-cancel', limit: 10, windowSeconds: 300 }));

apiRouter.use('/domain/link-signals', createRateLimiter({ namespace: 'public-link-signals', windowMs: 60 * 60 * 1000, maxRequests: 20 }));

apiRouter.use('/plans/public', createRateLimiter({ namespace: 'public-plans', windowMs: 60 * 60 * 1000, maxRequests: 120 }));

apiRouter.use('/projects', durableRateLimit({ namespace: 'projects', limit: 90, windowSeconds: 60 }));

apiRouter.use('/search-console', durableRateLimit({ namespace: 'search-console', limit: 30, windowSeconds: 300 }));

apiRouter.use('/imports', durableRateLimit({ namespace: 'project-imports', limit: 30, windowSeconds: 300 }));

apiRouter.use(['/projects', '/search-console'], (_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});

apiRouter.use('/audit/:id/tool-evidence', durableRateLimit({ namespace: 'audit-tool-evidence', limit: 60, windowSeconds: 300 }));
