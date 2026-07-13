import { buildBlogSeoFields } from './seo';
import { blogTextFromHtml, sanitizeBlogHtml } from './sanitize';
import { normalizeBlogSlug } from './slug';
import type { BlogPostInput, BlogPostStatus } from './types';
import { evaluateBlogQuality } from './quality';
import { publicationBlockers } from './automation';

export class BlogValidationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function optionalHttpUrl(value: unknown, field: string) {
  const text = String(value || '').trim().slice(0, 500);
  if (!text) return '';
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol');
    return url.toString();
  } catch {
    throw new BlogValidationError(`${field} must be a valid HTTP or HTTPS URL.`);
  }
}

function normalizeTags(value: unknown) {
  const tags = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(tags.map(String).map((tag) => tag.trim().replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean))].slice(0, 12);
}

function cleanField(value: unknown, maximum: number) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function optionalDate(value: unknown, field: string) {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new BlogValidationError(`${field} is invalid.`);
  return parsed.toISOString();
}

function normalizeSources(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).map((source: any) => ({
    url: optionalHttpUrl(source?.url, 'Source URL'),
    title: cleanField(source?.title, 240),
    publisher: cleanField(source?.publisher, 160),
    author: cleanField(source?.author, 160),
    publishedAt: optionalDate(source?.publishedAt, 'Source publish date'),
    updatedAt: optionalDate(source?.updatedAt, 'Source update date'),
    accessedAt: optionalDate(source?.accessedAt, 'Source access date') || new Date().toISOString(),
    sourceType: cleanField(source?.sourceType || 'reference', 80),
    supportedClaims: Array.isArray(source?.supportedClaims) ? source.supportedClaims.map((claim: unknown) => cleanField(claim, 300)).filter(Boolean).slice(0, 30) : [],
    primary: Boolean(source?.primary),
    reliability: ['high', 'medium', 'low', 'unverified'].includes(source?.reliability) ? source.reliability : 'unverified',
    citationStatus: ['verified', 'needs_review', 'rejected'].includes(source?.citationStatus) ? source.citationStatus : 'needs_review',
  })).filter((source) => source.url && source.title && source.publisher);
}

function normalizeRelatedArticles(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map((article: any) => ({
    postId: cleanField(article?.postId, 80),
    slug: normalizeBlogSlug(article?.slug || ''),
    title: cleanField(article?.title, 140),
    reason: cleanField(article?.reason, 240),
  })).filter((article) => article.postId && article.slug && article.title);
}

function normalizeImageVariants(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 24).map((variant: any) => ({
    id: cleanField(variant?.id, 80) || undefined,
    imageId: cleanField(variant?.image_id || variant?.imageId, 80) || undefined,
    width: Math.max(1, Math.floor(Number(variant?.width) || 0)),
    height: Math.max(1, Math.floor(Number(variant?.height) || 0)),
    format: ['webp', 'avif', 'jpeg', 'png'].includes(variant?.format) ? variant.format : 'webp',
    mimeType: cleanField(variant?.mime_type || variant?.mimeType, 80),
    fileSize: Math.max(0, Math.floor(Number(variant?.file_size ?? variant?.fileSize) || 0)),
    storagePath: cleanField(variant?.storage_path || variant?.storagePath, 500),
    storageUrl: optionalHttpUrl(variant?.storage_url || variant?.storageUrl, 'Responsive image URL'),
    status: ['ready', 'failed', 'deleted'].includes(variant?.processing_status || variant?.status) ? (variant.processing_status || variant.status) : 'ready',
  })).filter((variant) => variant.width && variant.height && variant.storageUrl && variant.mimeType.startsWith('image/'));
}

