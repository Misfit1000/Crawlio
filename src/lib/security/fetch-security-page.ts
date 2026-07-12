import { parseHtml } from '../seo/html-parser';
import { safePublicFetch } from './safe-public-fetch';

export async function fetchSecurityPage(url: string) {
  const startTime = Date.now();
  try {
    const response = await safePublicFetch(url, {
      timeoutMs: 10_000,
      maxBytes: 2_000_000,
      allowedContentTypes: ['text/html', 'application/xhtml+xml'],
      userAgent: 'SEOIntelBot/1.0 (Passive Security Review)',
    });
    const parsed = parseHtml(response.body, response.finalUrl);
    
    return {
      success: true,
      url,
      finalUrl: response.finalUrl,
      status: response.status,
      headers: response.headers,
      data: parsed,
      html: response.body,
    };
  } catch (error: any) {
    return {
      success: false,
      url,
      finalUrl: url,
      status: 0,
      headers: {},
      error: error.message,
      errorCode: error.code || 'REQUEST_FAILED',
    };
  }
}
