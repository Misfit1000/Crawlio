export interface NormalizedAuditTarget {
  input: string;
  normalizedUrl: string;
  origin: string;
  hostname: string;
  protocol: 'http:' | 'https:';
  pathname: string;
  isValid: boolean;
  error?: string;
  errorCode?: 'REQUIRED' | 'UNSUPPORTED_SCHEME' | 'EMBEDDED_CREDENTIALS' | 'PRIVATE_NETWORK' | 'INVALID_DOMAIN';
}

export interface NormalizeAuditTargetOptions {
  allowPrivateForTesting?: boolean;
}

const EMPTY_RESULT = {
  normalizedUrl: '',
  origin: '',
  hostname: '',
  protocol: 'https:' as const,
  pathname: '',
  isValid: false,
};

function cleanAuditInput(value: string) {
  let cleaned = String(value || '').replace(/[\s\u00a0\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]+/gu, ' ').trim();
  const pairs: Array<[string, string]> = [['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’']];
  for (const [open, close] of pairs) {
    if (cleaned.startsWith(open) && cleaned.endsWith(close) && cleaned.length > 1) {
      cleaned = cleaned.slice(open.length, -close.length).trim();
      break;
    }
  }
  return cleaned;
}

function ipv4Number(address: string) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function inIpv4Cidr(address: string, network: string, prefix: number) {
  const value = ipv4Number(address);
  const base = ipv4Number(network);
  if (value == null || base == null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

export function isClearlyPrivateAuditHostname(hostname: string) {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (value === 'localhost' || value.endsWith('.localhost') || value.endsWith('.local') || value.endsWith('.internal') || value.endsWith('.lan')) return true;
  const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return isClearlyPrivateAuditHostname(mapped);
  if (ipv4Number(value) != null) {
    return [
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
      ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
      ['224.0.0.0', 4], ['240.0.0.0', 4],
    ].some(([network, prefix]) => inIpv4Cidr(value, String(network), Number(prefix)));
  }
  return value === '::' || value === '::1' || /^(?:fc|fd)/.test(value) || /^fe[89ab]/.test(value) || /^ff/.test(value) || /^2001:db8(?:[:]|$)/.test(value);
}

function hasPublicDomainShape(hostname: string) {
  if (ipv4Number(hostname) != null || hostname.includes(':')) return true;
  if (!hostname || hostname.startsWith('.') || hostname.endsWith('.') || !hostname.includes('.')) return false;
  return hostname.split('.').every((label) => label.length > 0 && label.length <= 63 && /^[a-z0-9-]+$/i.test(label) && !label.startsWith('-') && !label.endsWith('-'));
}

function invalid(input: string, error: string, errorCode: NonNullable<NormalizedAuditTarget['errorCode']>): NormalizedAuditTarget {
  return { input, ...EMPTY_RESULT, error, errorCode };
}

export function normalizeAuditTarget(rawInput: string, options: NormalizeAuditTargetOptions = {}): NormalizedAuditTarget {
  const input = cleanAuditInput(rawInput);
  if (!input) return invalid(input, 'Enter a valid public website or domain.', 'REQUIRED');

  const explicitScheme = input.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (explicitScheme && explicitScheme !== 'http' && explicitScheme !== 'https') {
    return invalid(input, 'Only public HTTP and HTTPS websites can be audited.', 'UNSUPPORTED_SCHEME');
  }

  try {
    const parsed = new URL(explicitScheme ? input : `https://${input}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return invalid(input, 'Only public HTTP and HTTPS websites can be audited.', 'UNSUPPORTED_SCHEME');
    }
    if (parsed.username || parsed.password) {
      return invalid(input, 'Website addresses containing usernames or passwords cannot be audited.', 'EMBEDDED_CREDENTIALS');
    }
    parsed.hostname = parsed.hostname.toLowerCase();
    if (!hasPublicDomainShape(parsed.hostname)) {
      return invalid(input, 'The domain name could not be understood.', 'INVALID_DOMAIN');
    }
    if (!options.allowPrivateForTesting && isClearlyPrivateAuditHostname(parsed.hostname)) {
      return invalid(input, 'This address points to a private network and cannot be audited.', 'PRIVATE_NETWORK');
    }
    if ((parsed.protocol === 'https:' && parsed.port === '443') || (parsed.protocol === 'http:' && parsed.port === '80')) parsed.port = '';
    parsed.hash = '';
    return {
      input,
      normalizedUrl: parsed.toString(),
      origin: parsed.origin,
      hostname: parsed.hostname,
      protocol: parsed.protocol as 'http:' | 'https:',
      pathname: parsed.pathname,
      isValid: true,
    };
  } catch {
    return invalid(input, 'The domain name could not be understood.', 'INVALID_DOMAIN');
  }
}

export const AUDIT_TARGET_INPUT_PROPS = {
  type: 'text',
  inputMode: 'url' as const,
  autoCapitalize: 'none',
  autoCorrect: 'off',
  spellCheck: false,
  placeholder: 'Enter a website or domain, e.g. example.com',
};
