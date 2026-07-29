import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildBlogReadiness, deriveAutomaticBlogFields } from '../src/lib/blog/editor-experience';
import { applySafeBlogFixes, completeManualArticleLinks } from '../src/lib/blog/editor-safe-fixes';
import type { BlogPostInput, BlogSource } from '../src/lib/blog/types';

const source: BlogSource = {
  url: 'https://developers.google.com/search/blog/example-update',
  title: 'Official search documentation update',
  publisher: 'Google Search Central',
  citationStatus: 'verified',
};

const article: BlogPostInput = {
  title: 'How to review a technical SEO update',
  contentHtml: '<h2>What changed</h2><p>This practical explanation helps website owners understand a documented search update and decide what to inspect.</p><h2>What to check</h2><p>Review crawl access, page titles, internal links, and affected templates before changing production pages.</p><h2>Next steps</h2><p>Record the evidence, test the change, and compare the next website audit.</p>',
  sources: [source],
  status: 'draft',
};

const automatic = deriveAutomaticBlogFields(article);
assert.match(automatic.slug, /^how-to-review-a-technical-seo-update/);
assert.ok(automatic.excerpt.length > 60);
assert.ok(automatic.metaDescription.length > 70);
assert.ok(automatic.tags.includes('SEO'));
assert.deepEqual(deriveAutomaticBlogFields({ title: '', contentHtml: '' }), {
  slug: '', excerpt: '', tagline: '', summary: '', focusKeyword: '', tags: [], topicCluster: '', seoTitle: '', metaDescription: '',
});

const linked = completeManualArticleLinks(article.contentHtml || '', [source]);
assert.match(linked, /href="https:\/\/developers\.google\.com\/search\/blog\/example-update"/);
assert.match(linked, /href="\/blog"/);
assert.match(linked, /href="\/#start-audit"/);
assert.equal(completeManualArticleLinks(linked, [source]), linked, 'safe link completion must be idempotent');

const fixed = applySafeBlogFixes(article);
assert.equal(fixed.slug, automatic.slug);
assert.equal(fixed.metaDescription, automatic.metaDescription);
assert.ok(buildBlogReadiness(fixed).every((item) => typeof item.fixableAutomatically === 'boolean' && 'fixAction' in item));
const overridden = applySafeBlogFixes({ ...article, slug: 'custom-editorial-url' }, ['slug']);
assert.equal(overridden.slug, 'custom-editorial-url', 'manual overrides must not be replaced');

const migration = readFileSync('supabase/migrations/020_blog_editor_experience.sql', 'utf8');
assert.match(migration, /create table if not exists public\.blog_editor_drafts/);
assert.match(migration, /create table if not exists public\.blog_admin_notifications/);
assert.equal((migration.match(/enable row level security/g) || []).length, 2);
assert.match(migration, /revoke all on public\.blog_editor_drafts from anon, authenticated/);
assert.match(migration, /revoke all on public\.blog_admin_notifications from anon, authenticated/);
assert.doesNotMatch(migration, /create policy/i);

const api = readFileSync('src/api/index.ts', 'utf8');
const client = readFileSync('src/lib/blog/client.ts', 'utf8');
const start = readFileSync('src/components/blog/BlogStudioStart.tsx', 'utf8');
const editor = readFileSync('src/components/blog/BlogManualEditor.tsx', 'utf8');
const inbox = readFileSync('src/components/blog/BlogNotificationInbox.tsx', 'utf8');
const workflow = readFileSync('src/lib/blog/server/vercel-workflow.ts', 'utf8');

assert.match(start, /Publish latest SEO update/);
assert.match(start, /Create from a source/);
assert.match(start, /Write manually/);
assert.match(editor, /\['write', 'Write'\].*\['review', 'Review'\].*\['publish', 'Publish'\]/s);
assert.match(editor, /Fix safe issues automatically/);
assert.match(editor, /Needs your attention/);
assert.match(editor, /Fixed automatically/);
assert.match(editor, /Ready checks and recommendations/);
assert.match(editor, /post\?\.publishedAt \|\| new Date\(\)\.toISOString\(\)/);
assert.match(editor, /Private editor draft saved\. The published article has not changed\./);
assert.match(editor, /Save private draft/);
assert.match(client, /expectedUpdatedAt/);
assert.match(api, /BLOG_POST_EDIT_CONFLICT/);
assert.match(api, /mode === 'one_click_source'/);
assert.match(api, /requireAdminRequester\(req, res\)/);
assert.match(client, /adminBlogEditorDraft/);
assert.match(inbox, /Mark all read/);
assert.match(workflow, /blog_needs_attention/);
assert.match(workflow, /blog_published/);
assert.match(workflow, /blog_failed/);
assert.match(workflow, /recovered\.status === 'published' \? 'published'/);
assert.match(workflow, /createNotification\([\s\S]*?\)\.catch\(\(\) => undefined\)/);
assert.doesNotMatch(`${start}\n${editor}\n${inbox}\n${client}`, /SUPABASE_SERVICE_ROLE_KEY|GROQ_API_KEY/);

console.log('Blog editor experience smoke test passed: workflows, automatic fields, safe fixes, autosave boundaries, notifications, migration security, and stale-edit protection verified.');
