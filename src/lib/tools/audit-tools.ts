import type { AuditToolEvidence, ResourceAuditPage } from '../audit/resource-types';

const HEADER_KEYS = ['strict-transport-security', 'content-security-policy', 'content-security-policy-report-only', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy'];
const encoder = new TextEncoder();
function text(value: unknown, max: number) {
  if (typeof value !== 'string') return '';
  const candidate = value.slice(0, max);
  if (encoder.encode(JSON.stringify(candidate)).length - 2 <= max) return candidate;
  let result = '', bytes = 0;
  for (const character of candidate) {
    const size = encoder.encode(JSON.stringify(character)).length - 2;
    if (bytes + size > max) break;
    bytes += size; result += character;
  }
  return result;
}

export function readToolEvidence(value: unknown): AuditToolEvidence | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const input = value as Record<string, unknown>;
  if (input.version !== 1 || typeof input.contentType !== 'string' || typeof input.metaRobots !== 'string'
      || typeof input.xRobotsTag !== 'string' || typeof input.redirected !== 'boolean'
      || ![true, false, null].includes(input.robotsAllowed as boolean | null)) return;
  const headers = input.securityHeaders && typeof input.securityHeaders === 'object' ? input.securityHeaders as Record<string, unknown> : {};
  return { version: 1, contentType: text(input.contentType, 120), metaRobots: text(input.metaRobots, 512),
    xRobotsTag: text(input.xRobotsTag, 512), robotsAllowed: input.robotsAllowed as boolean | null, redirected: input.redirected,
    lastModified: validModifiedDate(input.lastModified), ogTitle: text(input.ogTitle, 300), ogDescription: text(input.ogDescription, 600),
    outgoingInternalLinks: Number.isSafeInteger(input.outgoingInternalLinks) && Number(input.outgoingInternalLinks) >= 0 ? Number(input.outgoingInternalLinks) : undefined,
    securityHeaders: Object.fromEntries(HEADER_KEYS.filter(key => typeof headers[key] === 'boolean').map(key => [key, headers[key] as boolean])) };
}

function validModifiedDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const date = Date.parse(value);
  return Number.isFinite(date) && date <= Date.now() ? new Date(date).toISOString() : undefined;
}

export function collectToolEvidence(input: {
  contentType: string; headers: Record<string, string>; finalUrl: string; requestedUrl: string;
  parsed?: { metaRobots?: string; ogTitle?: string; ogDescription?: string; internalLinks?: Array<{ href: string }> };
  robotsAllowed: boolean | null;
}): AuditToolEvidence {
  return { version: 1, contentType: text(input.contentType, 120), metaRobots: text(input.parsed?.metaRobots, 512),
    xRobotsTag: text(input.headers['x-robots-tag'], 512), robotsAllowed: input.robotsAllowed,
    redirected: input.finalUrl !== input.requestedUrl, lastModified: validModifiedDate(input.headers['last-modified']),
    ogTitle: text(input.parsed?.ogTitle, 300), ogDescription: text(input.parsed?.ogDescription, 600),
    outgoingInternalLinks: input.parsed?.internalLinks ? new Set(input.parsed.internalLinks.map(link => link.href.split('#')[0])).size : undefined,
    securityHeaders: Object.fromEntries(HEADER_KEYS.map(key => [key, Boolean(input.headers[key]?.trim())])) };
}

