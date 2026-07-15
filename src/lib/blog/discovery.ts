import { load } from 'cheerio';
import { parsePublicHttpUrl, safePublicFetch } from '../security/safe-public-fetch';
import { classifyBlogFreshness } from './freshness';
import type { BlogTrendOpportunity } from './types';

const RELEVANT_TERMS = ['seo', 'search', 'crawl', 'index', 'canonical', 'schema', 'browser', 'security', 'performance', 'core web vitals', 'wordpress', 'shopify', 'robots', 'sitemap', 'http', 'https'];

function textValue($: ReturnType<typeof load>, element: any, selectors: string[]) {
  for (const selector of selectors) {
    const value = $(element).find(selector).first().text().replace(/\s+/g, ' ').trim();
    if (value) return value;
  }
  return '';
}

function linkValue($: ReturnType<typeof load>, element: any) {
  const textLink = $(element).find('link').first().text().trim();
  const hrefLink = $(element).find('link[href]').first().attr('href');
  return hrefLink || textLink;
}

function inferCluster(title: string) {
  const lower = title.toLowerCase();
  if (/security|https|browser protection/.test(lower)) return 'website security';
  if (/performance|core web vitals|speed/.test(lower)) return 'web performance';
  if (/schema|structured data/.test(lower)) return 'structured data';
  if (/crawl|index|robots|sitemap|canonical/.test(lower)) return 'crawlability and indexing';
  if (/wordpress|shopify/.test(lower)) return 'platform SEO';
  return 'SEO updates';
}

function relevanceFor(title: string, summary: string) {
  const haystack = `${title} ${summary}`.toLowerCase();
  const matches = RELEVANT_TERMS.filter((term) => haystack.includes(term)).length;
  return Math.min(1, 0.35 + matches * 0.13);
}

export async function discoverApprovedFeedItems(input: {
  feedUrls: string[];
  existingTitles?: string[];
  now?: Date;
}) {
  const now = input.now || new Date();
  const existing = new Set((input.existingTitles || []).map((title) => title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()));
  const opportunities: BlogTrendOpportunity[] = [];

  for (const feedUrl of [...new Set(input.feedUrls)].slice(0, 20)) {
    const response = await safePublicFetch(feedUrl, {
      timeoutMs: 8_000,
      maxRedirects: 3,
      maxBytes: 1_500_000,
      allowedContentTypes: ['application/rss+xml', 'application/atom+xml', 'application/xml', 'text/xml', 'text/rss+xml'],
      userAgent: 'CrawlioEditorialBot/1.0 (+https://keywordsintel.vercel.app/)',
    });
    if (response.status < 200 || response.status >= 300) continue;
    const $ = load(response.body, { xmlMode: true });
    const publisher = $('channel > title').first().text().trim() || $('feed > title').first().text().trim() || new URL(response.finalUrl).hostname;
    const entries = $('item,entry').toArray().slice(0, 30);
    for (const entry of entries) {
      const title = textValue($, entry, ['title']);
      const sourceUrl = linkValue($, entry);
      const publishedText = textValue($, entry, ['pubDate', 'published', 'updated']);
      const updatedText = textValue($, entry, ['updated']);
      const summary = textValue($, entry, ['description', 'summary', 'content']);
      const author = textValue($, entry, ['dc\\:creator', 'author > name', 'author']);
      const publishedAt = new Date(publishedText);
      if (!title || !sourceUrl || Number.isNaN(publishedAt.getTime())) continue;
      const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const relevance = relevanceFor(title, summary);
      let normalizedSourceUrl: string;
      try { normalizedSourceUrl = parsePublicHttpUrl(new URL(sourceUrl, response.finalUrl).toString()).toString(); } catch { continue; }
      const feedHost = new URL(response.finalUrl).hostname.replace(/^www\./, '');
      const itemHost = new URL(normalizedSourceUrl).hostname.replace(/^www\./, '');
      const primarySource = itemHost === feedHost || itemHost.endsWith(`.${feedHost}`) || feedHost.endsWith(`.${itemHost}`);
      const opportunity: BlogTrendOpportunity = {
        sourceUrl: normalizedSourceUrl,
        sourceTitle: title.slice(0, 300),
        publisher: publisher.slice(0, 160),
        author: author.slice(0, 160),
        summary: summary.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000),
        publishedAt: publishedAt.toISOString(),
        updatedAt: updatedText && !Number.isNaN(new Date(updatedText).getTime()) ? new Date(updatedText).toISOString() : null,
        discoveredAt: now.toISOString(),
        topicCluster: inferCluster(title),
        searchIntent: `${inferCluster(title)} update`,
        proposedAngle: `Explain what changed, who is affected, how to verify it, and which practical actions are justified by the source.`,
        audienceRelevance: relevance,
        sourceAuthority: primarySource ? 0.9 : 0.7,
        novelty: existing.has(normalizedTitle) ? 0.1 : 0.85,
        primarySource,
        existingCoverage: existing.has(normalizedTitle),
      };
      const freshness = classifyBlogFreshness(opportunity, now);
      opportunity.freshnessStatus = freshness.status;
      opportunity.ageHours = freshness.ageHours;
      opportunity.priorityReason = freshness.reason;
      opportunity.expiresAt = freshness.expiresAt;
      opportunities.push(opportunity);
    }
  }
  return opportunities;
}
