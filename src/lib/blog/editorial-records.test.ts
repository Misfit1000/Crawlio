import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildEditorialRecords } from './editorial-records';
import { blogRepository, mapBlogPostRow } from './repository';
import { safeApiError } from '../api/errors';
import { BlogValidationError } from './validation';

test('repeated body links and related links obey the real database identity', () => {
  const post = mapBlogPostRow({ id: 'example', updated_at: '2026-10-03T00:00:00Z',
    content_html: '<a href="/blog/guide">Guide title</a><a href="/blog/guide">Guide title</a>'
      + '<a href="/blog/guide">Different anchor</a><a href="https://example.com/?a=1&amp;b=2">Source title</a>',
    related_articles: [{ postId: 'guide', slug: 'guide', title: 'Guide title' }, { postId: 'guide', slug: 'guide', title: 'Guide title' }] });
  const records = buildEditorialRecords(post);
  assert.equal(records.links.length, 3);
  assert.equal(records.links.find(link => link.anchor_text === 'Guide title')?.link_type, 'related');
  assert.ok(records.links.some(link => link.href === 'https://example.com/?a=1&b=2'));
  assert.deepEqual(buildEditorialRecords(post), records);
});

test('duplicate source records merge claims without changing the article or inventing verification', () => {
  const post = mapBlogPostRow({ id: 'example', updated_at: '2026-10-03T00:00:00Z', sources: [
    { url: 'https://example.com/source', title: 'Source', publisher: 'Publisher', supportedClaims: ['First claim'] },
    { url: 'https://example.com/source', title: 'Source', publisher: 'Publisher', supportedClaims: ['First claim', 'Second claim'], primary: true },
  ] });
  const original = structuredClone(post.sources);
  const records = buildEditorialRecords(post);
  assert.equal(records.sources.length, 1);
  assert.deepEqual(records.sources[0].supported_claims, ['First claim', 'Second claim']);
  assert.equal(records.sources[0].primary_source, true);
  assert.equal(records.sources[0].citation_status, 'needs_review');
  assert.equal(records.sources[0].accessed_at, post.updatedAt);
  assert.deepEqual(post.sources, original);
});

test('editorial evidence is bounded rather than silently dropping distinct links', () => {
  const post = mapBlogPostRow({ content_html: Array.from({ length: 1001 }, (_, index) => `<a href="/page-${index}">Page ${index}</a>`).join('') });
  assert.throws(() => buildEditorialRecords(post), /supported source or link limit/);
});

test('stale manual saves are rejected at the write boundary and preserve newer content', async context => {
  const original = { ...process.env };
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  context.after(() => { process.env = original; });
  const post = await blogRepository.create({ title: 'First draft', content_html: '<p>Saved content.</p>' });
  const saved = await blogRepository.update(post.id, { title: 'Newer draft' }, post.updatedAt);
  assert.ok(saved && saved.updatedAt !== post.updatedAt);
  await assert.rejects(blogRepository.update(post.id, { title: 'Stale overwrite' }, post.updatedAt), error =>
    error instanceof BlogValidationError && error.status === 409);
  assert.equal((await blogRepository.getAdminById(post.id))?.title, 'Newer draft');
  assert.equal(safeApiError(new BlogValidationError('Reload the latest article.', 409), 'request-1').status, 409);
});
