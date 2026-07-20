import { createHash } from 'node:crypto';
import type { BlogArticleOrigin, BlogGenerationJob, BlogPost, BlogQualityReport } from './types';

export const AUTOMATIC_BLOG_ORIGINS: ReadonlySet<BlogArticleOrigin> = new Set(['autopilot', 'trend_autopilot']);
export const MANUAL_BLOG_ORIGINS: ReadonlySet<BlogArticleOrigin> = new Set(['admin_manual', 'admin_custom_headline', 'admin_batch', 'scheduled_manual']);

export function isAutomaticBlogOrigin(origin: BlogArticleOrigin) {
  return AUTOMATIC_BLOG_ORIGINS.has(origin);
}

export function isManualBlogOrigin(origin: BlogArticleOrigin) {
  return MANUAL_BLOG_ORIGINS.has(origin);
}

function startOfUtcDay(now: Date) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function startOfUtcWeek(now: Date) {
  const dayStart = startOfUtcDay(now);
  const weekday = new Date(dayStart).getUTCDay() || 7;
  return dayStart - (weekday - 1) * 24 * 60 * 60 * 1000;
}

export function countBlogOrigins(posts: BlogPost[], jobs: BlogGenerationJob[] = [], now = new Date()) {
  const dayStart = startOfUtcDay(now);
  const weekStart = startOfUtcWeek(now);
  const createdAfter = (post: BlogPost, start: number) => new Date(post.createdAt).getTime() >= start;
  const publishedAfter = (post: BlogPost, start: number) => Boolean(post.publishedAt && new Date(post.publishedAt).getTime() >= start);
  const automatic = posts.filter((post) => isAutomaticBlogOrigin(post.origin));
  return {
    automaticGeneratedToday: automatic.filter((post) => createdAfter(post, dayStart)).length,
    automaticGeneratedWeek: automatic.filter((post) => createdAfter(post, weekStart)).length,
    automaticPublishedToday: automatic.filter((post) => publishedAfter(post, dayStart)).length,
    automaticPublishedWeek: automatic.filter((post) => publishedAfter(post, weekStart)).length,
    manuallyTriggered: posts.filter((post) => isManualBlogOrigin(post.origin)).length,
    manualBatchArticles: posts.filter((post) => post.origin === 'admin_batch').length,
    customHeadlineArticles: posts.filter((post) => post.origin === 'admin_custom_headline').length,
    updates: posts.filter((post) => post.origin === 'editor_update').length,
    skippedAutomaticOpportunities: jobs.filter((job) => isAutomaticBlogOrigin(job.origin) && job.state === 'skipped').length,
    automaticHeldForReview: jobs.filter((job) => isAutomaticBlogOrigin(job.origin) && job.state === 'ready_for_review').length,
  };
}

export function validateManualBatch(input: { headlines?: string[]; count?: number; maximumCost?: number }) {
  const headlines = (input.headlines || []).map((headline) => headline.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const count = headlines.length || Math.max(1, Number(input.count) || 1);
  if (count > 5) throw new Error('Manual batches are limited to five articles.');
  if (new Set(headlines.map((headline) => headline.toLowerCase())).size !== headlines.length) throw new Error('Batch headlines must be distinct.');
  if (input.maximumCost != null && (!Number.isFinite(input.maximumCost) || input.maximumCost < 0)) throw new Error('Maximum cost must be zero or greater.');
  return { count, headlines };
}

export function assessCustomHeadline(headline: string, existingHeadlines: string[] = []) {
  const normalized = headline.replace(/\s+/g, ' ').trim();
  const duplicate = existingHeadlines.some((item) => item.trim().toLowerCase() === normalized.toLowerCase());
  const misleading = /\b(guaranteed?|instantly|secret hack|rank #?1|number one on google|double your traffic)\b/i.test(normalized);
  return {
    headline: normalized.slice(0, 140),
    duplicate,
    misleading,
    status: duplicate || misleading ? 'needs_review' as const : 'passed' as const,
    warnings: [duplicate ? 'A post already uses this headline.' : '', misleading ? 'The headline contains an unsupported or misleading promise.' : ''].filter(Boolean),
  };
}

export function blogJobIdempotencyKey(input: {
  origin: BlogArticleOrigin;
  topic?: string;
  customHeadline?: string;
  batchId?: string | null;
  dateBucket?: string;
}) {
  return createHash('sha256').update([
    input.origin,
    input.topic || '',
    input.customHeadline || '',
    input.batchId || '',
    input.dateBucket || new Date().toISOString().slice(0, 10),
  ].map((value) => value.trim().toLowerCase()).join('|')).digest('hex');
}

export function publicationBlockers(input: {
  qualityReport: BlogQualityReport;
  originalityStatus: string;
  sourceStatus: string;
  imageStatus: string;
  prerenderStatus: string;
}) {
  const blockers = input.qualityReport.checks
    .filter((item) => item.critical && !item.passed)
    .map((item) => `${item.label}: ${item.detail}`);
  if (input.originalityStatus !== 'passed') blockers.push('Originality review has not passed');
  if (input.sourceStatus !== 'passed') blockers.push('Source verification has not passed');
  if (!['passed', 'not_required'].includes(input.imageStatus)) blockers.push('Image validation has not passed');
  if (input.prerenderStatus !== 'passed') blockers.push('Initial HTML prerender has not passed');
  return [...new Set(blockers)];
}
