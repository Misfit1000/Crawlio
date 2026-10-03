import { cloudflarePublicFetch } from '../../../audit-core/adapters/cloudflare-network-adapter';
import { parseSitemapXml } from '../../../audit-core/sitemap';
import { normalizeCrawlUrl } from '../../../audit-core/url';

export interface SitemapUrlSampleResult {
  url: string;
  status: number;
  durationMs: number;
  healthy: boolean;
  redirectUrl?: string;
  error?: string;
}

export interface SitemapAuditResult {
  sitemapUrl: string;
  isValidXml: boolean;
  totalUrlsDiscovered: number;
  totalSitemapsDiscovered: number;
  nestedSitemaps: string[];
  sampleAuditedUrls: SitemapUrlSampleResult[];
  errors: string[];
  healthScore: number;
  summary: string;
}

export async function auditSitemap(sitemapUrl: string, sampleSize = 10): Promise<SitemapAuditResult> {
  const cleanUrl = normalizeCrawlUrl(sitemapUrl) || sitemapUrl;
  const errors: string[] = [];

  let xmlBody = '';
  try {
    const resp = await cloudflarePublicFetch(cleanUrl, {
      timeoutMs: 10_000,
      maxBytes: 3_000_000,
      allowedContentTypes: ['application/xml', 'text/xml', 'text/plain', 'application/xhtml+xml'],
    });
    if (resp.status >= 200 && resp.status < 300) {
      xmlBody = resp.body;
    } else {
      errors.push(`Failed to fetch sitemap: HTTP ${resp.status}`);
    }
  } catch (err: any) {
    errors.push(`Sitemap network error: ${err.message || 'Unknown network error'}`);
  }

  if (!xmlBody) {
    return {
      sitemapUrl: cleanUrl,
      isValidXml: false,
      totalUrlsDiscovered: 0,
      totalSitemapsDiscovered: 0,
      nestedSitemaps: [],
      sampleAuditedUrls: [],
      errors,
      healthScore: 0,
      summary: 'Sitemap could not be retrieved.',
    };
  }

  const parsed = parseSitemapXml(xmlBody);
  errors.push(...parsed.errors);

  const totalUrlsDiscovered = parsed.urls.length;
  const totalSitemapsDiscovered = parsed.sitemaps.length;

  const urlsToSample = parsed.urls.slice(0, sampleSize);
  const sampleAuditedUrls: SitemapUrlSampleResult[] = [];

  for (const sampleUrl of urlsToSample) {
    try {
      const pageResp = await cloudflarePublicFetch(sampleUrl, {
        timeoutMs: 6000,
        maxBytes: 256_000,
        maxRedirects: 2,
      });

      const isHealthy = pageResp.status >= 200 && pageResp.status < 300;
      sampleAuditedUrls.push({
        url: sampleUrl,
        status: pageResp.status,
        durationMs: pageResp.durationMs,
        healthy: isHealthy,
        redirectUrl: pageResp.redirectCount > 0 ? pageResp.finalUrl : undefined,
      });
    } catch (err: any) {
      sampleAuditedUrls.push({
        url: sampleUrl,
        status: 0,
        durationMs: 0,
        healthy: false,
        error: err.message || 'Connection failed',
      });
    }
  }

  const healthyCount = sampleAuditedUrls.filter((u) => u.healthy).length;
  const sampleRatio = sampleAuditedUrls.length > 0 ? healthyCount / sampleAuditedUrls.length : 1;
  const healthScore = errors.length > 0 ? Math.round(sampleRatio * 70) : Math.round(sampleRatio * 100);

  let summary = `Discovered ${totalUrlsDiscovered} URLs and ${totalSitemapsDiscovered} nested sitemaps.`;
  if (sampleAuditedUrls.length > 0) {
    summary += ` Sample test: ${healthyCount}/${sampleAuditedUrls.length} verified URLs reachable (Score: ${healthScore}/100).`;
  }

  return {
    sitemapUrl: cleanUrl,
    isValidXml: parsed.errors.length === 0,
    totalUrlsDiscovered,
    totalSitemapsDiscovered,
    nestedSitemaps: parsed.sitemaps,
    sampleAuditedUrls,
    errors,
    healthScore,
    summary,
  };
}
