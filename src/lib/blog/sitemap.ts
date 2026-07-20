import { blogRepository } from './repository';
import { BRAND } from '../brand';

function escapeXml(value: string) {
  return value.replace(/[<>&'"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[character] || character));
}

export function canonicalSiteOrigin(req?: any) {
  const configured = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  const fallback = 'https://keywordsintel.vercel.app';
  try {
    const url = new URL(configured || fallback);
    return `${url.protocol}//${url.host}`;
  } catch {
    const forwardedHost = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '');
    return /^[a-z0-9.-]+(?::\d+)?$/i.test(forwardedHost) ? `https://${forwardedHost}` : fallback;
  }
}

export async function renderBlogSitemap(origin: string) {
  const [posts, topics] = await Promise.all([
    blogRepository.sitemapRows(),
    blogRepository.listPublishedTopics(),
  ]);
  const urls = [
    { loc: `${origin}/`, changefreq: 'weekly', priority: '1.0', lastmod: null },
    { loc: `${origin}/blog`, changefreq: 'weekly', priority: '0.8', lastmod: null },
    { loc: `${origin}/privacy`, changefreq: 'yearly', priority: '0.3', lastmod: null },
    { loc: `${origin}/terms`, changefreq: 'yearly', priority: '0.3', lastmod: null },
    { loc: `${origin}/acceptable-use`, changefreq: 'yearly', priority: '0.3', lastmod: null },
    { loc: `${origin}/cookies`, changefreq: 'yearly', priority: '0.2', lastmod: null },
    { loc: `${origin}/contact`, changefreq: 'yearly', priority: '0.4', lastmod: null },
    ...topics.map((topic) => ({ loc: `${origin}/blog/topic/${encodeURIComponent(topic.slug)}`, changefreq: 'weekly', priority: '0.6', lastmod: topic.latestPublishedAt })),
    ...posts.map((post) => ({ loc: `${origin}/blog/${encodeURIComponent(post.slug)}`, changefreq: 'monthly', priority: '0.7', lastmod: post.updatedAt, imageUrl: post.imageUrl })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${urls.map((url) => `  <url>\n    <loc>${escapeXml(url.loc)}</loc>${url.lastmod ? `\n    <lastmod>${escapeXml(new Date(url.lastmod).toISOString())}</lastmod>` : ''}${'imageUrl' in url && url.imageUrl ? `\n    <image:image><image:loc>${escapeXml(String(url.imageUrl))}</image:loc></image:image>` : ''}\n    <changefreq>${url.changefreq}</changefreq>\n    <priority>${url.priority}</priority>\n  </url>`).join('\n')}\n</urlset>\n`;
}

export async function renderBlogRss(origin: string) {
  const result = await blogRepository.listPublished({ limit: 30, offset: 0 });
  const items = result.posts.map((post) => `  <item>
    <title>${escapeXml(post.title)}</title>
    <link>${escapeXml(`${origin}/blog/${encodeURIComponent(post.slug)}`)}</link>
    <guid isPermaLink="true">${escapeXml(`${origin}/blog/${encodeURIComponent(post.slug)}`)}</guid>
    <description>${escapeXml(post.excerpt)}</description>
    ${post.publishedAt ? `<pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate>` : ''}
  </item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${BRAND.name} Blog</title><link>${escapeXml(`${origin}/blog`)}</link><description>Practical SEO, website health, and passive security guidance.</description><language>en</language><generator>${BRAND.name}</generator>${items}</channel></rss>\n`;
}

export async function renderBlogNewsSitemap(origin: string) {
  const result = await blogRepository.listPublished({ limit: 100, offset: 0 });
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const posts = result.posts.filter((post) => post.publishedAt && new Date(post.publishedAt).getTime() >= cutoff && post.freshnessStatus === 'high');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n${posts.map((post) => `  <url><loc>${escapeXml(`${origin}/blog/${encodeURIComponent(post.slug)}`)}</loc><news:news><news:publication><news:name>${BRAND.name}</news:name><news:language>${escapeXml(post.language || 'en')}</news:language></news:publication><news:publication_date>${escapeXml(post.publishedAt || '')}</news:publication_date><news:title>${escapeXml(post.title)}</news:title></news:news></url>`).join('\n')}\n</urlset>\n`;
}
