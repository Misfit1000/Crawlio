import { ApiError } from '../api/errors';
import { validControlBearer } from '../audit/worker-wake';
import { safePublicFetch, type SafePublicResponse } from '../security/safe-public-fetch';
import { fetchRobotsEvidence, isBlockedByRobots } from '../seo/robots';
import { requireSupabaseAdminClient } from '../supabase/server';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';

const TYPES = ['document', 'stylesheet', 'script', 'image', 'font', 'xhr', 'fetch', 'manifest', 'other'];
const MEDIA_TYPES = ['text/', 'application/javascript', 'application/x-javascript', 'application/json', 'application/ld+json',
  'application/xhtml+xml', 'application/xml', 'application/wasm', 'application/font', 'application/vnd.ms-fontobject', 'image/', 'font/'];

export interface PreviewProxyResult {
  url: string; status: number; headers: Record<string, string>; bodyBase64: string; error?: string;
}

export function previewResponse(response: SafePublicResponse, requestedUrl: string): PreviewProxyResult {
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.location;
    if (!location) throw new Error('INVALID_REDIRECT');
    return { url: requestedUrl, status: response.status, headers: { location: new URL(location, requestedUrl).href }, bodyBase64: '' };
  }
  if (response.finalUrl !== requestedUrl) return { url: requestedUrl, status: 302, headers: { location: response.finalUrl }, bodyBase64: '' };
  const type = response.contentType.split(';')[0].toLowerCase();
  if (!MEDIA_TYPES.some(allowed => type.startsWith(allowed))) throw new Error('UNSUPPORTED_RESOURCE');
  const headers: Record<string, string> = { 'content-type': response.contentType, 'cache-control': 'no-store' };
  // The fetcher requests identity encoding. Bound decompression as well for
  // origins that ignore it; never forward credentials or compressed lengths.
  let bytes = response.bodyBuffer || Buffer.from(response.body);
  const encoding = response.headers['content-encoding']?.toLowerCase();
  if (encoding === 'gzip') bytes = gunzipSync(bytes, { maxOutputLength: 512000 });
  else if (encoding === 'br') bytes = brotliDecompressSync(bytes, { maxOutputLength: 512000 });
  else if (encoding === 'deflate') bytes = inflateSync(bytes, { maxOutputLength: 512000 });
  else if (encoding && encoding !== 'identity') throw new Error('UNSUPPORTED_ENCODING');
  for (const name of ['access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers', 'content-language']) {
    const value = response.headers[name];
    if (value && !/[\r\n]/.test(value)) headers[name] = value.slice(0, 1024);
  }
  return { url: requestedUrl, status: Math.max(200, Math.min(599, response.status)), headers,
    bodyBase64: bytes.toString('base64') };
}

export async function proxyPreviewResources(header: string | undefined, body: unknown,
  fetcher: typeof safePublicFetch = safePublicFetch,
  leaseReader = async (id: string, generation: number) => {
    const { data, error } = await requireSupabaseAdminClient().from('site_preview_captures')
      .select('id,target_url').eq('id', id).eq('generation', generation).eq('status', 'running')
      .gt('lease_until', new Date().toISOString()).maybeSingle();
    return error ? null : data;
  }): Promise<{ results: PreviewProxyResult[] }> {
  if (!validControlBearer(header, process.env.PREVIEW_CONTROL_SECRET)) throw new ApiError('UNAUTHORIZED', 'Not authorized.', 401);
  const input = body as { captureId?: string; generation?: number; viewport?: 'desktop' | 'mobile'; requests?: Array<{ url: string; resourceType: string; viewport?: 'desktop' | 'mobile' }> };
  if (!input || !/^[0-9a-f-]{36}$/i.test(String(input.captureId)) || !Number.isInteger(input.generation)
    || !Array.isArray(input.requests) || !input.requests.length || input.requests.length > 4
    || input.requests.some(item => !item || typeof item.url !== 'string' || item.url.length > 8192 || !TYPES.includes(item.resourceType))) {
    throw new ApiError('INVALID_PREVIEW_REQUEST', 'Invalid capture resource request.', 400);
  }
  const data = await leaseReader(input.captureId!, input.generation!);
  if (!data) throw new ApiError('PREVIEW_LEASE_EXPIRED', 'The capture is no longer active.', 409);
  const userAgent = (viewport?: string) => viewport === 'mobile'
    ? 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 Crawlio/1.0'
    : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Crawlio/1.0';
  const results: PreviewProxyResult[] = [];
  for (let offset=0; offset<input.requests.length; offset+=2) {
    results.push(...await Promise.all(input.requests.slice(offset,offset+2).map(async item => {
      try {
        const url = new URL(item.url);
        if (url.username || url.password || !['https:', 'http:'].includes(url.protocol)) throw new Error('UNSAFE_RESOURCE');
        if (item.resourceType === 'document') {
          const robots = await fetchRobotsEvidence(url.origin, { timeoutMs: 2_000, maxBytes: 128_000 });
          if (robots.policy === 'disallow-all' || robots.state === 'unavailable'
            || (robots.document && isBlockedByRobots(url.href, robots.document))) throw new Error('ROBOTS_BLOCKED');
        }
        const response = await fetcher(url.href, { timeoutMs: 4_000, dnsTimeoutMs: 1_500, maxBytes: 512_000,
          maxRedirects: 3, followRedirects: false, returnBuffer: true, userAgent: userAgent(item.viewport || input.viewport) });
        return previewResponse(response, url.href);
      } catch (failure) {
        const code = String((failure as { code?: string; message?: string }).code || (failure as Error).message || 'RESOURCE_UNAVAILABLE');
        return { url: item.url, status: 403, headers: { 'content-type': 'text/plain' }, bodyBase64: '',
          error: /^[A-Z_]{1,80}$/.test(code) ? code : 'RESOURCE_UNAVAILABLE' };
      }
    })));
  }
  return { results };
}
