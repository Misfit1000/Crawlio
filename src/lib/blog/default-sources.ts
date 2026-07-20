export const DEFAULT_BLOG_FEED_URLS = [
  'https://feeds.feedburner.com/blogspot/amDG',
  'https://developers.google.com/crawling/docs/changelog/crawling_docs_updates.rss',
  'https://web.dev/feed.xml',
] as const;

export function resolvedBlogFeedUrls(configured: unknown) {
  const supplied = Array.isArray(configured) ? configured.map(String) : [];
  return [...new Set([...supplied, ...DEFAULT_BLOG_FEED_URLS])]
    .filter((value) => {
      try {
        return new URL(value).protocol === 'https:';
      } catch {
        return false;
      }
    })
    .slice(0, 20);
}
