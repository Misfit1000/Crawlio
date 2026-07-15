import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

export type PublicFetchErrorCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED_PROTOCOL'
  | 'EMBEDDED_CREDENTIALS'
  | 'UNSUPPORTED_PORT'
  | 'DNS_TIMEOUT'
  | 'DNS_FAILURE'
  | 'DNS_NAME_NOT_FOUND'
  | 'DNS_TEMPORARY_FAILURE'
  | 'PRIVATE_NETWORK_TARGET'
  | 'UNSAFE_REDIRECT_TARGET'
  | 'TOO_MANY_REDIRECTS'
  | 'REDIRECT_LOOP'
  | 'REDIRECT_WITHOUT_LOCATION'
  | 'INVALID_REDIRECT_TARGET'
  | 'REQUEST_TIMEOUT'
  | 'CONNECTION_TIMEOUT'
  | 'CONNECTION_REFUSED'
  | 'CONNECTION_RESET'
  | 'TLS_CERTIFICATE_INVALID'
  | 'RESPONSE_TOO_LARGE'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'REQUEST_FAILED';

export class PublicFetchError extends Error {
  code: PublicFetchErrorCode;
  constructor(code: PublicFetchErrorCode, message: string) {
    super(message);
    this.name = 'PublicFetchError';
    this.code = code;
  }
}

export interface SafePublicFetchOptions {
  method?: 'GET' | 'HEAD';
  timeoutMs?: number;
  dnsTimeoutMs?: number;
  maxRedirects?: number;
  maxBytes?: number;
  allowedContentTypes?: string[];
  userAgent?: string;
  allowPrivateForTesting?: boolean;
  allowNonStandardPortsForTesting?: boolean;
  returnBuffer?: boolean;
}

export interface SafePublicResponse {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  contentType: string;
  body: string;
  bodyBuffer?: Buffer;
  bodyBytes: number;
  redirectCount: number;
  durationMs: number;
}

type ResolvedAddress = { address: string; family: 4 | 6 };

function systemErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return '';
  const value = error as { code?: unknown; cause?: { code?: unknown } };
  return String(value.code || value.cause?.code || '').toUpperCase();
}

function publicRequestError(error: unknown) {
  if (error instanceof PublicFetchError) return error;
  const code = systemErrorCode(error);
  const message = error instanceof Error ? error.message : String(error || 'Request failed');
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return new PublicFetchError('CONNECTION_TIMEOUT', message);
  if (code === 'ECONNREFUSED') return new PublicFetchError('CONNECTION_REFUSED', message);
  if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'UND_ERR_SOCKET') return new PublicFetchError('CONNECTION_RESET', message);
  if (/CERT|TLS|SSL|UNABLE_TO_VERIFY|SELF_SIGNED|WRONG_VERSION_NUMBER/.test(code)) return new PublicFetchError('TLS_CERTIFICATE_INVALID', message);
  return new PublicFetchError('REQUEST_FAILED', message);
}

function ipv4Number(address: string) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return null;
  return (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
}

function inIpv4Cidr(address: string, network: string, prefix: number) {
  const value = ipv4Number(address);
  const base = ipv4Number(network);
  if (value == null || base == null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

export function isPrivateOrReservedAddress(address: string) {
  const normalized = address.toLowerCase().split('%')[0];
  if (isIP(normalized) === 4) {
    return [
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4],
    ].some(([network, prefix]) => inIpv4Cidr(normalized, String(network), Number(prefix)));
  }

  if (isIP(normalized) !== 6) return true;
  if (normalized === '::' || normalized === '::1') return true;
  if (/^(fc|fd)/.test(normalized)) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (/^ff/.test(normalized)) return true;
  if (/^2001:db8(?:[:]|$)/.test(normalized)) return true;
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateOrReservedAddress(mapped[1]) : false;
}

function normalizedPort(url: URL) {
  if (url.port) return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}

export function parsePublicHttpUrl(value: string, options: Pick<SafePublicFetchOptions, 'allowNonStandardPortsForTesting'> = {}) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PublicFetchError('INVALID_URL', 'Enter a valid public HTTP or HTTPS URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new PublicFetchError('UNSUPPORTED_PROTOCOL', 'Only HTTP and HTTPS URLs can be audited.');
  }
  if (url.username || url.password) {
    throw new PublicFetchError('EMBEDDED_CREDENTIALS', 'URLs containing embedded credentials are not supported.');
  }
  const port = normalizedPort(url);
  if (!options.allowNonStandardPortsForTesting && port !== 80 && port !== 443) {
    throw new PublicFetchError('UNSUPPORTED_PORT', 'Only standard HTTP and HTTPS ports are supported.');
  }
  if (!url.hostname) throw new PublicFetchError('INVALID_URL', 'The URL must include a public hostname.');
  return url;
}

