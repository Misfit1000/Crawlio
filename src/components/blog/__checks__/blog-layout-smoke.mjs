import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const now = new Date().toISOString();
const post = {
  id: 'editorial-draft', title: 'A practical crawlability field guide', slug: 'crawlability-field-guide',
  excerpt: 'A measured approach to inspecting crawl evidence and prioritizing technical fixes.',
  tagline: 'Inspect the evidence before changing your website.', summary: '',
  contentHtml: '<h2>Inspect crawl evidence</h2><p>Start with your crawl report and check the affected pages.</p><h2>Prioritize fixes</h2><p>Verify the result after each change.</p>',
  focusKeyword: 'crawlability', tags: ['Technical SEO'], seoTitle: 'A practical crawlability field guide',
  metaDescription: 'Inspect crawl evidence and prioritize technical fixes with a measured workflow.',
  canonicalUrl: '', ogImageUrl: '', ogImageAlt: '', ogImageAttribution: '', imageVariants: [],
  status: 'draft', origin: 'admin_manual', articleType: 'evergreen_guide', topicCluster: 'technical-seo',
  sources: [{ url: 'https://developers.google.com/search/docs', title: 'Search documentation', publisher: 'Google', citationStatus: 'verified' }],
  relatedArticles: [], generationJobId: null, batchId: null, qualityResults: null, qualityStatus: 'pending',
  originalityStatus: 'pending', sourceStatus: 'pending', prerenderStatus: 'pending', imageStatus: 'not_required',
  publishedAt: now, scheduledAt: null, updatedAt: now, createdAt: now, readingTimeMinutes: 4, fixtureTest: false,
};
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from '/src/app/router.tsx';import Admin from '/src/components/AdminDashboard.tsx';import Index from '/src/components/blog/BlogIndex.tsx';import Post from '/src/components/blog/BlogPostPage.tsx';import '/src/index.css';const view=location.pathname.startsWith('/admin')?React.createElement('main',{style:{maxWidth:1200,margin:'0 auto',padding:16,minWidth:0}},React.createElement(Admin)):location.pathname==='/blog'?React.createElement(Index):React.createElement(Post,{slug:'crawlability-field-guide'});createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter,null,view));`;
const fixtures = {
  name: 'blog-layout-fixtures', enforce: 'pre',
  resolveId(source) {
    if (source.endsWith('/contexts/AuthContext')) return '\0layout-auth';
    if (source.endsWith('/api/auth-headers')) return '\0layout-headers';
    if (source.endsWith('/supabase/client')) return '\0layout-realtime';
    if (source === '/__blog_layout.jsx') return '\0layout-entry.jsx';
  },
  load(id) {
    if (id === '\0layout-auth') return `export function useAuth(){return {user:{id:'test-admin',role:'admin'}}}`;
    if (id === '\0layout-headers') return 'export async function getAuthHeaders(base={}){return base}';
    if (id === '\0layout-realtime') return 'export function getSupabaseBrowserClient(){return null}';
    if (id === '\0layout-entry.jsx') return entry;
  },
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!/^\/(admin\/blog|blog)(\/|\?|$)/.test(req.url || '')) return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(await server.transformIndexHtml(req.url, '<html lang="en"><head><title>Blog layout check</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__blog_layout.jsx"></script></body></html>'));
    });
  },
};
const server = await createServer({
  configFile: false, cacheDir: 'node_modules/.vite-blog-layout-check',
  resolve: { dedupe: ['react', 'react-dom'] },
  optimizeDeps: { entries: [], include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'lucide-react', '@tiptap/react', '@tiptap/starter-kit'] },
  plugins: [fixtures, react(), tailwindcss()],
  define: { __CRAWLIO_RELEASE__: '"blog-layout-check"', __CRAWLIO_ENVIRONMENT__: '"test"' },
  server: { host: '127.0.0.1', port: 5196, hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error',
});
let browser;
let publicImage = false;
let publicEmpty = false;
const writes = [];
const errors = [];
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/tools/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/tools/', '');
    const method = route.request().method();
    let data;
    if (method !== 'GET') writes.push({ path, body: route.request().postDataJSON() });
    if (path === 'admin/blog/posts') data = { posts: [post] };
    else if (path === 'admin/blog/notifications') data = { notifications: [{ id: 'alert', title: 'Draft ready for review', message: 'Review the article before publishing.', linkPath: '/admin/blog?articleId=editorial-draft', readAt: null, createdAt: now }] };
    else if (path === 'admin/blog/notifications/read') data = { updated: true };
    else if (path === 'admin/blog/overview') data = { jobs: [], discoveries: [], overview: {}, provider: { configured: false, enabled: false }, runtime: { generationAllowed: false, dispatchConfigured: false, blockers: [] } };
    else if (path === 'admin/blog/editor-draft') data = { draft: method === 'GET' ? null : { version: writes.length } };
    else if (path === 'admin/blog/posts/editorial-draft/section-revisions') data = { revisions: [] };
    else if (path === 'blog/posts') data = { posts: publicEmpty ? [] : [{ ...post, status: 'published', ogImageUrl: publicImage ? '/__article-image.png' : '' }], total: publicEmpty ? 0 : 1, topics: [{ name: 'Technical SEO', slug: 'technical-seo', articleCount: 1 }] };
    else if (path === 'blog/posts/crawlability-field-guide') data = { post: { ...post, status: 'published', ogImageUrl: publicImage ? '/__article-image.png' : '' } };
    else throw new Error(`Unexpected fixture request: ${method} ${path}`);
    await route.fulfill({ json: { success: true, data } });
  });
  await page.route('**/__article-image.png', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1EAAAAASUVORK5CYII=', 'base64') }));
  const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
  const layout = async () => {
    await expect(page.locator('h1')).toHaveCount(1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No page-level horizontal overflow');
  };
  await page.goto(`${origin}/admin/blog`);
  await expect(page.getByRole('heading', { name: 'Write manually', exact: true })).toBeVisible();
  await layout();
  await page.screenshot({ path: 'test-results/blog-studio-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await layout();
  await page.screenshot({ path: 'test-results/blog-studio-mobile.png', fullPage: true });
  await page.getByRole('button', { name: /Blog notifications/ }).click();
  await layout();
  await page.getByRole('button', { name: /Draft ready for review/ }).click();
  await expect(page.getByRole('heading', { name: `Edit ${post.title}`, exact: true })).toBeVisible();
  assert.equal(writes.at(-1).path, 'admin/blog/notifications/read');
  await expect(page.getByRole('toolbar', { name: 'Rich text formatting' })).toBeVisible();
  for (const name of ['Undo', 'Redo', 'Bold', 'Italic', 'Underline', 'Strike', 'Heading 2', 'Heading 3', 'Bullet list', 'Numbered list', 'Quote', 'Code block', 'Add or edit link', 'Remove link']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await page.getByLabel('Article title', { exact: true }).fill('A revised crawlability field guide');
  await page.getByRole('button', { name: 'Review article', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Article preview', exact: true })).toBeVisible();
  assert.equal(writes.at(-1).path, 'admin/blog/editor-draft');
  assert.equal(writes.at(-1).body.payload.title, 'A revised crawlability field guide');
  await layout();
  await page.getByText('Advanced options', { exact: false }).click();
  await expect(page.getByRole('button', { name: 'Verify and import', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add record', exact: true })).toBeVisible();
  await layout();
  await page.getByRole('button', { name: 'Continue to publish', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Publish now', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Schedule', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save private draft', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Archive', exact: true })).toBeVisible();
  await layout();
  await page.screenshot({ path: 'test-results/blog-publish-mobile.png', fullPage: true });
  assert.equal(writes.filter(item => item.path === 'admin/blog/posts/editorial-draft').length, 0, 'Review navigation never publishes an article');
  await page.goto(`${origin}/blog`);
  await expect(page.getByRole('heading', { name: post.title, exact: true })).toBeVisible();
  await layout();
  await expect(page.locator('.blog-article-card img')).toHaveCount(0);
  await expect(page.locator('main footer')).toHaveCount(0);
  const feeds = page.getByRole('navigation', { name: 'Article feeds' });
  await expect(feeds.getByRole('link', { name: 'Sitemap', exact: true })).toHaveAttribute('href', '/sitemap.xml');
  await expect(feeds.getByRole('link', { name: 'RSS', exact: true })).toHaveAttribute('href', '/rss.xml');
  assert.equal(await page.getByRole('navigation', { name: 'Article topics' }).getByRole('link').evaluateAll(nodes => nodes.every(node => node.getBoundingClientRect().height >= 44)), true, 'Topic links have 44px tap targets');
  assert.equal(await page.locator('.blog-article-card').evaluate(node => node.children.length), 1, 'No empty image placeholder');
  await page.screenshot({ path: 'test-results/blog-index-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: 'test-results/blog-index-desktop.png', fullPage: true });
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  assert.deepEqual(accessibility.violations.map(item => item.id), [], 'Public index WCAG A/AA');
  publicImage = true;
  await page.reload();
  await expect(page.locator('.blog-article-card img')).toBeVisible();
  await expect.poll(() => page.locator('.blog-article-card img').evaluate(node => node.naturalWidth)).toBeGreaterThan(0);
  await layout();
  await page.goto(`${origin}/blog/crawlability-field-guide`);
  await expect(page.locator('article figure img')).toBeVisible();
  await expect.poll(() => page.locator('article figure img').evaluate(node => node.naturalWidth)).toBeGreaterThan(0);
  await layout();
  publicImage = false;
  await page.reload();
  await expect(page.getByRole('heading', { name: post.title, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sources and references' })).toBeVisible();
  await expect(page.locator('article figure')).toHaveCount(0);
  await layout();
  assert.ok(await page.locator('.blog-reading').evaluate(node => node.getBoundingClientRect().width) <= 800, 'Reading measure stays constrained');
  await page.screenshot({ path: 'test-results/blog-article-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await layout();
  await page.screenshot({ path: 'test-results/blog-article-mobile.png', fullPage: true });
  publicEmpty = true;
  await page.goto(`${origin}/blog`);
  await expect(page.getByRole('heading', { name: 'No published articles found' })).toBeVisible();
  await layout();
  assert.deepEqual(errors, [], 'No UI runtime errors');
  console.log('PASS: single H1, three creation workflows, notification-to-editor navigation, rich tools, draft autosave on review, advanced fields, publish/schedule gates, no implicit publication, editorial image/no-image/empty states, reading measure, WCAG and mobile overflow.');
} finally { await browser?.close(); await server.close(); }
