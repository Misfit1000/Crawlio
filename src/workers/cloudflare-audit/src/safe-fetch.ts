import { Buffer } from 'node:buffer';
import { isIP } from 'node:net';
import type {
  PublicFetchErrorCode,
  SafePublicFetchOptions,
  SafePublicResponse,
} from '../../../lib/security/safe-public-fetch';

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type ErrorCode = PublicFetchErrorCode | 'SUBREQUEST_BUDGET_EXCEEDED';

export class CloudflarePublicFetchError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = 'PublicFetchError';
  }
}

export interface CloudflareSubrequestBudget {
  consume(): void;
}

export type CloudflareSafeFetchOptions = Omit<SafePublicFetchOptions,
  'allowPrivateForTesting' | 'allowNonStandardPortsForTesting'> & {
  signal?: AbortSignal;
  subrequestBudget?: CloudflareSubrequestBudget;
};

export function createCloudflareFetchBudget(limit = 12) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 40) {
    throw new CloudflarePublicFetchError('REQUEST_FAILED', 'Invalid subrequest budget.');
  }
  let remaining = limit;
  return {
    get remaining() { return remaining; },
    consume() {
      if (remaining === 0) {
        throw new CloudflarePublicFetchError('SUBREQUEST_BUDGET_EXCEEDED', 'The network subrequest budget was exhausted.');
      }
      remaining -= 1;
    },
  } satisfies CloudflareSubrequestBudget & { readonly remaining: number };
}

const MAX_BYTES = 2_000_000;
const DNS_BYTES = 32_768;
const PRIVATE_MESSAGE = 'Private, local, reserved, and metadata-network targets cannot be audited.';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const IPV4_DENY: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8],
  [0xa9fe0000, 16], [0xac100000, 12], [0xc0000000, 24], [0xc0000200, 24],
  [0xc0586300, 24], [0xc0a80000, 16], [0xc6120000, 15], [0xc6336400, 24],
  [0xcb007100, 24], [0xe0000000, 4], [0xf0000000, 4],
];

function ipv4Number(value: string) {
  return value.split('.').reduce((result, part) => ((result << 8) | Number(part)) >>> 0, 0);
}

function ipv6Words(value: string) {
  const dotted = value.lastIndexOf(':');
  if (value.includes('.')) {
    const address = ipv4Number(value.slice(dotted + 1));
    value = `${value.slice(0, dotted)}:${(address >>> 16).toString(16)}:${(address & 0xffff).toString(16)}`;
  }
  const [left, right] = value.split('::');
  const leading = left ? left.split(':') : [];
  const trailing = right ? right.split(':') : [];
  return (right === undefined ? leading : [
    ...leading, ...Array<string>(8 - leading.length - trailing.length).fill('0'), ...trailing,
  ]).map((word) => Number.parseInt(word, 16));
}

// Deliberately conservative: deny special-use ranges and non-global IPv6, including tunnels.
export function isCloudflarePrivateOrReservedAddress(value: string): boolean {
  if (value.includes('%')) return true;
  const family = isIP(value);
  if (family === 4) {
    const address = ipv4Number(value);
    return IPV4_DENY.some(([base, prefix]) => {
      const mask = (0xffffffff << (32 - prefix)) >>> 0;
      return (address & mask) === (base & mask);
    });
  }
  if (family !== 6) return true;
  const words = ipv6Words(value.toLowerCase());
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return isCloudflarePrivateOrReservedAddress([
      words[6] >>> 8, words[6] & 0xff, words[7] >>> 8, words[7] & 0xff,
    ].join('.'));
  }
  return (words[0] & 0xe000) !== 0x2000
    || (words[0] === 0x2001 && (words[1] < 0x0200 || words[1] === 0x0db8))
    || words[0] === 0x2002
    || (words[0] === 0x3fff && (words[1] & 0xf000) === 0);
}