export function sitemapEligibility(page: ResourceAuditPage, origin: string): { included: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const evidence = readToolEvidence(page.toolEvidence);
  let url: URL | undefined;
  try { url = new URL(page.url); } catch { reasons.push('Invalid URL'); }
  if (url && (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.origin !== origin)) reasons.push('Not a clean URL on the selected origin');
  if (url && [...url.searchParams.keys()].some(key => /token|secret|session|auth|password|api.?key|email|code/i.test(key))) reasons.push('URL contains a potentially private query parameter');
  if (page.statusCode !== 200 || page.fetchStatus === 'failed' || page.fetchStatus === 'blocked') reasons.push('Not a successful HTTP 200 response');
  if (!evidence) reasons.push('Indexability evidence was not retained; run a new audit');
  else {
    if (!/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(evidence.contentType)) reasons.push('Not an HTML page');
    if (/(?:^|[\s,:;])(?:noindex|none)(?:$|[\s,;])/i.test(`${evidence.metaRobots},${evidence.xRobotsTag}`)) reasons.push('Noindex directive was observed');
    if (evidence.robotsAllowed !== true) reasons.push(evidence.robotsAllowed === false ? 'Blocked by audited crawler rules' : 'Robots access was not established');
    if (evidence.redirected) reasons.push('Reached through a redirect; review the final destination');
    if (page.canonicalUrl) {
      try { if (new URL(page.canonicalUrl, page.url).href !== url?.href) reasons.push('Canonical points to another URL'); }
      catch { reasons.push('Invalid canonical URL'); }
    }
  }
  return { included: reasons.length === 0, reasons };
}

export function xmlText(value: string) { return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!); }

export function sitemapEntry(page: ResourceAuditPage, origin: string) {
  if (!sitemapEligibility(page, origin).included) return '';
  const modified = readToolEvidence(page.toolEvidence)?.lastModified;
  return `<url><loc>${xmlText(page.url)}</loc>${modified ? `<lastmod>${xmlText(modified)}</lastmod>` : ''}</url>\n`;
}

export function generateSitemap(pages: ResourceAuditPage[], origin: string) {
  if (pages.length > 100) throw new Error('Use the authorized complete export for more than 100 loaded pages.');
  const included = new Map<string, ResourceAuditPage>();
  const excluded: Array<{ url: string; reasons: string[] }> = [];
  for (const page of pages) {
    const result = sitemapEligibility(page, origin);
    if (result.included) included.set(new URL(page.url).href, page);
    else excluded.push({ url: redactToolUrl(page.url), reasons: result.reasons });
  }
  return { xml: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...included.values()].map(page => sitemapEntry(page, origin)).join('')}</urlset>`, included: included.size, excluded };
}

export function redactToolUrl(value: string) {
  try {
    const url = new URL(value); url.username = ''; url.password = '';
    for (const key of [...url.searchParams.keys()]) if (/token|secret|session|auth|password|api.?key|email|code/i.test(key)) url.searchParams.set(key, '[redacted]');
    return url.href;
  } catch { return 'Invalid URL'; }
}

export function analyzeCrawlClutter(pages: ResourceAuditPage[]) {
  if (pages.length > 100) throw new Error('Clutter analysis accepts at most 100 loaded pages.');
  const tracking = new Map<string, string[]>();
  const variants = new Map<string, string[]>();
  const depth: Record<string, number> = {};
  let sitemapDiscovery = 0;
  for (const page of pages) {
    depth[String(page.crawlDepth)] = (depth[String(page.crawlDepth)] || 0) + 1;
    if (/\.xml(?:\?|$)/i.test(page.sourceUrl || '')) sitemapDiscovery++;
    try {
      const url = new URL(page.url); url.hash = '';
      const normalized = new URL(url);
      for (const key of [...normalized.searchParams.keys()]) if (/^utm_|^(?:gclid|fbclid|msclkid|dclid)$/i.test(key)) normalized.searchParams.delete(key);
      if (normalized.href !== url.href) tracking.set(normalized.href, [...(tracking.get(normalized.href) || []), redactToolUrl(url.href)]);
      const key = `${url.origin}${url.pathname.toLowerCase().replace(/\/$/, '')}${url.search}`;
      variants.set(key, [...(variants.get(key) || []), redactToolUrl(url.href)]);
    } catch { /* Invalid historical URLs are not grouped as equivalent. */ }
  }
  return { depth, sitemapDiscovery, trackingGroups: [...tracking].slice(0, 20).map(([url, examples]) => ({ url: redactToolUrl(url), examples: [...new Set(examples)].slice(0, 5) })),
    possiblePathVariants: [...variants.values()].filter(urls => new Set(urls).size > 1).slice(0, 20).map(urls => [...new Set(urls)].slice(0, 5)) };
}
