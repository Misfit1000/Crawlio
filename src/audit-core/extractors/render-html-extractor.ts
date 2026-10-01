import { parseHtml } from '../../lib/seo/html-parser';
import { PageEvidence } from './cloudflare-html-extractor';

export async function extractWithRender(
  response: Response,
  input: {
    url: string;
    finalUrl: string;
    statusCode: number;
    responseTimeMs: number;
    pageSizeBytes: number;
    contentType: string;
    headers: Record<string, string>;
    depth: number;
    source: string;
  }
): Promise<PageEvidence> {
  const html = await response.text();
  const parsedPageData = parseHtml(html, input.finalUrl);

  return {
    ...parsedPageData,
    url: input.url,
    finalUrl: input.finalUrl,
    statusCode: input.statusCode,
    responseTimeMs: input.responseTimeMs,
    pageSizeBytes: input.pageSizeBytes,
    contentType: input.contentType,
    headers: input.headers,
    depth: input.depth,
    source: input.source,
  };
}
