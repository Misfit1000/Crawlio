import { Router } from 'express';

import { ensureUserProfileFromAuthUser, getAuthenticatedUserFromRequest } from '../lib/billing/entitlements';

import { ApiError } from '../lib/api/errors';

import { completeSearchConsoleAuthorization, createSearchConsoleAuthorization, disconnectSearchConsole, getSearchConsoleRows, searchConsoleStatus, syncSearchConsoleProperty } from '../lib/search-console/server';


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

function firstHeaderValue(value: unknown) {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function requestOrigin(req: any) {
  const configured = [
    process.env.APP_URL || '',
    process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '',
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '',
  ];
  for (const value of configured) {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:') return url.origin;
    } catch {}
  }
  if (process.env.NODE_ENV === 'production') return '';
  const proto = firstHeaderValue(req.headers?.['x-forwarded-proto']) || 'http';
  const host = firstHeaderValue(req.headers?.['x-forwarded-host']) || firstHeaderValue(req.headers?.host);
  try {
    const url = new URL(`${proto}://${host}`);
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname) ? url.origin : '';
  } catch {
    return '';
  }
}

async function getRequester(req: any) {
  const authUser = await getAuthenticatedUserFromRequest(req);
  if (!authUser) return { userId: null, profile: null };
  req.requesterUserId = authUser.id;
  const profile = await ensureUserProfileFromAuthUser(authUser);
  return { userId: authUser.id, profile };
}

apiRouter.get('/search-console/status', asyncJsonRoute(async (req, res) => {
  const requester = await getRequester(req);
  if (!requester.userId) throw new ApiError('AUTHENTICATION_REQUIRED', 'Authentication required.', 401);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: await searchConsoleStatus(requester.userId) });
}));

apiRouter.post('/search-console/connect', asyncJsonRoute(async (req, res) => {
  const requester = await getRequester(req);
  if (!requester.userId) throw new ApiError('AUTHENTICATION_REQUIRED', 'Authentication required.', 401);
  const origin = requestOrigin(req);
  if (!origin) throw new ApiError('APPLICATION_ORIGIN_UNAVAILABLE', 'The application URL is not configured.', 503);
  try {
    const authorizationUrl = await createSearchConsoleAuthorization(requester.userId, `${origin}/api/tools/search-console/callback`);
    res.json({ success: true, data: { authorizationUrl } });
  } catch (error) {
    if (error instanceof Error && /not configured/i.test(error.message)) throw new ApiError('SEARCH_CONSOLE_NOT_CONFIGURED', error.message, 503);
    throw error;
  }
}));

apiRouter.get('/search-console/callback', asyncJsonRoute(async (req, res) => {
  const origin = requestOrigin(req);
  if (!origin) throw new ApiError('APPLICATION_ORIGIN_UNAVAILABLE', 'The application URL is not configured.', 503);
  const state = String(req.query.state || '');
  const code = String(req.query.code || '');
  if (!state || !code) return res.redirect(302, `${origin}/app/search-data?gsc=cancelled`);
  try {
    const result = await completeSearchConsoleAuthorization({ state, code, redirectUri: `${origin}/api/tools/search-console/callback` });
    res.redirect(302, `${origin}${result.redirectPath}?gsc=connected&properties=${result.propertyCount}`);
  } catch {
    res.redirect(302, `${origin}/app/search-data?gsc=error`);
  }
}));

apiRouter.post('/search-console/sync/:propertyId', asyncJsonRoute(async (req, res) => {
  const requester = await getRequester(req);
  if (!requester.userId) throw new ApiError('AUTHENTICATION_REQUIRED', 'Authentication required.', 401);
  try {
    res.json({ success: true, data: await syncSearchConsoleProperty(requester.userId, String(req.params.propertyId)) });
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) throw new ApiError('SEARCH_CONSOLE_PROPERTY_NOT_FOUND', error.message, 404);
    throw new ApiError('SEARCH_CONSOLE_SYNC_FAILED', error instanceof Error ? error.message : 'Search Console sync failed.', 502);
  }
}));

apiRouter.get('/search-console/data/:propertyId', asyncJsonRoute(async (req, res) => {
  const requester = await getRequester(req);
  if (!requester.userId) throw new ApiError('AUTHENTICATION_REQUIRED', 'Authentication required.', 401);
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ success: true, data: await getSearchConsoleRows(requester.userId, String(req.params.propertyId)) });
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) throw new ApiError('SEARCH_CONSOLE_PROPERTY_NOT_FOUND', error.message, 404);
    throw error;
  }
}));

apiRouter.delete('/search-console/connection', asyncJsonRoute(async (req, res) => {
  const requester = await getRequester(req);
  if (!requester.userId) throw new ApiError('AUTHENTICATION_REQUIRED', 'Authentication required.', 401);
  await disconnectSearchConsole(requester.userId);
  res.json({ success: true, data: { disconnected: true } });
}));
