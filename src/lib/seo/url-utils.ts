export interface NormalizedUrlResult {
  input: string;
  normalizedUrl: string;
  origin: string;
  hostname: string;
  protocol: "http:" | "https:";
  pathname: string;
  isValid: boolean;
  error?: string;
}

const BLOCKED_PROTOCOLS = ['javascript:', 'data:', 'file:', 'ftp:'];

function isPrivateHostname(hostname: string) {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.local')) return true;
  if (/^10\./.test(lower)) return true;
  if (/^127\./.test(lower)) return true;
  if (/^169\.254\./.test(lower)) return true;
  if (/^192\.168\./.test(lower)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(lower)) return true;
  if (lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd')) return true;
  return false;
}

function hasLikelyRegistrableHost(hostname: string) {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return true;
  if (!hostname || hostname.startsWith('.') || hostname.endsWith('.')) return false;
  if (!hostname.includes('.')) return false;
  const labels = hostname.split('.');
  const tld = labels[labels.length - 1];
  return labels.every(Boolean) && /^[a-z0-9-]+$/i.test(tld) && tld.length >= 2;
}

export function normalizeUserUrl(input: string): NormalizedUrlResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      input: trimmed,
      normalizedUrl: '',
      origin: '',
      hostname: '',
      protocol: "https:",
      pathname: '',
      isValid: false,
      error: 'URL is required',
    };
  }

  if (BLOCKED_PROTOCOLS.some((protocol) => trimmed.toLowerCase().startsWith(protocol))) {
    return {
      input: trimmed,
      normalizedUrl: '',
      origin: '',
      hostname: '',
      protocol: "https:",
      pathname: '',
      isValid: false,
      error: 'Only HTTP and HTTPS URLs are supported',
    };
  }

  let withProtocol = trimmed;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    withProtocol = `https://${trimmed}`;
  }

  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Only HTTP and HTTPS URLs are supported');
    }
    if (!hasLikelyRegistrableHost(parsed.hostname)) {
      throw new Error('Enter a valid public domain');
    }
    if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production' && isPrivateHostname(parsed.hostname)) {
      throw new Error('Private and localhost targets are not allowed in production');
    }
    parsed.hash = '';
    parsed.username = '';
    parsed.password = '';
    return {
      input: trimmed,
      normalizedUrl: parsed.href,
      origin: parsed.origin,
      hostname: parsed.hostname,
      protocol: parsed.protocol as "http:" | "https:",
      pathname: parsed.pathname,
      isValid: true,
    };
  } catch (error: any) {
    return {
      input: trimmed,
      normalizedUrl: '',
      origin: '',
      hostname: '',
      protocol: "https:",
      pathname: '',
      isValid: false,
      error: error.message || 'Invalid URL',
    };
  }
}

export function normalizeDomainInput(input: string): string {
  const result = normalizeUserUrl(input);
  if (!result.isValid) return input;
  return result.normalizedUrl;
}

export function normalizeUrl(url: string, baseUrl: string): string | null {
  try {
    const parsed = new URL(url, baseUrl);
    parsed.hash = ''; // Remove fragments
    return parsed.href;
  } catch (e) {
    return null;
  }
}

export function isSameDomain(url1: string, url2: string): boolean {
  try {
    const host1 = new URL(url1).hostname;
    const host2 = new URL(url2).hostname;
    return host1 === host2 || host1.endsWith('.' + host2) || host2.endsWith('.' + host1);
  } catch (e) {
    return false;
  }
}

export function stripTrackingParams(url: string): string {
  try {
    const parsed = new URL(url);
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
    for (const param of trackingParams) {
      parsed.searchParams.delete(param);
    }
    return parsed.href;
  } catch (e) {
    return url;
  }
}

export function isLikelyDomain(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  
  // Basic domain matching without protocol
  const domainRegex = /^[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/;
  return domainRegex.test(trimmed.replace(/^https?:\/\//, ''));
}

export function getDomainVariants(input: string): string[] {
  const res = normalizeUserUrl(input);
  if (!res.isValid) return [input];
  
  const host = res.hostname;
  const noWww = host.replace(/^www\./, '');
  
  return Array.from(new Set([
    `https://${noWww}`,
    `http://${noWww}`,
    `https://www.${noWww}`,
    `http://www.${noWww}`
  ]));
}
