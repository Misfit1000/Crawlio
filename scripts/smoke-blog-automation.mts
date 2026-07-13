import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessCustomHeadline, blogJobIdempotencyKey, countBlogOrigins, publicationBlockers, validateManualBatch } from '../src/lib/blog/automation';
import { classifyBlogFreshness, selectAutomaticBlogOpportunities, selectAutomaticPublicationTime } from '../src/lib/blog/freshness';
import { validateBlogImageBuffer } from '../src/lib/blog/images';
import { evaluateBlogOriginality, evaluateBlogQuality, inspectBlogLinks } from '../src/lib/blog/quality';
import { renderBlogArticleHtml } from '../src/lib/blog/render';
import { buildCompetitorGapBrief } from '../src/lib/blog/research';
import { mapBlogPostRow } from '../src/lib/blog/repository';
import { isPrivateOrReservedAddress } from '../src/lib/security/safe-public-fetch';
import type { BlogPost, BlogTrendOpportunity } from '../src/lib/blog/types';
import { prepareBlogPost } from '../src/lib/blog/validation';

const mode = process.argv[2] || 'all';
const now = new Date('2026-07-13T12:00:00.000Z');
const source = { url: 'https://developers.google.com/search/docs/crawling-indexing/overview', title: 'Crawling and indexing overview', publisher: 'Google Search Central', citationStatus: 'verified' as const, reliability: 'high' as const, primary: true, publishedAt: '2026-07-12T12:00:00.000Z' };

const paragraphs = Array.from({ length: 132 }, (_, index) => `<p>Check ${index + 1} connects observable website evidence to a clear action for editors and developers.</p>`);
const contentHtml = `<p>This guide explains a measured workflow for reviewing public website signals.</p><h2>Collect reliable evidence</h2>${paragraphs.slice(0, 44).join('')}<p>Use the <a href="${source.url}">official crawling and indexing documentation</a> for source context.</p><h2>Prioritize practical corrections</h2>${paragraphs.slice(44, 88).join('')}<p>Start with a <a href="/#start-audit">website audit</a> and review the <a href="/blog">SEOIntel article library</a>.</p><h2>Verify the outcome</h2>${paragraphs.slice(88).join('')}`;
const input = {
  title: 'A Measured Technical SEO Review Workflow',
  tagline: 'Turn public crawl evidence into a review process that teams can repeat and verify.',
  summary: 'A practical process for collecting evidence, prioritizing corrections, and checking the result without unsupported ranking claims.',
  excerpt: 'Learn how to collect website evidence, prioritize technical SEO corrections, and verify each change with a repeatable review process.',
  contentHtml,
  focusKeyword: 'technical SEO review',
  seoTitle: 'Technical SEO Review Workflow for Website Teams',
  metaDescription: 'Use this measured technical SEO review workflow to collect public evidence, prioritize website fixes, and verify outcomes clearly.',
  sources: [source],
  relatedArticles: [{ postId: 'related-1', slug: 'crawlability-basics', title: 'Crawlability basics for website owners' }],
};

function opportunity(overrides: Partial<BlogTrendOpportunity> = {}): BlogTrendOpportunity {
  return {
    sourceUrl: 'https://example.com/update', sourceTitle: 'Search documentation update', publisher: 'Primary publisher',
    publishedAt: '2026-07-12T18:00:00.000Z', discoveredAt: now.toISOString(), topicCluster: 'crawlability', searchIntent: 'crawlability update',
    proposedAngle: 'Explain the documented change and verification steps.', audienceRelevance: 0.9, sourceAuthority: 0.95, novelty: 0.9, primarySource: true,
    ...overrides,
  };
}

function post(origin: BlogPost['origin'], createdAt: string, publishedAt: string | null = null): BlogPost {
  return mapBlogPostRow({ id: `${origin}-${createdAt}`, title: origin, slug: `${origin}-${createdAt.slice(0, 10)}`, content_html: '<p>body</p>', content_text: 'body', origin, status: publishedAt ? 'published' : 'draft', created_at: createdAt, updated_at: createdAt, published_at: publishedAt });
}

const quality = evaluateBlogQuality(input, { requireSources: true, now });
assert.ok(quality.wordCount >= 1500, 'article fixture must exceed 1,500 words');
assert.equal(quality.blockedReasons.length, 0, quality.blockedReasons.join('; '));
assert.equal(quality.checks.find((check) => check.id === 'sentence-length')?.passed, true);
assert.equal(quality.checks.find((check) => check.id === 'paragraph-length')?.passed, true);
assert.equal(quality.checks.find((check) => check.id === 'heading-order')?.passed, true);
assert.equal(quality.checks.find((check) => check.id === 'internal-links')?.passed, true);

