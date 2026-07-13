import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildBlogSeoFields } from '../src/lib/blog/seo';
import { sanitizeBlogHtml } from '../src/lib/blog/sanitize';
import { createBlogSlug, normalizeBlogSlug } from '../src/lib/blog/slug';
import { prepareBlogPost } from '../src/lib/blog/validation';

assert.equal(createBlogSlug('  Technical SEO: A Practical Guide!  '), 'technical-seo-a-practical-guide');
assert.equal(normalizeBlogSlug('../../Unsafe Slug'), 'unsafe-slug');
assert.match(createBlogSlug('SEO audit'), /^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const sanitized = sanitizeBlogHtml('<h2>Safe</h2><script>alert(1)</script><p onclick="bad()">Text <a href="javascript:alert(1)">link</a></p>');
assert.match(sanitized, /<h2>Safe<\/h2>/);
assert.equal(/script|onclick|javascript:/i.test(sanitized), false, 'unsafe blog markup was not removed');

const sourceUrl = 'https://developers.google.com/search/docs/crawling-indexing/overview';
const articleParagraphs = Array.from({ length: 130 }, (_, index) => `<p>Review step ${index + 1} connects observable website evidence with a practical correction and verification method.</p>`);
const content = `<h2>Collect crawl evidence</h2>${articleParagraphs.slice(0, 44).join('')}<p>Consult the <a href="${sourceUrl}">official crawling documentation</a>.</p><h2>Prioritize corrections</h2>${articleParagraphs.slice(44, 88).join('')}<p>Run a <a href="/#start-audit">website audit</a> and review <a href="/blog">related SEO guidance</a>.</p><h2>Verify the result</h2>${articleParagraphs.slice(88).join('')}`;
const prepared = prepareBlogPost({
  title: 'A Practical Technical SEO Audit Guide', tagline: 'A repeatable process for turning public crawl evidence into verified website corrections.',
  excerpt: 'Use this practical technical SEO audit guide to collect website evidence, prioritize corrections, and verify each result clearly.',
  contentHtml: content, status: 'published', seoTitle: 'A Practical Technical SEO Audit Guide',
  metaDescription: 'Learn a practical technical SEO audit process for collecting crawl evidence, prioritizing website corrections, and verifying the final result.',
  sources: [{ url: sourceUrl, title: 'Crawling and indexing overview', publisher: 'Google Search Central', citationStatus: 'verified' }],
  originalityStatus: 'passed', sourceStatus: 'passed', prerenderStatus: 'passed', imageStatus: 'not_required',
});
assert.equal(prepared.status, 'published');
assert.ok(prepared.published_at);
assert.ok(prepared.meta_description.length >= 70);
assert.ok(prepared.slug.length <= 120);

const seo = buildBlogSeoFields({ title: 'Website Audit Checklist', contentText: content, focusKeyword: 'website audit checklist' });
assert.ok(seo.seoTitle.length <= 60);
assert.ok(seo.metaDescription.length <= 160);

const migration = readFileSync(resolve('supabase/migrations/007_blog_cms.sql'), 'utf8');
for (const requirement of [
  /create table if not exists public\.blog_posts/i,
  /enable row level security/i,
  /published blog posts are public/i,
  /admins can manage blog posts/i,
  /using gin \(search_vector\)/i,
]) assert.match(migration, requirement);

const automationMigration = readFileSync(resolve('supabase/migrations/012_blog_automation_platform.sql'), 'utf8');
for (const requirement of [/blog_generation_jobs/i, /blog_trend_discoveries/i, /blog_sources/i, /blog_quality_results/i, /claim_blog_generation_job/i, /enable row level security/i]) assert.match(automationMigration, requirement);

const envExample = readFileSync(resolve('.env.example'), 'utf8');
assert.match(envExample, /^NVIDIA_API_KEY=$/m);
assert.match(envExample, /^NVIDIA_BLOG_MODEL=qwen\/qwen3\.5-122b-a10b$/m);
assert.equal(/VITE_NVIDIA/i.test(envExample), false, 'NVIDIA key must never use a VITE_ prefix');

const browserSources = [
  resolve('src/App.tsx'),
  resolve('src/components/blog/BlogAdmin.tsx'),
  resolve('src/components/blog/BlogIndex.tsx'),
  resolve('src/components/blog/BlogPostPage.tsx'),
].map((file) => readFileSync(file, 'utf8')).join('\n');
assert.equal(/NVIDIA_API_KEY|GEMINI_API_KEY|SUPABASE_SERVICE_ROLE_KEY/.test(browserSources), false, 'server-only keys are referenced by browser code');

console.log('Blog CMS smoke test passed: slugs, sanitization, SEO defaults, RLS migration, and key boundaries verified.');
