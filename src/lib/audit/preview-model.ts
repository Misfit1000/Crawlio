export type AuditPreviewKind = 'screenshot' | 'open_graph' | 'metadata' | 'unavailable';

export interface AuditPreviewInput {
  url?: string | null;
  hostname?: string | null;
  title?: string | null;
  description?: string | null;
  h1?: string | null;
  siteName?: string | null;
  canonicalUrl?: string | null;
  faviconUrl?: string | null;
  themeColor?: string | null;
  screenshotUrl?: string | null;
  openGraphImage?: string | null;
}

export interface AuditPreviewState {
  kind: AuditPreviewKind;
  label: 'Screenshot' | 'Open Graph preview' | 'Metadata preview' | 'Preview unavailable';
  mediaUrl: string | null;
  hasMetadata: boolean;
}

function isObviousPrivateHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isObviousPrivateHostname(mappedIpv4);
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
    || normalized.endsWith('.internal')
    || normalized.endsWith('.lan')
    || normalized.endsWith('.home')
    || (!normalized.includes('.') && !normalized.includes(':'))
    || normalized === '0.0.0.0'
    || /^0\./.test(normalized)
    || normalized === '::1'
    || normalized === '::'
    || /^127\./.test(normalized)
    || /^10\./.test(normalized)
    || /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(normalized)
    || /^192\.168\./.test(normalized)
    || /^192\.0\.0\./.test(normalized)
    || /^192\.0\.2\./.test(normalized)
    || /^198\.(?:1[89]|51\.100)\./.test(normalized)
    || /^203\.0\.113\./.test(normalized)
    || /^(?:22[4-9]|23\d|24\d|25[0-5])\./.test(normalized)
    || /^169\.254\./.test(normalized)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(normalized)
    || /^(?:fc|fd)/.test(normalized)
    || /^fe[89ab]/.test(normalized)
    || /^ff/.test(normalized)
    || /^2001:db8(?:[:]|$)/.test(normalized);
}

export function safePreviewMediaUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || isObviousPrivateHostname(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function safePreviewThemeColor(value?: string | null) {
  const color = String(value || '').trim();
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  if (/^(?:rgb|hsl)a?\([\d\s.,%+-]+\)$/i.test(color)) return color;
  return null;
}

export function resolveAuditPreviewState(input: AuditPreviewInput): AuditPreviewState {
  const screenshotUrl = safePreviewMediaUrl(input.screenshotUrl);
  const openGraphImage = safePreviewMediaUrl(input.openGraphImage);
  const hasMetadata = Boolean(
    input.title
    || input.description
    || input.h1
    || input.siteName
    || input.canonicalUrl
    || safePreviewMediaUrl(input.faviconUrl)
    || safePreviewThemeColor(input.themeColor),
  );
  if (screenshotUrl) return { kind: 'screenshot', label: 'Screenshot', mediaUrl: screenshotUrl, hasMetadata };
  if (openGraphImage) return { kind: 'open_graph', label: 'Open Graph preview', mediaUrl: openGraphImage, hasMetadata };
  if (hasMetadata) return { kind: 'metadata', label: 'Metadata preview', mediaUrl: null, hasMetadata: true };
  return { kind: 'unavailable', label: 'Preview unavailable', mediaUrl: null, hasMetadata: false };
}