const links = inspectBlogLinks(contentHtml);
assert.ok(links.some((link) => link.href === source.url && link.anchor.length > 10));
assert.ok(links.filter((link) => link.href.startsWith('/')).length >= 2);
assert.ok(links.every((link) => link.anchor && !/click here/i.test(link.anchor)));

const fresh = classifyBlogFreshness(opportunity(), now);
assert.equal(fresh.status, 'high');
assert.equal(classifyBlogFreshness(opportunity({ publishedAt: '2026-07-09T12:00:00.000Z' }), now).status, 'medium');
assert.equal(classifyBlogFreshness(opportunity({ publishedAt: '2026-06-20T12:00:00.000Z' }), now).status, 'low');
assert.equal(classifyBlogFreshness(opportunity({ publishedAt: '2026-06-20T12:00:00.000Z', continuingDevelopment: true }), now).status, 'medium');
const selectedTwo = selectAutomaticBlogOpportunities([opportunity(), opportunity({ sourceUrl: 'https://example.org/security', sourceTitle: 'Browser security update', topicCluster: 'browser security', searchIntent: 'security update' })], now);
assert.equal(selectedTwo.length, 2);
assert.equal(selectAutomaticBlogOpportunities([opportunity()], now).length, 1);
assert.equal(selectAutomaticBlogOpportunities([opportunity({ publishedAt: '2026-06-01T00:00:00.000Z' })], now).length, 0);

const counts = countBlogOrigins([
  post('autopilot', '2026-07-13T08:00:00.000Z'), post('admin_manual', '2026-07-13T09:00:00.000Z'),
  post('admin_custom_headline', '2026-07-13T10:00:00.000Z'), post('admin_batch', '2026-07-13T11:00:00.000Z'),
  post('editor_update', '2026-07-13T11:30:00.000Z'),
], [], now);
assert.equal(counts.automaticGeneratedToday, 1);
assert.equal(counts.manuallyTriggered, 3);
assert.equal(counts.customHeadlineArticles, 1);
assert.equal(counts.manualBatchArticles, 1);
assert.equal(counts.updates, 1);
assert.equal(validateManualBatch({ headlines: ['First useful headline', 'Second useful headline'] }).count, 2);
assert.throws(() => validateManualBatch({ headlines: Array.from({ length: 6 }, (_, index) => `Headline ${index}`) }), /five/);

const custom = assessCustomHeadline('How to Review Canonical URLs', []);
assert.equal(custom.headline, 'How to Review Canonical URLs');
assert.equal(custom.status, 'passed');
assert.equal(assessCustomHeadline('How to Review Canonical URLs', ['How to Review Canonical URLs']).duplicate, true);
assert.equal(assessCustomHeadline('Guaranteed rank #1 instantly', []).misleading, true);
const nvidiaSource = readFileSync(new URL('../src/lib/blog/nvidia.ts', import.meta.url), 'utf8');
assert.match(nvidiaSource, /The title must be exactly/);
assert.match(nvidiaSource, /Target \$\{range\.minimum\}-\$\{range\.maximum\}/);

const copied = evaluateBlogOriginality('<p>This exact source sentence contains enough individual words to trigger the copied phrase detector immediately today.</p>', ['This exact source sentence contains enough individual words to trigger the copied phrase detector immediately today.']);
assert.equal(copied.passed, false);
const paraphrase = evaluateBlogOriginality('<p>Teams should carefully verify crawl evidence before publishing major website changes to production systems today.</p>', ['Teams must carefully verify crawl evidence before publishing major website changes into production systems today.']);
assert.equal(paraphrase.closeParaphraseRisk, true);
assert.equal(evaluateBlogOriginality(contentHtml, ['A wholly unrelated short source note.']).passed, true);
const gapBrief = buildCompetitorGapBrief([{ url: 'https://competitor.example/guide', title: 'Reference guide', publisher: 'competitor.example', headings: ['Basic checks'], observedTopics: ['basic checks'], publishedAt: null }], ['basic checks', 'verification workflow']);
assert.deepEqual(gapBrief.contentGaps, ['verification workflow']);
assert.equal(gapBrief.trafficLabel, 'Traffic data unavailable');
assert.match(gapBrief.copyingRule, /Do not copy/);

