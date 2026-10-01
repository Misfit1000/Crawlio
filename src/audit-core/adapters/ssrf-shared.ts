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
  allowMissingContentType?: boolean;
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
  bodyBuffer?: Uint8Array | Buffer;
  bodyBytes: number;
  redirectCount: number;
  durationMs: number;
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

function embeddedIpv4Address(address: string) {
  const dotted = address.match(/^(?:::ffff:|::|0:0:0:0:0:ffff:|0:0:0:0:0:0:)(\d+\.\d+\.\d+\.\d+)$/i);
  if (dotted) return dotted[1];

  const hexadecimal = address.match(/^(?:::ffff:|::|0:0:0:0:0:ffff:|0:0:0:0:0:0:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hexadecimal) return null;
  const high = Number.parseInt(hexadecimal[1], 16);
  const low = Number.parseInt(hexadecimal[2], 16);
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}

export function isIP(address: string): 4 | 6 | 0 {
  const ipv4Regex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
  if (ipv4Regex.test(address) && ipv4Number(address) !== null) {
    return 4;
  }
  const ipv6Regex = /^[0-9a-fA-F:]+$/;
  if (address.includes(':') && ipv6Regex.test(address)) {
    return 6;
  }
  return 0;
}

export function isPrivateOrReservedAddress(address: string): boolean {
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
  const embeddedIpv4 = embeddedIpv4Address(normalized);
  return embeddedIpv4 ? isPrivateOrReservedAddress(embeddedIpv4) : false;
}

export function normalizedPort(url: URL) {
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
