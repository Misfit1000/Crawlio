import { inspectBlogLinks } from './quality';
import type { BlogPost } from './types';

export function buildEditorialRecords(post: BlogPost) {
  const sources = new Map<string, Record<string, unknown>>();
  for (const source of post.sources) {
    const existing = sources.get(source.url);
    if (existing) {
      existing.supported_claims = [...new Set([
        ...(existing.supported_claims as string[]), ...(source.supportedClaims || []),
      ])];
      existing.primary_source = Boolean(existing.primary_source || source.primary);
      continue;
    }
    sources.set(source.url, {
      url: source.url, title: source.title, publisher: source.publisher, author: source.author || '',
      published_at: source.publishedAt || null, updated_at_source: source.updatedAt || null,
      accessed_at: source.accessedAt || post.updatedAt, source_type: source.sourceType || 'reference',
      supported_claims: source.supportedClaims || [], primary_source: Boolean(source.primary),
      reliability: source.reliability || 'unverified', citation_status: source.citationStatus || 'needs_review',
    });
  }
  const links = new Map<string, { href: string; anchor_text: string; link_type: string }>();
  for (const link of inspectBlogLinks(post.contentHtml)) {
    const key = JSON.stringify([link.href, link.anchor]);
    links.set(key, { href: link.href, anchor_text: link.anchor, link_type: /^https?:\/\//i.test(link.href) ? 'external' : 'internal' });
  }
  for (const related of post.relatedArticles) {
    const href = `/blog/${related.slug}`;
    links.set(JSON.stringify([href, related.title]), { href, anchor_text: related.title, link_type: 'related' });
  }
  if (sources.size > 30 || links.size > 1000) throw new Error('Article evidence exceeds the supported source or link limit.');
  return { sources: [...sources.values()], links: [...links.values()] };
}
