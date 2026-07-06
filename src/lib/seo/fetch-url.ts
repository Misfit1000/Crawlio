import { parseHtml, ParsedPageData } from './html-parser';
import { auditPage, AuditResult } from './page-audit';

export async function fetchAndAnalyze(url: string) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'KeywordsIntelBot/1.0 (Local Analysis Tools)'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const parsedData = parseHtml(html, url);
    const auditResult = auditPage(url, parsedData);

    return {
      url,
      success: true,
      data: parsedData,
      audit: auditResult
    };
  } catch (error: any) {
    return {
      url,
      success: false,
      error: error.message
    };
  }
}
