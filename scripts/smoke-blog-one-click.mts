import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolvedBlogFeedUrls } from '../src/lib/blog/default-sources';
import { selectBestBlogTrend } from '../src/lib/blog/discovery';
import { completeGeneratedArticleLinks } from '../src/lib/blog/server/vercel-workflow';
import type { BlogSource, BlogTrendOpportunity } from '../src/lib/blog/types';

const now = new Date('2026-07-20T08:00:00.000Z');
const opportunity = (overrides: Partial<BlogTrendOpportunity>): BlogTrendOpportunity => ({
  sourceUrl: 'https://developers.google.com/search/blog/example',
  sourceTitle: 'A useful Google Search update',
  publisher: 'Google Search Central',
  publishedAt: now.toISOString(),
  discoveredAt: now.toISOString(),
  topicCluster: 'crawlability and indexing',
  searchIntent: 'search update',
  proposedAngle: 'Explain what changed and how to verify it.',
  audienceRelevance: 0.9,
  sourceAuthority: 0.9,
  novelty: 0.9,
  primarySource: true,
  freshnessStatus: 'high',
  existingCoverage: false,
  ...overrides,
});

const best = selectBestBlogTrend([
  opportunity({ sourceTitle: 'Already covered', existingCoverage: true }),
  opportunity({ sourceTitle: 'Older secondary update', freshnessStatus: 'medium', primarySource: false }),
  opportunity({ sourceTitle: 'Current primary update' }),
]);
assert.equal(best?.sourceTitle, 'Current primary update');
assert.equal(selectBestBlogTrend([opportunity({ freshnessStatus: 'expired' })]), null);
assert.equal(
  selectBestBlogTrend([opportunity({ sourceTitle: 'Latest useful official update', freshnessStatus: 'low', ageHours: 24 * 14 })])?.sourceTitle,
  'Latest useful official update',
);
assert.equal(selectBestBlogTrend([opportunity({ freshnessStatus: 'low', ageHours: 24 * 46 })]), null);

const feeds = resolvedBlogFeedUrls([]);
assert.ok(feeds.length >= 3);
assert.ok(feeds.every((url) => url.startsWith('https://')));
assert.equal(resolvedBlogFeedUrls([feeds[0]]).filter((url) => url === feeds[0]).length, 1);

const sources: BlogSource[] = [{
  url: 'https://developers.google.com/search/blog/example',
  title: 'Official source',
  publisher: 'Google Search Central',
  citationStatus: 'verified',
}];
const completed = completeGeneratedArticleLinks('<h2>What changed</h2><p>Useful explanation.</p>', sources);
assert.match(completed, /href="https:\/\/developers\.google\.com\/search\/blog\/example"/);
assert.match(completed, /href="\/blog"/);
assert.match(completed, /href="\/#start-audit"/);
assert.equal((completeGeneratedArticleLinks(completed, sources).match(/href="\/blog"/g) || []).length, 1);

const api = readFileSync('src/api/index.ts', 'utf8');
const workflow = readFileSync('src/lib/blog/server/vercel-workflow.ts', 'utf8');
const ui = readFileSync('src/components/blog/BlogAutomationPanel.tsx', 'utf8');
assert.match(api, /mode === 'one_click'/);
assert.match(api, /publishWhenReady: mode === 'one_click'/);
assert.match(workflow, /blockers\.length === 0 && claimValidationPassed/);
assert.match(workflow, /Draft saved for review because publication checks need attention/);
assert.match(ui, /Research, write and publish/);
assert.match(ui, /Advanced content controls/);

console.log('One-click blog smoke test passed: current-source selection, required links, guarded publication, and simplified controls verified.');