const prepared = prepareBlogPost({ ...input, status: 'published', origin: 'admin_manual', originalityStatus: 'passed', sourceStatus: 'passed', prerenderStatus: 'passed', imageStatus: 'not_required', publishedAt: now.toISOString() });
const renderedPost = mapBlogPostRow({ ...prepared, id: 'article-1', created_at: now.toISOString(), updated_at: now.toISOString() });
const html = renderBlogArticleHtml(renderedPost, 'https://keywordsintel.vercel.app');
assert.equal((html.match(/<h1>/g) || []).length, 1);
assert.match(html, /<link rel="canonical"/);
assert.match(html, /application\/ld\+json/);
assert.match(html, /<a href="https:\/\/developers\.google\.com/);
assert.match(html, /<a href="\/blog\/crawlability-basics"/);
assert.match(html, /<meta name="robots" content="index,follow,max-image-preview:large"/);
const dated = prepareBlogPost({ ...input, sourcePublishedAt: source.publishedAt, status: 'needs_review' });
assert.equal(dated.source_published_at, source.publishedAt);

const scheduleSettings = { automaticTiming: true, timezone: 'UTC', preferredStartHour: 9, preferredEndHour: 17, minimumSpacingMinutes: 180, delayAfterDiscoveryMinutes: 0, maximumPostsPerDay: 2, blackoutWeekdays: [] };
const firstTime = selectAutomaticPublicationTime({ opportunity: opportunity(), now: new Date('2026-07-13T08:00:00Z'), settings: scheduleSettings });
assert.ok(firstTime.scheduledAt);
const secondTime = selectAutomaticPublicationTime({ opportunity: opportunity({ sourceUrl: 'https://example.org/two' }), now: new Date('2026-07-13T08:00:00Z'), existingPublicationTimes: [firstTime.scheduledAt], settings: scheduleSettings });
assert.ok(secondTime.scheduledAt);
assert.ok(new Date(secondTime.scheduledAt).getTime() - new Date(firstTime.scheduledAt).getTime() >= 180 * 60_000);
assert.equal(blogJobIdempotencyKey({ origin: 'autopilot', topic: 'same', dateBucket: 'bucket' }), blogJobIdempotencyKey({ origin: 'autopilot', topic: 'same', dateBucket: 'bucket' }));
assert.ok(publicationBlockers({ qualityReport: quality, originalityStatus: 'blocked', sourceStatus: 'passed', imageStatus: 'not_required', prerenderStatus: 'passed' }).some((item) => /Originality/.test(item)));
assert.ok(publicationBlockers({ qualityReport: quality, originalityStatus: 'passed', sourceStatus: 'blocked', imageStatus: 'not_required', prerenderStatus: 'passed' }).some((item) => /Source/.test(item)));
assert.ok(publicationBlockers({ qualityReport: quality, originalityStatus: 'passed', sourceStatus: 'passed', imageStatus: 'not_required', prerenderStatus: 'blocked' }).some((item) => /prerender/.test(item)));

const png = Buffer.alloc(33);
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png, 0);
png.writeUInt32BE(13, 8); png.write('IHDR', 12, 'ascii');
png.writeUInt32BE(400, 16); png.writeUInt32BE(200, 20);
assert.deepEqual(validateBlogImageBuffer(png, 'image/png').width, 400);
assert.throws(() => validateBlogImageBuffer(Buffer.from('<svg></svg>'), 'image/svg+xml'), /raster image/);
assert.equal(isPrivateOrReservedAddress('127.0.0.1'), true);

const automationMigration = readFileSync(new URL('../supabase/migrations/012_blog_automation_platform.sql', import.meta.url), 'utf8');
assert.match(automationMigration, /idempotency_key text not null unique/i);
assert.match(automationMigration, /for update skip locked/i);
assert.match(automationMigration, /blog_posts_generation_job_unique_idx/i);
assert.match(automationMigration, /enable row level security/i);
assert.match(automationMigration, /blog-images/i);
const vercelConfig = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8');
assert.match(vercelConfig, /news-sitemap\.xml/);
assert.match(vercelConfig, /blog\/html\/:slug/);
const workerSource = readFileSync(new URL('../src/workers/blog-worker.ts', import.meta.url), 'utf8');
assert.ok(workerSource.indexOf('generateBlogWithNvidia') < workerSource.indexOf('blogRepository.create'), 'provider generation must finish before article creation');
assert.match(workerSource, /Freshness window expires before the next valid publication time/);

console.log(`blog automation smoke (${mode}): passed`);
