import assert from 'node:assert/strict';
import { test } from 'node:test';
import { load } from 'cheerio';
import { applySafeBlogFixes, completeManualArticleLinks } from './editor-safe-fixes';
import { evaluateBlogQuality, inspectBlogLinks } from './quality';
import { blogRepository, mapBlogPostRow } from './repository';
import { renderBlogArticleHtml } from './render';
import { renderBlogListingHtml } from './public-render';
import { buildBlogSeoFields, truncateAtWord } from './seo';
import { canonicalSiteOrigin, renderBlogRss, renderBlogSitemap } from './sitemap';
import { prepareBlogPost } from './validation';
import type { BlogPostInput, BlogSource } from './types';

const source: BlogSource = {
  url: 'https://evidence.example/reference?topic=crawl&language=en',
  title: 'Original crawl documentation', publisher: 'Example publisher', citationStatus: 'verified',
};
const body = '<h2>Check the initial response</h2><p>Web &amp; SEO checks need readable evidence.</p>'
  + Array.from({ length: 55 }, () => '<p>Inspect the returned document and record the observed page signals.</p>').join('')
  + '<h2>Check published links</h2><p>Follow the links and compare their destinations.</p>'
  + '<h2>Verify the change</h2><p>Retest the page after correcting the documented problem.</p>';
const draft: BlogPostInput = {
  title: 'A practical guide to checking crawlable article pages',
  tagline: 'Inspect the response and verify each correction with page evidence.',
  contentHtml: body, sources: [source], status: 'draft',
};
const post = (origin: 'admin_manual' | 'autopilot' = 'admin_manual') => mapBlogPostRow({
  id: `post-${origin}`, slug: `kept-${origin.replace('_', '-')}-permalink`, title: draft.title,
  seo_title: 'Checking crawlable article pages', excerpt: 'Inspect the initial HTML, metadata, and article links using the evidence returned by the public page.',
  meta_description: 'Inspect the initial HTML, metadata, and article links using the evidence returned by the public page.',
  content_html: completeManualArticleLinks(body, [source]), content_text: 'Web & SEO checks need readable evidence.',
  status: 'published', origin, published_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
  canonical_url: 'https://unrelated.example/wrong-post', robots_directive: 'index,follow,max-image-preview:large',
  sources: [source], tags: ['SEO'], related_articles: [{ postId: 'related', slug: 'related-guide', title: 'Related crawl guide' }],
});

test('serialized citation URLs pass link presence checks without weakening source gates', () => {
  const linked = completeManualArticleLinks(body, [source]);
  assert.ok(linked.includes('topic=crawl&amp;language=en'));
  assert.ok(inspectBlogLinks(linked).some(link => link.href === source.url));
  assert.equal(completeManualArticleLinks(linked, [source]), linked, 'safe link completion is idempotent');
  const checks = evaluateBlogQuality({ ...draft, contentHtml: linked }, { requireSources: true }).checks;
  assert.equal(checks.find(check => check.id === 'source-links')?.passed, true);
  const reviewed: BlogPostInput = { ...draft, contentHtml: linked, status: 'published',
    originalityStatus: 'passed', sourceStatus: 'passed', prerenderStatus: 'passed', imageStatus: 'not_required' };
  assert.equal(prepareBlogPost(reviewed).status, 'published');
  assert.throws(() => prepareBlogPost({ ...reviewed, sourceStatus: 'pending' }), /Source verification has not passed/);
  assert.throws(() => prepareBlogPost({ ...reviewed, originalityStatus: 'blocked' }), /Originality review has not passed/);
  assert.throws(() => prepareBlogPost({ ...reviewed, contentHtml: body }), /Every stored source is hyperlinked/);
  const missing = evaluateBlogQuality({ ...draft, contentHtml: body }, { requireSources: true });
  assert.equal(missing.checks.find(check => check.id === 'source-links')?.passed, false);
  const root = { ...source, url: 'https://evidence.example/' };
  const rootLink = evaluateBlogQuality({ ...draft, sources: [root], contentHtml: `${body}<a href="https://evidence.example">Original documentation</a>` });
  assert.equal(rootLink.checks.find(check => check.id === 'source-links')?.passed, true, 'equivalent HTTP URL serialization is recognized');
});

test('safe fixes preserve existing article slugs and still generate new draft slugs', () => {
  for (const status of ['draft', 'published'] as const) {
    assert.equal(applySafeBlogFixes({ ...draft, status, slug: 'established-editorial-url' }).slug, 'established-editorial-url');
  }
  assert.ok(applySafeBlogFixes(draft).slug);
  assert.equal(applySafeBlogFixes({ ...draft, seoTitle: 'Editorial override' }, ['seoTitle']).seoTitle, 'Editorial override');
});