export function prepareBlogPost(input: BlogPostInput, options: { publishing?: boolean } = {}) {
  const title = String(input.title || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  if (title.length < 3) throw new BlogValidationError('Title must be at least 3 characters.');

  const contentHtml = sanitizeBlogHtml(input.contentHtml);
  const contentText = blogTextFromHtml(contentHtml);
  const status = (['draft', 'review', 'needs_review', 'scheduled', 'published', 'failed', 'archived'].includes(String(input.status)) ? input.status : 'draft') as BlogPostStatus;
  const seo = buildBlogSeoFields({ title, excerpt: input.excerpt, contentText, focusKeyword: input.focusKeyword });
  const excerpt = String(input.excerpt || seo.excerpt).replace(/\s+/g, ' ').trim().slice(0, 360);
  const seoTitle = String(input.seoTitle || seo.seoTitle).replace(/\s+/g, ' ').trim().slice(0, 70);
  const metaDescription = String(input.metaDescription || seo.metaDescription).replace(/\s+/g, ' ').trim().slice(0, 180);
  const focusKeyword = String(input.focusKeyword || seo.focusKeyword).replace(/\s+/g, ' ').trim().slice(0, 100);
  const slug = normalizeBlogSlug(input.slug || title);
  const publishing = options.publishing || status === 'published' || status === 'scheduled';
  const tagline = cleanField(input.tagline, 240);
  const summary = cleanField(input.summary || excerpt, 600);
  const sources = normalizeSources(input.sources);
  const relatedArticles = normalizeRelatedArticles(input.relatedArticles);
  const articleType = cleanField(input.articleType || 'evergreen guide', 80);
  const topicCluster = cleanField(input.topicCluster, 120);
  const origin = input.origin || 'admin_manual';
  const qualityReport = evaluateBlogQuality({ ...input, title, tagline, excerpt, contentHtml, sources, relatedArticles, articleType }, { requireSources: publishing });
  const originalityStatus = input.originalityStatus || 'pending';
  const sourceStatus = input.sourceStatus || (sources.length > 0 && sources.every((source) => source.citationStatus === 'verified') ? 'passed' : 'pending');
  const prerenderStatus = input.prerenderStatus || 'pending';
  const imageStatus = input.imageStatus || (input.ogImageUrl ? 'pending' : 'not_required');

  if (publishing) {
    const blockers = publicationBlockers({ qualityReport, originalityStatus, sourceStatus, prerenderStatus, imageStatus });
    if (blockers.length) throw new BlogValidationError(`Publication blocked: ${blockers.join('; ')}.`);
    if (excerpt.length < 60) throw new BlogValidationError('Published articles need a clear excerpt of at least 60 characters.');
    if (seoTitle.length < 20) throw new BlogValidationError('Published articles need an SEO title of at least 20 characters.');
    if (metaDescription.length < 70) throw new BlogValidationError('Published articles need a meta description of at least 70 characters.');
  }

  let publishedAt: string | null = null;
  if (status === 'published') {
    const parsed = input.publishedAt ? new Date(input.publishedAt) : new Date();
    if (Number.isNaN(parsed.getTime())) throw new BlogValidationError('Publish date is invalid.');
    publishedAt = parsed.toISOString();
  }

  let scheduledAt: string | null = null;
  if (status === 'scheduled') {
    const parsed = input.scheduledAt ? new Date(input.scheduledAt) : null;
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) throw new BlogValidationError('Scheduled articles need a future publication time.');
    scheduledAt = parsed.toISOString();
  }

  return {
    slug,
    title,
    tagline,
    summary,
    excerpt,
    content_html: contentHtml,
    content_text: contentText,
    focus_keyword: focusKeyword || null,
    tags: normalizeTags(input.tags),
    seo_title: seoTitle,
    meta_description: metaDescription,
    canonical_url: optionalHttpUrl(input.canonicalUrl, 'Canonical URL') || null,
    og_image_url: optionalHttpUrl(input.ogImageUrl, 'Social image URL') || null,
    og_title: cleanField(input.ogTitle || seoTitle, 100),
    og_description: cleanField(input.ogDescription || metaDescription, 240),
    og_image_alt: cleanField(input.ogImageAlt, 240),
    og_image_attribution: cleanField(input.ogImageAttribution, 300),
    responsive_images: normalizeImageVariants(input.imageVariants),
    status,
    origin,
    article_type: articleType,
    topic_cluster: topicCluster,
    language: /^[a-z]{2}(?:-[A-Z]{2})?$/.test(String(input.language || 'en')) ? input.language || 'en' : 'en',
    robots_directive: status === 'published' ? 'index,follow,max-image-preview:large' : 'noindex,nofollow',
    freshness_status: input.freshnessStatus || (origin === 'autopilot' || origin === 'trend_autopilot' ? 'unverified' : 'evergreen'),
    source_published_at: optionalDate(input.sourcePublishedAt, 'Source publish date'),
    source_updated_at: optionalDate(input.sourceUpdatedAt, 'Source update date'),
    discovered_at: optionalDate(input.discoveredAt, 'Discovery date'),
    continuing_development: Boolean(input.continuingDevelopment),
    scheduled_at: scheduledAt,
    recommended_publication_at: optionalDate(input.recommendedPublicationAt, 'Recommended publication date'),
    publication_rule: cleanField(input.publicationRule, 120),
    publication_urgency: cleanField(input.publicationUrgency || 'normal', 40),
    schedule_version: Math.max(0, Math.floor(Number(input.scheduleVersion) || 0)),
    publication_reason: cleanField(input.publicationReason, 500),
    quality_status: qualityReport.status,
    quality_results: qualityReport,
    originality_status: originalityStatus,
    source_status: sourceStatus,
    prerender_status: prerenderStatus,
    image_status: imageStatus,
    sources,
    related_articles: relatedArticles,
    generation_job_id: input.generationJobId || null,
    batch_id: input.batchId || null,
    published_at: publishedAt,
  };
}
