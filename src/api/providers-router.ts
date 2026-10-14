import { Router } from 'express';

import { normalizeUserUrl } from '../lib/seo/url-utils';

import { ApiError } from '../lib/api/errors';
import { createRateLimiter } from '../lib/api/http-hardening';


export const apiRouter = Router();


function asyncJsonRoute(handler: any) {
  return async (req: any, res: any, next: any) => {
    try {
      await handler(req, res, next);
    } catch (error: unknown) {
      next(error);
    }
  };
}

apiRouter.use('/domain/link-signals', createRateLimiter({ namespace: 'domain-link-evidence', windowMs: 3600000, maxRequests: 60 }));
apiRouter.get('/domain/link-signals', asyncJsonRoute(async (req, res) => {
  const rawDomain = typeof req.query?.domain === 'string' ? req.query.domain.trim() : '';
  if (!rawDomain || rawDomain.length > 253) throw new ApiError('INVALID_DOMAIN', 'Enter a valid public domain.', 400);
  const normalized = normalizeUserUrl(rawDomain);
  if (!normalized.isValid) throw new ApiError('INVALID_DOMAIN', normalized.error || 'Enter a valid public domain.', 400);
  const domain = normalized.hostname.replace(/^www\./, '');
  if (!/[a-z]/i.test(domain) || domain.includes(':')) throw new ApiError('INVALID_DOMAIN', 'Enter a valid public domain.', 400);

  try {
    const { getPublicLinkSignals } = await import('../lib/backlinks/public-link-signals');
    const signals = await getPublicLinkSignals(domain);
    // Only the provider cache may serve stale evidence, after a refresh error.
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ success: true, data: signals });
  } catch {
    throw new ApiError('PUBLIC_LINK_SIGNALS_UNAVAILABLE', 'External domain evidence is temporarily unavailable. Please try again later.', 503);
  }
}));
