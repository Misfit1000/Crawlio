export const CAPTURE_POLICY = Object.freeze({
  deadlineMs: 20_000,
  closeReserveMs: 2_000,
  browserIntervalMs: 20_000,
  dailyBudgetMs: 480_000,
  maxImageBytes: 400 * 1024,
  maxResources: 60,
  maxDecodedBytes: 12 * 1024 * 1024,
  maxResourceBytes: 512_000,
  maxBatchBytes: 2 * 1024 * 1024,
  maxBatchRequests: 4,
  maxProxyConcurrency: 2,
  maxProxyCalls: 24,
  maxSubrequests: 40,
  proxyPath: '/api/tools/internal/preview/resources',
  bucket: 'audit-previews',
});

export const CAPTURE_PROFILES = Object.freeze({
  desktop: {
    viewport: { width: 1440, height: 900 },
    screen: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  },
  mobile: {
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36',
  },
});

export type PreviewStatus = 'captured' | 'blocked' | 'quota_exhausted' | 'unavailable';

export class PreviewFailure extends Error {
  constructor(public readonly code: string, public readonly status: PreviewStatus = 'unavailable') {
    super(code);
    this.name = 'PreviewFailure';
  }
}

// DNS resolution and redirect pinning belong to the Node proxy, never this browser.
export function publicResourceUrl(value: string, deniedOrigins: readonly string[] = []): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new PreviewFailure('UNSAFE_URL', 'blocked'); }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || value.length > 8192
    || (url.port && !['80', '443'].includes(url.port)) || !host.includes('.')
    || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')
    || host.includes(':') || /^\d+(\.\d+){3}$/.test(host) || deniedOrigins.includes(url.origin)) {
    throw new PreviewFailure('UNSAFE_URL', 'blocked');
  }
  url.hash = '';
  return url.href;
}

export function trustedHttpsUrl(value: string | undefined, exactPath?: string): string | null {
  if (!value) return null;
  try {
    if (new URL(value).hash) return null;
    const url = new URL(publicResourceUrl(value));
    if (url.protocol !== 'https:' || url.search || url.hash || (exactPath && url.pathname !== exactPath)) return null;
    if (!exactPath && url.pathname !== '/') return null;
    return exactPath ? url.href : url.origin;
  } catch { return null; }
}

export function capturePaths(id: string, generation: number) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    || !Number.isSafeInteger(generation) || generation < 1) throw new PreviewFailure('INVALID_CLAIM');
  return { desktop: `${id}/${generation}/desktop.webp`, mobile: `${id}/${generation}/mobile.webp` };
}

export function ownedArtifactPath(id: string, value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = value.split('/');
  return parts.length === 3 && parts[0] === id && /^[1-9]\d*$/.test(parts[1])
    && ['desktop.webp', 'mobile.webp'].includes(parts[2]);
}

export const PREVIEW_CSP = "default-src http: https:; script-src http: https: 'unsafe-inline' 'unsafe-eval'; style-src http: https: 'unsafe-inline'; img-src http: https: data: blob:; font-src http: https: data:; connect-src http: https:; frame-src http: https:; worker-src 'none'; object-src 'none'; base-uri http: https:; form-action 'none'; sandbox allow-scripts allow-same-origin";

export function browserResponseHeaders(input: Record<string, string>, document: boolean, baseUrl: string, deniedOrigins: readonly string[]) {
  const output: Record<string, string> = {};
  const allowed = new Set(['content-type', 'cache-control', 'expires', 'last-modified', 'etag', 'vary',
    'access-control-allow-origin', 'access-control-expose-headers', 'cross-origin-resource-policy', 'location']);
  for (const [rawName, value] of Object.entries(input)) {
    const name = rawName.toLowerCase();
    if (!allowed.has(name) || typeof value !== 'string' || /[\r\n\0]/.test(value) || value.length > 8192) continue;
    if (name === 'location') {
      output[name] = publicResourceUrl(new URL(value, baseUrl).href, deniedOrigins);
    } else output[name] = value;
  }
  output['referrer-policy'] = 'no-referrer';
  if (document) output['content-security-policy'] = PREVIEW_CSP;
  return output;
}

export function decodeBase64(value: string, maxBytes: number): Uint8Array {
  if (typeof value !== 'string' || value.length > Math.ceil(maxBytes / 3) * 4
    || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new PreviewFailure('INVALID_RESOURCE_BODY');
  }
  const decoded = atob(value);
  if (decoded.length > maxBytes) throw new PreviewFailure('RESOURCE_BYTE_LIMIT');
  return Uint8Array.from(decoded, char => char.charCodeAt(0));
}

export function webpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const text = (at: number, size: number) => String.fromCharCode(...bytes.subarray(at, at + size));
  if (bytes.length < 30 || text(0, 4) !== 'RIFF' || text(8, 4) !== 'WEBP') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 12; at + 8 <= bytes.length;) {
    const type = text(at, 4), size = view.getUint32(at + 4, true), data = at + 8;
    if (data + size > bytes.length) return null;
    if (type === 'VP8X' && size >= 10) return {
      width: 1 + bytes[data + 4] + (bytes[data + 5] << 8) + (bytes[data + 6] << 16),
      height: 1 + bytes[data + 7] + (bytes[data + 8] << 8) + (bytes[data + 9] << 16),
    };
    if (type === 'VP8 ' && size >= 10 && text(data + 3, 3) === '\x9d\x01\x2a') return {
      width: view.getUint16(data + 6, true) & 0x3fff, height: view.getUint16(data + 8, true) & 0x3fff,
    };
    if (type === 'VP8L' && size >= 5 && bytes[data] === 0x2f) return {
      width: 1 + bytes[data + 1] + ((bytes[data + 2] & 0x3f) << 8),
      height: 1 + (bytes[data + 2] >> 6) + (bytes[data + 3] << 2) + ((bytes[data + 4] & 0x0f) << 10),
    };
    at = data + size + (size % 2);
  }
  return null;
}