function validHostname(hostname: string) {
  return hostname.length <= 253 && hostname.includes('.') && hostname.split('.').every((label) =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

function parseTarget(value: string) {
  let url: URL;
  if (typeof value !== 'string' || value.length > 8_192) {
    throw new CloudflarePublicFetchError('INVALID_URL', 'Enter a valid public HTTP or HTTPS URL.');
  }
  try { url = new URL(value); } catch {
    throw new CloudflarePublicFetchError('INVALID_URL', 'Enter a valid public HTTP or HTTPS URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new CloudflarePublicFetchError('UNSUPPORTED_PROTOCOL', 'Only HTTP and HTTPS URLs can be audited.');
  }
  if (url.username || url.password) {
    throw new CloudflarePublicFetchError('EMBEDDED_CREDENTIALS', 'URLs containing credentials are not supported.');
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new CloudflarePublicFetchError('UNSUPPORTED_PORT', 'Only standard HTTP and HTTPS ports are supported.');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (isIP(hostname)) {
    if (isCloudflarePrivateOrReservedAddress(hostname)) {
      throw new CloudflarePublicFetchError('PRIVATE_NETWORK_TARGET', PRIVATE_MESSAGE);
    }
  } else {
    if (/(?:^|\.)(?:localhost|local|internal|lan|home|invalid|test|onion|arpa|alt)$/.test(hostname)
      || !hostname.includes('.')) {
      throw new CloudflarePublicFetchError('PRIVATE_NETWORK_TARGET', PRIVATE_MESSAGE);
    }
    if (!validHostname(hostname)) {
      throw new CloudflarePublicFetchError('INVALID_URL', 'Enter a valid public hostname.');
    }
    url.hostname = hostname;
  }
  url.hash = '';
  return url;
}

function bounded(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < minimum) {
    throw new CloudflarePublicFetchError('REQUEST_FAILED', 'Invalid public fetch limits.');
  }
  return Math.min(value, maximum);
}

function abortError(signal: AbortSignal) {
  return signal.reason instanceof CloudflarePublicFetchError ? signal.reason
    : new CloudflarePublicFetchError('REQUEST_FAILED', 'The website request was cancelled.');
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError(signal));
    if (signal.aborted) {
      void operation.catch(() => {});
      reject(abortError(signal));
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function discard(response: Response) {
  try { void response.body?.cancel().catch(() => {}); } catch { /* Already consumed or locked. */ }
}

async function fetchBounded(
  url: string, init: RequestInit, signal: AbortSignal,
  budget: CloudflareSubrequestBudget, fetchImpl: FetchImplementation,
) {
  if (signal.aborted) throw abortError(signal);
  budget.consume();
  const operation = fetchImpl(url, { ...init, signal, redirect: 'manual' });
  void operation.then((response) => { if (signal.aborted) discard(response); }, () => {});
  return abortable(operation, signal);
}

async function readBody(response: Response, limit: number, signal: AbortSignal) {
  if (Number(response.headers.get('content-length')) > limit) {
    discard(response);
    throw new CloudflarePublicFetchError('RESPONSE_TOO_LARGE', 'The response exceeded the analysis size limit.');
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  let buffer = new Uint8Array(Math.min(limit, 16_384));
  let length = 0;
  let complete = false;
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) { complete = true; return buffer.subarray(0, length); }
      if (value.byteLength > limit - length) {
        throw new CloudflarePublicFetchError('RESPONSE_TOO_LARGE', 'The response exceeded the analysis size limit.');
      }
      if (length + value.byteLength > buffer.byteLength) {
        const larger = new Uint8Array(Math.min(limit, Math.max(buffer.byteLength * 2, length + value.byteLength)));
        larger.set(buffer.subarray(0, length));
        buffer = larger;
      }
      buffer.set(value, length);
      length += value.byteLength;
    }
  } finally {
    if (!complete) {
      try { void reader.cancel().catch(() => {}); } catch { /* Cancellation is best-effort. */ }
    }
    reader.releaseLock();
  }
}

async function validateDns(
  hostname: string, signal: AbortSignal, dnsTimeoutMs: number,
  budget: CloudflareSubrequestBudget, fetchImpl: FetchImplementation,
) {
  if (isIP(hostname)) return;
  const controller = new AbortController();
  const abort = () => controller.abort(abortError(signal));
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(() => controller.abort(
    new CloudflarePublicFetchError('DNS_TIMEOUT', 'DNS resolution timed out.'),
  ), dnsTimeoutMs);
  try {
    const families = await Promise.all(([1, 28] as const).map(async (type) => {
      const url = new URL('https://cloudflare-dns.com/dns-query');
      url.searchParams.set('name', hostname);
      url.searchParams.set('type', type === 1 ? 'A' : 'AAAA');
      const response = await fetchBounded(url.toString(), {
        headers: { Accept: 'application/dns-json' }, cache: 'no-store',
      }, controller.signal, budget, fetchImpl);
      if (response.status !== 200
        || !/^(?:application\/dns-json|application\/json)(?:;|$)/i.test(response.headers.get('content-type') || '')) {
        discard(response);
        throw new CloudflarePublicFetchError('DNS_FAILURE', 'DNS resolution could not be verified.');
      }
      let data: unknown;
      try { data = JSON.parse(new TextDecoder().decode(await readBody(response, DNS_BYTES, controller.signal))); }
      catch (error) {
        if (error instanceof CloudflarePublicFetchError) throw error;
        throw new CloudflarePublicFetchError('DNS_FAILURE', 'DNS resolution could not be verified.');
      }
      if (!data || typeof data !== 'object') {
        throw new CloudflarePublicFetchError('DNS_FAILURE', 'DNS resolution could not be verified.');
      }
      const dns = data as { Status?: unknown; TC?: unknown; Answer?: unknown };
      if (dns.Status === 3) {
        throw new CloudflarePublicFetchError('DNS_NAME_NOT_FOUND', 'The hostname did not resolve to a public address.');
      }
      if (dns.Status !== 0 || dns.TC === true || (dns.Answer !== undefined && !Array.isArray(dns.Answer))) {
        throw new CloudflarePublicFetchError('DNS_FAILURE', 'DNS resolution could not be verified.');
      }
      const answers = (dns.Answer ?? []) as Array<{ type?: unknown; data?: unknown }>;
      if (answers.length > 64) throw new CloudflarePublicFetchError('DNS_FAILURE', 'DNS resolution could not be verified.');
      let addresses = 0;
      for (const record of answers) {
        if (!record || typeof record !== 'object') {
          throw new CloudflarePublicFetchError('DNS_FAILURE', 'DNS resolution could not be verified.');
        }
        if (record.type !== 1 && record.type !== 28) continue;
        const family = record.type === 1 ? 4 : 6;
        if (typeof record.data !== 'string' || isIP(record.data) !== family) {
          throw new CloudflarePublicFetchError('DNS_FAILURE', 'DNS resolution could not be verified.');
        }
        if (isCloudflarePrivateOrReservedAddress(record.data)) {
          throw new CloudflarePublicFetchError('PRIVATE_NETWORK_TARGET', PRIVATE_MESSAGE);
        }
        addresses += 1;
      }
      return addresses;
    }));
    if (!families.some((count) => count > 0)) {
      throw new CloudflarePublicFetchError('DNS_NAME_NOT_FOUND', 'The hostname did not resolve to a public address.');
    }
  } catch (error) {
    if (error instanceof CloudflarePublicFetchError) throw error;
    throw new CloudflarePublicFetchError('DNS_FAILURE', 'DNS resolution could not be verified.');
  } finally {
    controller.abort();
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

function allowedMime(contentType: string, allowed: string[], missing: boolean) {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  if (!mime) return missing || allowed.length === 0;
  return allowed.length === 0 || allowed.some((item) => {
    const expected = item.trim().toLowerCase();
    return mime === expected || (['application/xml', 'application/json'].includes(expected)
      && mime.startsWith('application/') && mime.endsWith(`+${expected.slice(12)}`)
      && /^application\/[a-z0-9.+-]+$/.test(mime));
  });
}

/**
 * Requires nodejs_compat and public-internet fetch, without VPC/private-network bindings.
 * DoH validation is NOT connection pinning: Workers fetch resolves again. DNS rebinding
 * remains a platform constraint. Use the trusted Render pinned-fetch broker when exact
 * pinning is required; do not represent this adapter as equivalent to Render's transport.
 * Injected fetch implementations must retain Fetch's decoded-body semantics.
 */
export async function cloudflareSafeFetch(
  value: string, options: CloudflareSafeFetchOptions = {}, fetchImpl: FetchImplementation = (input, init) => globalThis.fetch(input, init),
): Promise<SafePublicResponse> {
  const startedAt = Date.now();
  const requestedUrl = parseTarget(value).toString();
  const timeoutMs = bounded(options.timeoutMs, 8_000, 1, 30_000);
  const dnsTimeoutMs = bounded(options.dnsTimeoutMs, 3_000, 1, 3_000);
  const maxBytes = bounded(options.maxBytes, MAX_BYTES, 1, MAX_BYTES);
  const maxRedirects = bounded(options.maxRedirects, 5, 0, 5);
  const budget = options.subrequestBudget ?? createCloudflareFetchBudget();
  const method = options.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    throw new CloudflarePublicFetchError('REQUEST_FAILED', 'Only GET and HEAD requests are supported.');
  }
  const controller = new AbortController();
  const abort = () => controller.abort(new CloudflarePublicFetchError('REQUEST_FAILED', 'The website request was cancelled.'));
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(
    new CloudflarePublicFetchError('REQUEST_TIMEOUT', 'The website request exceeded its total time limit.'),
  ), timeoutMs);
  let current = new URL(requestedUrl);
  const seen = new Set<string>();
  try {
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      if (controller.signal.aborted) throw abortError(controller.signal);
      if (seen.has(current.toString())) {
        throw new CloudflarePublicFetchError('REDIRECT_LOOP', 'A redirect loop was detected.');
      }
      seen.add(current.toString());
      try {
        await validateDns(current.hostname.replace(/^\[|\]$/g, ''), controller.signal, dnsTimeoutMs, budget, fetchImpl);
      } catch (error) {
        if (redirectCount && error instanceof CloudflarePublicFetchError && error.code === 'PRIVATE_NETWORK_TARGET') {
          throw new CloudflarePublicFetchError('UNSAFE_REDIRECT_TARGET', PRIVATE_MESSAGE);
        }
        throw error;
      }
      const allowed = options.allowedContentTypes ?? ['text/html', 'application/xhtml+xml'];
      const response = await fetchBounded(current.toString(), {
        method, cache: 'no-store', headers: {
          'User-Agent': options.userAgent ?? 'CrawlioBot/1.0 (+https://crawlio1.vercel.app/)',
          Accept: allowed.includes('text/html') ? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1' : '*/*',
          'Accept-Encoding': 'identity',
        },
      }, controller.signal, budget, fetchImpl);
      if (REDIRECT_STATUSES.has(response.status)) {
        discard(response);
        const location = response.headers.get('location');
        if (!location) throw new CloudflarePublicFetchError('REDIRECT_WITHOUT_LOCATION', 'The redirect has no destination.');
        if (redirectCount === maxRedirects) throw new CloudflarePublicFetchError('TOO_MANY_REDIRECTS', 'The response exceeded the redirect limit.');
        try { current = parseTarget(new URL(location, current).toString()); } catch (error) {
          if (error instanceof CloudflarePublicFetchError && error.code === 'PRIVATE_NETWORK_TARGET') {
            throw new CloudflarePublicFetchError('UNSAFE_REDIRECT_TARGET', PRIVATE_MESSAGE);
          }
          throw new CloudflarePublicFetchError('INVALID_REDIRECT_TARGET', 'The redirect destination is not a supported public URL.');
        }
        continue;
      }
      const contentType = response.headers.get('content-type') || '';
      if (!allowedMime(contentType, allowed, options.allowMissingContentType ?? false)) {
        discard(response);
        throw new CloudflarePublicFetchError('UNSUPPORTED_CONTENT_TYPE', 'The response content type is not supported.');
      }
      const encoding = (response.headers.get('content-encoding') || 'identity').trim().toLowerCase();
      if (!['identity', 'gzip', 'br'].includes(encoding)) {
        discard(response);
        throw new CloudflarePublicFetchError('REQUEST_FAILED', 'The response compression format is not supported.');
      }
      // Fetch exposes decoded bytes even when an origin ignores Accept-Encoding: identity.
      const bytes = method === 'HEAD' ? (discard(response), new Uint8Array())
        : await readBody(response, maxBytes, controller.signal);
      if (controller.signal.aborted) throw abortError(controller.signal);
      const headers: Record<string, string> = {};
      response.headers.forEach((header, name) => { headers[name.toLowerCase()] = header; });
      return {
        requestedUrl, finalUrl: current.toString(), status: response.status, headers, contentType,
        body: options.returnBuffer ? '' : new TextDecoder().decode(bytes),
        ...(options.returnBuffer ? { bodyBuffer: Buffer.from(bytes) } : {}),
        bodyBytes: bytes.byteLength, redirectCount, durationMs: Date.now() - startedAt,
      };
    }
    throw new CloudflarePublicFetchError('TOO_MANY_REDIRECTS', 'The response exceeded the redirect limit.');
  } catch (error) {
    controller.abort();
    if (error instanceof CloudflarePublicFetchError) throw error;
    throw new CloudflarePublicFetchError('REQUEST_FAILED', 'The website request could not be completed safely.');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
