import { Router } from 'express';

import { normalizeUserUrl } from '../lib/seo/url-utils';

import { ApiError } from '../lib/api/errors';


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

apiRouter.get('/domain/link-signals', asyncJsonRoute(async (req, res) => {
  const rawDomain = String(req.query?.domain || '').trim();
  if (!rawDomain || rawDomain.length > 253) throw new ApiError('INVALID_DOMAIN', 'Enter a valid public domain.', 400);
  const normalized = normalizeUserUrl(rawDomain);
  if (!normalized.isValid) throw new ApiError('INVALID_DOMAIN', normalized.error || 'Enter a valid public domain.', 400);
  const domain = normalized.hostname.replace(/^www\./, '');

  try {
    const { getPublicLinkSignals } = await import('../lib/backlinks/public-link-signals');
    const signals = await getPublicLinkSignals(domain);
    res.setHeader('Cache-Control', signals.partial
      ? 'public, max-age=60, s-maxage=900, stale-while-revalidate=3600'
      : 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
    return res.json({ success: true, data: signals });
  } catch {
    throw new ApiError('PUBLIC_LINK_SIGNALS_UNAVAILABLE', 'External domain evidence is temporarily unavailable. Please try again later.', 503);
  }
}));
