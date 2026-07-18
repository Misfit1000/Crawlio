import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getSupabaseAdminClient } from '../supabase/server';
import { getCommitIdentifier } from '../platform/version';
import { captureApiException } from '../monitoring/sentry-node';

export type SafeApiErrorShape = {
  code: string;
  message: string;
  requestId: string;
  retryAfterSeconds?: number;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds?: number;
  readonly expose: boolean;

  constructor(code: string, message: string, status = 400, options: { retryAfterSeconds?: number; expose?: boolean } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.expose = options.expose ?? true;
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = String(req.headers['x-request-id'] || '');
  const requestId = /^[a-zA-Z0-9_-]{8,80}$/.test(incoming) ? incoming : randomUUID();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}

export function requestIdFor(res: Response) {
  return String(res.locals.requestId || randomUUID());
}

export function safeApiError(error: unknown, requestId: string): { status: number; body: { success: false; error: SafeApiErrorShape } } {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      body: {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          requestId,
          ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      success: false,
      error: {
        code: 'INTERNAL_REQUEST_FAILURE',
        message: 'The request could not be completed. Please try again.',
        requestId,
      },
    },
  };
}

function redactInternalDetails(value: unknown) {
  const text = value instanceof Error ? `${value.name}: ${value.message}\n${value.stack || ''}` : String(value || 'Unknown error');
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
    .replace(/(service[_-]?role|api[_-]?key|password|authorization)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .slice(0, 12_000);
}

export async function recordApiError(req: Request, requestId: string, error: unknown, internalCode = 'UNEXPECTED_API_ERROR') {
  const client = getSupabaseAdminClient();
  if (!client) return;
  try {
    await client.from('api_error_logs').insert({
      request_id: requestId,
      route: String(req.route?.path || req.path || '').slice(0, 300),
      method: req.method,
      user_id: resUserId(req),
      internal_code: internalCode,
      internal_details: redactInternalDetails(error),
      deployment_version: getCommitIdentifier(),
    });
  } catch {
    // Error logging must never replace or recursively fail the customer response.
  }
}

function resUserId(req: Request) {
  const value = (req as Request & { requesterUserId?: string | null }).requesterUserId;
  return value || null;
}

export function sendSafeApiError(req: Request, res: Response, error: unknown) {
  const requestId = requestIdFor(res);
  const mapped = safeApiError(error, requestId);
  if (error instanceof ApiError && error.retryAfterSeconds) {
    res.setHeader('Retry-After', String(error.retryAfterSeconds));
  }
  if (!(error instanceof ApiError) || !error.expose) {
    void recordApiError(req, requestId, error);
    captureApiException(error, {
      status: mapped.status,
      expected: mapped.status < 500,
      apiRoute: String(req.route?.path || req.path || ''),
      httpMethod: req.method,
      operation: 'api-request',
      requestId,
    });
  }
  return res.status(mapped.status).json(mapped.body);
}