async function resolvePublicAddresses(hostname: string, timeoutMs: number, allowPrivateForTesting = false): Promise<ResolvedAddress[]> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const records = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new PublicFetchError('DNS_TEMPORARY_FAILURE', 'DNS resolution timed out.')), timeoutMs);
      }),
    ]);
    const addresses = records.map((record) => ({ address: record.address, family: record.family as 4 | 6 }));
    if (!addresses.length) throw new PublicFetchError('DNS_NAME_NOT_FOUND', 'The hostname did not resolve to an address.');
    if (!allowPrivateForTesting && addresses.some((record) => isPrivateOrReservedAddress(record.address))) {
      throw new PublicFetchError('PRIVATE_NETWORK_TARGET', 'Private, local, reserved, and metadata-network targets cannot be audited.');
    }
    return addresses;
  } catch (error) {
    if (error instanceof PublicFetchError) throw error;
    const code = systemErrorCode(error);
    const detail = error instanceof Error ? error.message : 'DNS resolution failed.';
    if (code === 'ENOTFOUND' || code === 'ENODATA') throw new PublicFetchError('DNS_NAME_NOT_FOUND', detail);
    if (code === 'EAI_AGAIN' || code === 'ETIMEOUT') throw new PublicFetchError('DNS_TEMPORARY_FAILURE', detail);
    throw new PublicFetchError('DNS_FAILURE', detail);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function flattenHeaders(headers: IncomingHttpHeaders) {
  const result: Record<string, string> = {};
  Object.entries(headers).forEach(([key, value]) => {
    if (value != null) result[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
  });
  return result;
}

function contentTypeAllowed(contentType: string, allowed: string[]) {
  if (!allowed.length) return true;
  const normalized = contentType.toLowerCase().split(';')[0].trim();
  return allowed.some((item) => normalized === item || normalized.endsWith(`+${item.replace(/^application\//, '')}`));
}

async function requestPinned(url: URL, address: ResolvedAddress, options: Required<SafePublicFetchOptions>) {
  return new Promise<{ status: number; headers: Record<string, string>; body: string; bodyBuffer: Buffer; bytes: number }>((resolve, reject) => {
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
    let settled = false;
    const requestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: normalizedPort(url),
      method: options.method,
      path: `${url.pathname}${url.search}`,
      headers: {
        'User-Agent': options.userAgent,
        'Accept-Encoding': 'identity',
        Accept: options.allowedContentTypes.includes('text/html') ? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1' : '*/*',
      },
      lookup: (_hostname, lookupOptions, callback) => {
        if (typeof lookupOptions === 'object' && lookupOptions?.all) {
          callback(null, [{ address: address.address, family: address.family }]);
          return;
        }
        callback(null, address.address, address.family);
      },
      servername: url.protocol === 'https:' ? url.hostname : undefined,
    } as any;
    const request = transport(requestOptions, (response) => {
      const headers = flattenHeaders(response.headers);
      const declaredLength = Number(headers['content-length'] || 0);
      if (declaredLength > options.maxBytes) {
        settled = true;
        response.destroy();
        reject(new PublicFetchError('RESPONSE_TOO_LARGE', `Response exceeded the ${options.maxBytes}-byte analysis limit.`));
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > options.maxBytes) {
          settled = true;
          request.destroy();
          response.destroy();
          reject(new PublicFetchError('RESPONSE_TOO_LARGE', `Response exceeded the ${options.maxBytes}-byte analysis limit.`));
          return;
        }
        chunks.push(buffer);
      });
      response.on('end', () => {
        if (settled) return;
        settled = true;
        const bodyBuffer = Buffer.concat(chunks);
        resolve({ status: response.statusCode || 0, headers, body: options.returnBuffer ? '' : bodyBuffer.toString('utf8'), bodyBuffer, bytes });
      });
      response.on('error', (error) => {
        if (settled) return;
        settled = true;
        reject(publicRequestError(error));
      });
    });

    request.setTimeout(options.timeoutMs, () => {
      if (settled) return;
      settled = true;
      request.destroy();
      reject(new PublicFetchError('CONNECTION_TIMEOUT', `Request timed out after ${options.timeoutMs}ms.`));
    });
    request.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(publicRequestError(error));
    });
    request.end();
  });
}

export async function safePublicFetch(value: string, input: SafePublicFetchOptions = {}): Promise<SafePublicResponse> {
  const options: Required<SafePublicFetchOptions> = {
    method: input.method ?? 'GET',
    timeoutMs: input.timeoutMs ?? 8_000,
    dnsTimeoutMs: input.dnsTimeoutMs ?? 3_000,
    maxRedirects: input.maxRedirects ?? 5,
    maxBytes: input.maxBytes ?? 2_000_000,
    allowedContentTypes: input.allowedContentTypes ?? ['text/html', 'application/xhtml+xml'],
    userAgent: input.userAgent ?? 'SEOIntelBot/1.0 (+https://keywordsintel.vercel.app/)',
    allowPrivateForTesting: input.allowPrivateForTesting ?? false,
    allowNonStandardPortsForTesting: input.allowNonStandardPortsForTesting ?? false,
    returnBuffer: input.returnBuffer ?? false,
  };
  const requestedUrl = parsePublicHttpUrl(value, options).toString();
  const startedAt = Date.now();
  let current = parsePublicHttpUrl(requestedUrl, options);
  const seen = new Set<string>();

  for (let redirectCount = 0; redirectCount <= options.maxRedirects; redirectCount += 1) {
    if (seen.has(current.toString())) throw new PublicFetchError('REDIRECT_LOOP', 'A redirect loop was detected.');
    seen.add(current.toString());
    let addresses: ResolvedAddress[];
    try {
      addresses = await resolvePublicAddresses(current.hostname, options.dnsTimeoutMs, options.allowPrivateForTesting);
    } catch (error) {
      if (redirectCount > 0 && error instanceof PublicFetchError && error.code === 'PRIVATE_NETWORK_TARGET') {
        throw new PublicFetchError('UNSAFE_REDIRECT_TARGET', error.message);
      }
      throw error;
    }
    const response = await requestPinned(current, addresses[0], options);
    const location = response.headers.location;
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!location) throw new PublicFetchError('REDIRECT_WITHOUT_LOCATION', 'The server returned a redirect without a destination.');
      if (redirectCount >= options.maxRedirects) throw new PublicFetchError('TOO_MANY_REDIRECTS', 'The response exceeded the redirect limit.');
      try {
        current = parsePublicHttpUrl(new URL(location, current).toString(), options);
      } catch (error) {
        if (error instanceof PublicFetchError && error.code === 'PRIVATE_NETWORK_TARGET') {
          throw new PublicFetchError('UNSAFE_REDIRECT_TARGET', error.message);
        }
        throw new PublicFetchError('INVALID_REDIRECT_TARGET', error instanceof Error ? error.message : 'Invalid redirect target.');
      }
      continue;
    }

    const contentType = response.headers['content-type'] || '';
    if (response.body && !contentTypeAllowed(contentType, options.allowedContentTypes)) {
      throw new PublicFetchError('UNSUPPORTED_CONTENT_TYPE', `Unsupported response content type: ${contentType || 'unknown'}.`);
    }
    return {
      requestedUrl,
      finalUrl: current.toString(),
      status: response.status,
      headers: response.headers,
      contentType,
      body: response.body,
      ...(options.returnBuffer ? { bodyBuffer: response.bodyBuffer } : {}),
      bodyBytes: response.bytes,
      redirectCount,
      durationMs: Date.now() - startedAt,
    };
  }
  throw new PublicFetchError('TOO_MANY_REDIRECTS', 'The response exceeded the redirect limit.');
}
