import express, { type NextFunction, type Request, type Response } from 'express';
import { ApiError, requestIdFor, sendSafeApiError } from './errors';
import { CRAWLIO_GUEST_HEADER, LEGACY_GUEST_HEADER } from '../brand';

type RateLimitOptions = {
  namespace: string;
  windowMs: number;
  maxRequests: number;
  maxKeys?: number;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const stores = new Map<string, Map<string, RateLimitEntry>>();
const DEFAULT_RATE_LIMIT_MAX_KEYS = 10_000;

export function apiSecurityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cache-Control', 'private, no-store');
  next();
}

function configuredOrigins(req: Request) {
  const values = [
    process.env.APP_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '',
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '',
  ].filter(Boolean);
  if (process.env.NODE_ENV !== 'production') values.push(`${req.protocol}://${req.get('host')}`, 'http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:4173', 'http://127.0.0.1:4173');
  return new Set(values.map((value) => {
    try { return new URL(String(value)).origin; } catch { return ''; }
  }).filter(Boolean));
}

export function strictCorsAndOrigin(req: Request, res: Response, next: NextFunction) {
  const origin = String(req.headers.origin || '');
  const allowed = configuredOrigins(req);
  res.setHeader('Vary', 'Origin');
  if (origin && allowed.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', `Authorization, Content-Type, X-Request-Id, ${CRAWLIO_GUEST_HEADER}, ${LEGACY_GUEST_HEADER}`);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  }
  if (req.method === 'OPTIONS') {
    if (!origin || !allowed.has(origin)) return next(new ApiError('ORIGIN_NOT_ALLOWED', 'This request origin is not allowed.', 403));
    return res.status(204).end();
  }
  if (origin && !allowed.has(origin)) return next(new ApiError('ORIGIN_NOT_ALLOWED', 'This request origin is not allowed.', 403));
  next();
}

export function requireJsonContentType(req: Request, _res: Response, next: NextFunction) {
  const contentLength = Number(req.headers['content-length'] || 0);
  const hasBody = contentLength > 0 || Boolean(req.headers['transfer-encoding']);
  if (!['POST', 'PUT', 'PATCH'].includes(req.method) || !hasBody) return next();
  if (!req.is('application/json')) return next(new ApiError('UNSUPPORTED_CONTENT_TYPE', 'Requests with a body must use application/json.', 415));
  next();
}

export function jsonBodyParser() {
  return express.json({
    limit: process.env.API_JSON_BODY_LIMIT || '64kb',
    strict: true,
  });
}

export function jsonParseErrorHandler(error: any, _req: Request, res: Response, next: NextFunction) {
  if (error?.type === 'entity.too.large') {
    return next(new ApiError('REQUEST_BODY_TOO_LARGE', 'Request body is too large.', 413));
  }

  if (error instanceof SyntaxError && 'body' in error) {
    return next(new ApiError('INVALID_JSON', 'The request body is not valid JSON.', 400));
  }

  next(error);
}

export function apiErrorHandler(error: any, req: Request, res: Response, _next: NextFunction) {
  if (!res.headersSent) return sendSafeApiError(req, res, error);
}

function clientIp(req: Request) {
  const forwardedFor = req.headers['x-forwarded-for'];
  const forwardedValue = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  return req.ip || req.socket.remoteAddress || forwardedValue?.split(',')[0]?.trim() || 'unknown';
}

function storeFor(namespace: string) {
  let store = stores.get(namespace);
  if (!store) {
    store = new Map();
    stores.set(namespace, store);
  }
  return store;
}

function pruneStore(store: Map<string, RateLimitEntry>, now: number, maxKeys: number) {
  if (store.size <= maxKeys) {
    return;
  }

  for (const [key, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }

  while (store.size > maxKeys) {
    const oldestKey = store.keys().next().value;
    if (!oldestKey) {
      break;
    }
    store.delete(oldestKey);
  }
}

export function createRateLimiter(options: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const store = storeFor(options.namespace);
    pruneStore(store, now, options.maxKeys || DEFAULT_RATE_LIMIT_MAX_KEYS);
    const key = `${clientIp(req)}:${req.method}:${req.path}`;
    const current = store.get(key);

    if (!current || current.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    current.count += 1;
    if (current.count <= options.maxRequests) {
      return next();
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    return res.status(429).json({
      success: false,
      error: {
        code: 'EDGE_RATE_LIMITED',
        message: 'Too many requests. Please retry shortly.',
        requestId: requestIdFor(res),
        retryAfterSeconds,
      },
    });
  };
}
