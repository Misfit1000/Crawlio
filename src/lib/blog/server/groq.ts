import type { BlogProviderErrorCode } from '../types';

if (typeof window !== 'undefined') throw new Error('Groq blog provider code is server-only.');

export const GROQ_DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';
export const GROQ_DEFAULT_STRUCTURED_MODEL = 'openai/gpt-oss-120b';
export const GROQ_DEFAULT_WRITER_MODEL = 'llama-3.3-70b-versatile';
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

type ProviderFetch = typeof fetch;
type ModelRole = 'structured' | 'writer';

export class GroqBlogProviderError extends Error {
  code: Extract<BlogProviderErrorCode, `GROQ_${string}`>;
  retryable: boolean;
  status: number | null;

  constructor(code: GroqBlogProviderError['code'], message: string, options: { retryable?: boolean; status?: number | null } = {}) {
    super(message);
    this.name = 'GroqBlogProviderError';
    this.code = code;
    this.retryable = Boolean(options.retryable);
    this.status = options.status ?? null;
  }
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.round(parsed))) : fallback;
}

export function getGroqBlogConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const enabled = String(env.GROQ_BLOG_ENABLED || 'false').toLowerCase() === 'true';
  const rawBaseUrl = String(env.GROQ_API_BASE_URL || GROQ_DEFAULT_BASE_URL).trim();
  let baseUrl = GROQ_DEFAULT_BASE_URL;
  try {
    const parsed = new URL(rawBaseUrl);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Invalid provider URL');
    parsed.search = '';
    parsed.hash = '';
    baseUrl = parsed.toString().replace(/\/$/, '');
  } catch {
    throw new GroqBlogProviderError('GROQ_NOT_CONFIGURED', 'The Groq API base URL is invalid.');
  }
  const safeModel = (value: unknown, fallback: string) => {
    const model = String(value || fallback).trim();
    return /^[a-z0-9._/-]+$/i.test(model) ? model : fallback;
  };
  return {
    provider: 'groq' as const,
    enabled,
    configured: Boolean(env.GROQ_API_KEY),
    apiKey: String(env.GROQ_API_KEY || ''),
    baseUrl,
    baseUrlHost: new URL(baseUrl).host,
    structuredModel: safeModel(env.GROQ_BLOG_STRUCTURED_MODEL, GROQ_DEFAULT_STRUCTURED_MODEL),
    writerModel: safeModel(env.GROQ_BLOG_WRITER_MODEL, GROQ_DEFAULT_WRITER_MODEL),
    maxConcurrency: boundedInteger(env.GROQ_BLOG_MAX_CONCURRENCY, 1, 1, 1),
    minimumRequestIntervalMs: boundedInteger(env.GROQ_BLOG_MIN_REQUEST_INTERVAL_MS, 2_000, 250, 30_000),
    maxRetries: boundedInteger(env.GROQ_BLOG_MAX_RETRIES, 2, 0, 2),
  };
}

export function getSafeGroqDiagnostics(env: NodeJS.ProcessEnv = process.env) {
  const config = getGroqBlogConfiguration(env);
  return {
    provider: 'groq' as const,
    enabled: config.enabled,
    configured: config.configured,
    baseUrlHost: config.baseUrlHost,
    structuredModel: config.structuredModel,
    writerModel: config.writerModel,
    automationEnabled: String(env.BLOG_AUTOMATION_ENABLED || 'false').toLowerCase() === 'true',
  };
}

function mapStatus(status: number) {
  if (status === 401) return new GroqBlogProviderError('GROQ_AUTH_FAILED', 'Groq authentication failed.', { status });
  if (status === 403) return new GroqBlogProviderError('GROQ_MODEL_PERMISSION_DENIED', 'The configured Groq model is not permitted.', { status });
  if (status === 404 || status === 400 || status === 422) return new GroqBlogProviderError('GROQ_MODEL_UNAVAILABLE', 'The configured Groq model is unavailable.', { status });
  if (status === 429) return new GroqBlogProviderError('GROQ_RATE_LIMITED', 'Groq temporarily rate limited the request.', { status, retryable: true });
  if (status >= 500) return new GroqBlogProviderError('GROQ_UNAVAILABLE', 'Groq is temporarily unavailable.', { status, retryable: true });
  return new GroqBlogProviderError('GROQ_INVALID_RESPONSE', 'Groq returned an unsupported response.', { status });
}

function wait(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new GroqBlogProviderError('GROQ_CANCELLED', 'The Groq request was cancelled.'));
    }, { once: true });
  });
}

function retryDelay(response: Response, attempt: number, minimum: number) {
  const value = response.headers.get('retry-after');
  const retryAfterMs = value && /^\d+$/.test(value) ? Number(value) * 1_000 : 0;
  return Math.min(15_000, Math.max(minimum, retryAfterMs, 500 * 2 ** attempt));
}

