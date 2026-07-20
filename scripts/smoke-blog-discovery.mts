import assert from 'node:assert/strict';
import { mapBlogPostRow } from '../src/lib/blog/repository';
import { renderBlogListingHtml } from '../src/lib/blog/public-render';
import { buildBlogTopics } from '../src/lib/blog/publication';
import { renderBlogArticleHtml } from '../src/lib/blog/render';

const now = '2026-07-20T09:00:00.000Z';
const post = mapBlogPostRow({
  id: 'article-1',
  slug: 'technical-seo-audit-guide',
  title: 'A Practical Technical SEO Audit Guide',
  excerpt: 'Learn how to collect crawl evidence, prioritize fixes, and verify website changes without relying on fabricated ranking data.',
  tagline: 'A repeatable process for website teams.',
  summary: 'Collect evidence, prioritize corrections, and verify the result.',
  content_html: '<h2>Collect evidence</h2><p>Review crawl access and page signals.</p>',
  content_text: 'Collect evidence Review crawl access and page signals.',
  focus_keyword: 'technical seo audit',
  tags: ['technical SEO', 'website audit'],
  seo_title: 'Technical SEO Audit Guide | Crawlio',
  meta_description: 'Learn a practical technical SEO audit process for collecting crawl evidence, prioritizing corrections, and verifying website changes.',
  canonical_url: '',
  og_image_url: 'https://images.example.com/technical-seo.jpg',
  og_title: 'A Practical Technical SEO Audit Guide',
  og_description: 'A practical guide to technical SEO audit evidence.',
  og_image_alt: 'Technical SEO audit report',
  og_image_attribution: 'Licensed example image',
  responsive_images: [],
  status: 'published',
  origin: 'admin_manual',
  article_type: 'evergreen_guide',
  topic_cluster: 'Technical SEO',
  language: 'en',
  robots_directive: 'index,follow,max-image-preview:large',
  freshness_status: 'evergreen',
  quality_status: 'passed',
  originality_status: 'passed',
  source_status: 'passed',
  prerender_status: 'passed',
  image_status: 'passed',
  sources: [{ url: 'https://developers.google.com/search/docs/crawling-indexing/overview', title: 'Crawling and indexing overview', publisher: 'Google Search Central' }],
  related_articles: [],
  published_at: now,
  created_at: now,
  updated_at: now,
  fixture_test: false,
});

const topics = buildBlogTopics([post]);
assert.deepEqual(topics.map((topic) => [topic.name, topic.slug, topic.articleCount]), [['Technical SEO', 'technical-seo', 1]]);

const listing = renderBlogListingHtml({
  origin: 'https://crawlio.example',
  posts: [post],
  topics,
  total: 1,
  page: 1,
  pageSize: 10,
});
assert.match(listing, /<h1>Useful guidance for healthier websites<\/h1>/);
assert.match(listing, /\/blog\/technical-seo-audit-guide/);
assert.match(listing, /\/blog\/topic\/technical-seo/);
assert.match(listing, /"@type":"CollectionPage"/);
assert.match(listing, /application\/rss\+xml/);
assert.match(listing, /max-image-preview:large/);

const searchListing = renderBlogListingHtml({
  origin: 'https://crawlio.example',
  posts: [post],
  topics,
  total: 1,
  page: 1,
  pageSize: 10,
  query: 'crawl evidence',
});
assert.match(searchListing, /name="robots" content="noindex,follow"/);

const article = renderBlogArticleHtml(post, 'https://crawlio.example');
for (const requirement of [
  /"@type":"BlogPosting"/,
  /article:published_time/,
  /article:modified_time/,
  /og:site_name/,
  /twitter:title/,
  /\/blog\/topic\/technical-seo/,
  /Checked for source links, structure, originality signals, and practical value/,
  /Start free audit/,
]) assert.match(article, requirement);
assert.doesNotMatch(listing + article, /GROQ_API_KEY|SUPABASE_SERVICE_ROLE_KEY|fixture test/i);

console.log('Blog discovery smoke test passed: crawlable collection, topic hubs, article metadata, editorial trust, and search noindex behavior verified.');