test('generated metadata respects its bounds and contains decoded visible text', () => {
  for (const maximum of [0, 1, 2, 3, 60, 160, 280]) assert.ok(truncateAtWord('x'.repeat(400), maximum).length <= maximum);
  const generated = buildBlogSeoFields({ title: 'x'.repeat(100), excerpt: 'y'.repeat(200) });
  assert.ok(generated.seoTitle.length <= 60);
  assert.ok(generated.metaDescription.length <= 160);
  const prepared = prepareBlogPost({ ...draft, slug: 'keep-this-slug', excerpt: '  ', seoTitle: '  ', metaDescription: '  ' });
  assert.equal(prepared.slug, 'keep-this-slug');
  assert.ok(prepared.content_text.includes('Web & SEO'));
  assert.ok(prepared.meta_description.includes('Web & SEO'));
  assert.doesNotMatch(prepared.meta_description, /&amp;/);
  assert.ok(prepared.seo_title.length >= 20);
  assert.throws(() => prepareBlogPost({ ...draft, status: 'published' }), /Publication blocked/);
  assert.throws(() => prepareBlogPost({ ...draft, status: 'published', fixtureTest: true }), /Fixture test/);
});

test('canonical site origin never falls back to request-controlled headers', () => {
  const keys = ['APP_URL', 'VERCEL_PROJECT_PRODUCTION_URL'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.APP_URL = 'https://publisher.example/configured/path';
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    const request = { headers: { host: 'injected.example', 'x-forwarded-host': 'injected.example' } };
    assert.equal(canonicalSiteOrigin(request), 'https://publisher.example');
    process.env.APP_URL = 'not-a-url';
    assert.equal(canonicalSiteOrigin(request), 'https://keywordsintel.vercel.app');
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'production.example';
    assert.equal(canonicalSiteOrigin(request), 'https://production.example');
    for (const invalid of ['javascript:alert(1)', 'ftp://wrong.example', 'https://user:password@wrong.example/']) {
      process.env.APP_URL = invalid;
      assert.equal(canonicalSiteOrigin(request), 'https://production.example');
    }
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
});

test('manual and AI article initial HTML agree with discovery URLs and schema', async context => {
  const posts = [post(), post('autopilot')];
  const origin = 'https://publisher.example';
  context.mock.method(blogRepository, 'sitemapRows', async () => posts.map(item => ({ slug: item.slug, updatedAt: item.updatedAt, imageUrl: '' })));
  context.mock.method(blogRepository, 'listPublishedTopics', async () => []);
  context.mock.method(blogRepository, 'listPublished', async () => ({ posts, total: posts.length, limit: 30, offset: 0 }));
  const sitemap = load(await renderBlogSitemap(origin), { xml: true });
  const rss = load(await renderBlogRss(origin), { xml: true });
  const listing = load(renderBlogListingHtml({ origin, posts, topics: [], total: 2, page: 1, pageSize: 10 }));
  for (const item of posts) {
    const expected = `${origin}/blog/${item.slug}`;
    const html = load(renderBlogArticleHtml(item, origin));
    assert.equal(html('link[rel="canonical"]').attr('href'), expected);
    assert.equal(html('meta[property="og:url"]').attr('content'), expected);
    assert.equal(html('h1').length, 1);
    assert.ok(html('.article-body').text().includes('Web & SEO'));
    assert.equal(html('.article-body a[href="/blog"]').length, 1);
    assert.ok(html(`a[href="/blog/related-guide"]`).length);
    const schemas = html('script[type="application/ld+json"]').toArray().map(element => JSON.parse(html(element).text()));
    assert.equal(schemas[0]['@type'], 'BlogPosting');
    assert.equal(schemas[0].mainEntityOfPage, expected);
    assert.equal(schemas[1].itemListElement.at(-1).item, expected);
    assert.ok(sitemap('loc').toArray().some(element => sitemap(element).text() === expected));
    assert.ok(rss('item link').toArray().some(element => rss(element).text() === expected));
    assert.ok(rss('item guid').toArray().some(element => rss(element).text() === expected));
    assert.ok(listing(`a[href="/blog/${item.slug}"]`).length);
    for (const privatePost of [{ ...item, status: 'draft' as const }, { ...item, fixtureTest: true }, { ...item, publishedAt: '2999-01-01T00:00:00Z' }]) {
      const privateHtml = load(renderBlogArticleHtml(privatePost, origin));
      assert.equal(privateHtml('meta[name="robots"]').attr('content'), 'noindex,nofollow');
    }
  }
});

test('default topic query includes explicit SEO guides while retaining publication filters', async context => {
  const keys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.SUPABASE_URL = 'https://blog-seo-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  const requests: URL[] = [];
  context.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(url);
    const includesExplicitDefault = url.searchParams.get('or')?.includes('topic_cluster.eq.SEO guides');
    const rows = includesExplicitDefault ? [{ ...post('autopilot'), topic_cluster: 'SEO guides', published_at: '2026-01-01T00:00:00Z' }] : [];
    return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json', 'content-range': `0-${rows.length - 1}/${rows.length}` } });
  });
  try {
    const result = await blogRepository.listPublished({ topic: 'SEO guides' });
    assert.equal(result.posts.length, 1);
    assert.equal(requests[0].searchParams.get('status'), 'eq.published');
    assert.equal(requests[0].searchParams.get('fixture_test'), 'eq.false');
    assert.equal(requests[0].searchParams.get('robots_directive'), 'like.index%');
    assert.ok(requests[0].searchParams.getAll('published_at').some(value => value.startsWith('lte.')));
    assert.ok(requests[0].searchParams.getAll('published_at').includes('not.is.null'));
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
});