export async function generateGroqCompletion(input: {
  role: ModelRole;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  signal?: AbortSignal;
  fetchImpl?: ProviderFetch;
  maxAttempts?: number;
  timeoutMs?: number;
}) {
  if (typeof window !== 'undefined') throw new GroqBlogProviderError('GROQ_NOT_CONFIGURED', 'Groq is available only in trusted server code.');
  const config = getGroqBlogConfiguration();
  if (!config.enabled) throw new GroqBlogProviderError('GROQ_DISABLED', 'Groq blog generation is disabled.');
  if (!config.apiKey) throw new GroqBlogProviderError('GROQ_NOT_CONFIGURED', 'Groq blog generation is not configured.');
  const model = input.role === 'writer' ? config.writerModel : config.structuredModel;
  const attempts = Math.max(1, Math.min(config.maxRetries + 1, input.maxAttempts || config.maxRetries + 1));
  const startedAt = Date.now();
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    input.signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), boundedInteger(input.timeoutMs, 45_000, 2_000, 90_000));
    try {
      const response = await (input.fetchImpl || fetch)(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: input.system }, { role: 'user', content: input.user }],
          temperature: Math.max(0, Math.min(1, input.temperature ?? 0.25)),
          max_tokens: boundedInteger(input.maxTokens, 2_000, 32, 8_000),
          stream: false,
          ...(input.json === false ? {} : { response_format: { type: 'json_object' } }),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const mapped = mapStatus(response.status);
        if (mapped.retryable && RETRYABLE_STATUS.has(response.status) && attempt + 1 < attempts) {
          await wait(retryDelay(response, attempt, config.minimumRequestIntervalMs), input.signal);
          continue;
        }
        throw mapped;
      }
      const raw = await response.text();
      if (Buffer.byteLength(raw, 'utf8') > MAX_OUTPUT_BYTES) throw new GroqBlogProviderError('GROQ_OUTPUT_TOO_LARGE', 'Groq output exceeded the safe response limit.');
      let body: any;
      try { body = JSON.parse(raw); } catch { throw new GroqBlogProviderError('GROQ_INVALID_RESPONSE', 'Groq returned malformed JSON.'); }
      const content = body?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw new GroqBlogProviderError('GROQ_INVALID_RESPONSE', 'Groq returned an empty response.');
      return {
        content,
        model: String(body.model || model),
        durationMs: Date.now() - startedAt,
        rateLimit: {
          remainingRequests: response.headers.get('x-ratelimit-remaining-requests'),
          resetRequests: response.headers.get('x-ratelimit-reset-requests'),
        },
        usage: {
          inputTokens: Number.isFinite(Number(body?.usage?.prompt_tokens)) ? Number(body.usage.prompt_tokens) : null,
          outputTokens: Number.isFinite(Number(body?.usage?.completion_tokens)) ? Number(body.usage.completion_tokens) : null,
          totalTokens: Number.isFinite(Number(body?.usage?.total_tokens)) ? Number(body.usage.total_tokens) : null,
        },
      };
    } catch (error) {
      if (error instanceof GroqBlogProviderError) throw error;
      if (controller.signal.aborted) {
        if (input.signal?.aborted) throw new GroqBlogProviderError('GROQ_CANCELLED', 'The Groq request was cancelled.');
        if (attempt + 1 < attempts) continue;
        throw new GroqBlogProviderError('GROQ_TIMEOUT', 'The Groq request timed out.', { retryable: true });
      }
      if (attempt + 1 < attempts) { await wait(config.minimumRequestIntervalMs, input.signal); continue; }
      throw new GroqBlogProviderError('GROQ_UNAVAILABLE', 'Groq could not be reached.', { retryable: true });
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', abort);
    }
  }
  throw new GroqBlogProviderError('GROQ_UNAVAILABLE', 'Groq is temporarily unavailable.', { retryable: true });
}

export async function generateGroqStructured<T>(input: Omit<Parameters<typeof generateGroqCompletion>[0], 'json'> & { validate: (value: unknown) => value is T }) {
  const result = await generateGroqCompletion({ ...input, json: true });
  let parsed: unknown;
  try { parsed = JSON.parse(result.content); } catch { throw new GroqBlogProviderError('GROQ_SCHEMA_VALIDATION_FAILED', 'Groq output did not match the required schema.'); }
  if (!input.validate(parsed)) throw new GroqBlogProviderError('GROQ_SCHEMA_VALIDATION_FAILED', 'Groq output did not match the required schema.');
  return { ...result, data: parsed };
}

export async function testGroqProvider(fetchImpl?: ProviderFetch) {
  const config = getGroqBlogConfiguration();
  if (!config.enabled) return { status: 'disabled' as const, model: config.structuredModel, writerModel: config.writerModel, host: config.baseUrlHost, durationMs: null, errorCode: 'GROQ_DISABLED' as const };
  if (!config.apiKey) return { status: 'not configured' as const, model: config.structuredModel, writerModel: config.writerModel, host: config.baseUrlHost, durationMs: null, errorCode: 'GROQ_NOT_CONFIGURED' as const };
  try {
    const result = await generateGroqCompletion({ role: 'structured', system: 'Return JSON only.', user: 'Return {"ok":true}.', maxTokens: 32, temperature: 0, maxAttempts: 1, timeoutMs: 15_000, fetchImpl });
    return { status: 'connected' as const, model: result.model, writerModel: config.writerModel, host: config.baseUrlHost, durationMs: result.durationMs, errorCode: null };
  } catch (error) {
    const safe = error instanceof GroqBlogProviderError ? error : new GroqBlogProviderError('GROQ_UNAVAILABLE', 'Groq could not be reached.');
    const labels: Record<string, string> = {
      GROQ_AUTH_FAILED: 'authentication failed', GROQ_MODEL_PERMISSION_DENIED: 'model permission denied', GROQ_MODEL_UNAVAILABLE: 'model unavailable',
      GROQ_RATE_LIMITED: 'rate limited', GROQ_INVALID_RESPONSE: 'invalid response', GROQ_SCHEMA_VALIDATION_FAILED: 'invalid response',
      GROQ_DISABLED: 'disabled', GROQ_NOT_CONFIGURED: 'not configured',
    };
    return { status: labels[safe.code] || 'temporarily unavailable', model: config.structuredModel, writerModel: config.writerModel, host: config.baseUrlHost, durationMs: null, errorCode: safe.code };
  }
}
