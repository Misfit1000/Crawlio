import { safePublicFetch, type SafePublicFetchOptions } from '../security/safe-public-fetch';

export async function fetchSitemap(url: string, options: SafePublicFetchOptions = {}) {
  try {
    const response = await safePublicFetch(url, {
      ...options,
      timeoutMs: options.timeoutMs ?? 10_000,
      maxBytes: Math.min(options.maxBytes ?? 2_000_000, 2_000_000),
      allowedContentTypes: ['application/xml', 'text/xml', 'text/plain', 'application/xhtml+xml'],
    });
    if (response.status < 200 || response.status >= 300) return { urls: [], errors: [`HTTP ${response.status}`] };
    return parseSitemapXml(response.body);
  } catch(e: any) {
    return { urls: [], errors: [e.message] };
  }
}

function parseSitemapXml(xml: string) {
  const urls: string[] = [];
  const errors: string[] = [];
  
  if (!xml.includes('<?xml')) {
    errors.push('Invalid XML format');
  }
  
  const locRegex = /<loc>(.*?)<\/loc>/g;
  let match;
  while ((match = locRegex.exec(xml)) !== null) {
    if (match[1] && match[1].startsWith('http')) {
      urls.push(match[1]);
    }
  }
  return { urls, errors };
}
