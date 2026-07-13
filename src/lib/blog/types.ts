export type BlogPostStatus = 'draft' | 'review' | 'needs_review' | 'scheduled' | 'published' | 'failed' | 'archived';
export type BlogArticleOrigin = 'autopilot' | 'trend_autopilot' | 'admin_manual' | 'admin_custom_headline' | 'admin_batch' | 'editor_update' | 'scheduled_manual';
export type BlogFreshnessStatus = 'high' | 'medium' | 'low' | 'expired' | 'evergreen' | 'unverified';
export type BlogQualityStatus = 'pending' | 'passed' | 'needs_review' | 'blocked';
export type BlogAssetStatus = BlogQualityStatus | 'not_required';
export type BlogJobState = 'queued' | 'discovering' | 'researching' | 'briefing' | 'drafting' | 'validating' | 'checking_originality' | 'optimising' | 'sourcing_images' | 'prerendering' | 'ready_for_review' | 'scheduled' | 'publishing' | 'published' | 'skipped' | 'failed' | 'cancelled';
export type BlogArticleType = 'urgent_news' | 'news_analysis' | 'glossary' | 'checklist' | 'evergreen_guide' | 'troubleshooting_guide' | 'technical_guide' | 'comparison';
export type BlogLengthMode = 'automatic' | 'brief' | 'standard' | 'detailed' | 'custom';
export type BlogProviderErrorCode = 'NVIDIA_NOT_CONFIGURED' | 'NVIDIA_AUTH_FAILED' | 'NVIDIA_MODEL_UNAVAILABLE' | 'NVIDIA_RATE_LIMITED' | 'NVIDIA_TIMEOUT' | 'NVIDIA_UNAVAILABLE' | 'NVIDIA_INVALID_RESPONSE' | 'NVIDIA_SCHEMA_VALIDATION_FAILED' | 'NVIDIA_OUTPUT_TOO_LARGE' | 'NVIDIA_CANCELLED';

export interface BlogSource {
  id?: string;
  url: string;
  title: string;
  publisher: string;
  author?: string;
  publishedAt?: string | null;
  updatedAt?: string | null;
  accessedAt?: string;
  sourceType?: string;
  supportedClaims?: string[];
  primary?: boolean;
  reliability?: 'high' | 'medium' | 'low' | 'unverified';
  citationStatus?: 'verified' | 'needs_review' | 'rejected';
}

export interface BlogRelatedArticle {
  postId: string;
  slug: string;
  title: string;
  reason?: string;
}

export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  tagline: string;
  summary: string;
  contentHtml: string;
  contentText: string;
  focusKeyword: string;
  tags: string[];
  seoTitle: string;
  metaDescription: string;
  canonicalUrl: string;
  ogImageUrl: string;
  ogTitle: string;
  ogDescription: string;
  ogImageAlt: string;
  ogImageAttribution: string;
  imageVariants: BlogImageVariant[];
  status: BlogPostStatus;
  origin: BlogArticleOrigin;
  articleType: string;
  topicCluster: string;
  language: string;
  robotsDirective: string;
  freshnessStatus: BlogFreshnessStatus;
  sourcePublishedAt: string | null;
  sourceUpdatedAt: string | null;
  discoveredAt: string | null;
  continuingDevelopment: boolean;
  scheduledAt: string | null;
  recommendedPublicationAt: string | null;
  publicationRule: string;
  publicationUrgency: string;
  scheduleVersion: number;
  publicationReason: string;
  qualityStatus: BlogQualityStatus;
  qualityResults: BlogQualityReport | null;
  originalityStatus: BlogQualityStatus;
  sourceStatus: BlogQualityStatus;
  prerenderStatus: BlogQualityStatus;
  imageStatus: BlogAssetStatus;
  sources: BlogSource[];
  relatedArticles: BlogRelatedArticle[];
  generationJobId: string | null;
  batchId: string | null;
  authorId: string | null;
  reviewerId: string | null;
  updatedBy: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  readingTimeMinutes: number;
}

export interface BlogPostInput {
  slug?: string;
  title: string;
  excerpt?: string;
  tagline?: string;
  summary?: string;
  contentHtml: string;
  focusKeyword?: string;
  tags?: string[];
  seoTitle?: string;
  metaDescription?: string;
  canonicalUrl?: string;
  ogImageUrl?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImageAlt?: string;
  ogImageAttribution?: string;
  imageVariants?: BlogImageVariant[];
  status?: BlogPostStatus;
  origin?: BlogArticleOrigin;
  articleType?: string;
  topicCluster?: string;
  language?: string;
  robotsDirective?: string;
  freshnessStatus?: BlogFreshnessStatus;
  sourcePublishedAt?: string | null;
  sourceUpdatedAt?: string | null;
  discoveredAt?: string | null;
  continuingDevelopment?: boolean;
  scheduledAt?: string | null;
  recommendedPublicationAt?: string | null;
  publicationRule?: string;
  publicationUrgency?: string;
  scheduleVersion?: number;
  publicationReason?: string;
  qualityStatus?: BlogQualityStatus;
  qualityResults?: BlogQualityReport | null;
  originalityStatus?: BlogQualityStatus;
  sourceStatus?: BlogQualityStatus;
  prerenderStatus?: BlogQualityStatus;
  imageStatus?: BlogAssetStatus;
  sources?: BlogSource[];
  relatedArticles?: BlogRelatedArticle[];
  generationJobId?: string | null;
  batchId?: string | null;
  publishedAt?: string | null;
}

export interface BlogListResult {
  posts: BlogPost[];
  total: number;
  limit: number;
  offset: number;
}

export interface BlogProviderDraft {
  title: string;
  excerpt: string;
  contentHtml: string;
  focusKeyword: string;
  tags: string[];
  suggestedSlug: string;
  seoTitle: string;
  metaDescription: string;
  tagline: string;
  summary: string;
  qualityReport?: BlogQualityReport;
  providerUsage?: { model: string; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
  generationStages?: string[];
  articleType?: BlogArticleType;
  targetWords?: { minimum: number; maximum: number; label: string };
}

export interface BlogQualityCheck {
  id: string;
  label: string;
  passed: boolean;
  critical: boolean;
  detail: string;
}

export interface BlogQualityReport {
  status: BlogQualityStatus;
  wordCount: number;
  checks: BlogQualityCheck[];
  blockedReasons: string[];
  warnings: string[];
  checkedAt: string;
}

export interface BlogTrendOpportunity {
  id?: string;
  sourceUrl: string;
  sourceTitle: string;
  publisher: string;
  author?: string;
  summary?: string;
  publishedAt: string;
  updatedAt?: string | null;
  discoveredAt: string;
  topicCluster: string;
  searchIntent: string;
  proposedAngle: string;
  audienceRelevance: number;
  sourceAuthority: number;
  novelty: number;
  primarySource: boolean;
  continuingDevelopment?: boolean;
  existingCoverage?: boolean;
  freshnessStatus?: BlogFreshnessStatus;
  ageHours?: number | null;
  priorityReason?: string;
  expiresAt?: string | null;
}

export interface BlogGenerationJob {
  id: string;
  origin: BlogArticleOrigin;
  state: BlogJobState;
  topic: string;
  customHeadline: string;
  batchId: string | null;
  provider: string;
  model: string;
  attemptCount: number;
  maxAttempts: number;
  requestedBy: string | null;
  articleId: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  inputTokens: number | null;
  outputTokens: number | null;
  actualCost: number | null;
  scheduledFor: string | null;
  error: string;
  createdAt: string;
  updatedAt: string;
}

export interface BlogAdminOverview {
  automaticGeneratedToday: number;
  automaticGeneratedWeek: number;
  automaticPublishedToday: number;
  automaticPublishedWeek: number;
  manuallyTriggered: number;
  manualBatchArticles: number;
  customHeadlineArticles: number;
  updates: number;
  skippedAutomaticOpportunities: number;
  automaticHeldForReview: number;
  highPriorityStories: number;
  expiringStories: number;
  draftsNeedingReview: number;
  activeJobs: number;
  unresolvedClaims: number;
  sourceFailures: number;
  linkFailures: number;
  imageFailures: number;
  qualityFailures: number;
  originalityWarnings: number;
  duplicateTopicWarnings: number;
  prerenderFailures: number;
  updatesDue: number;
  sitemapReady: number;
  rssReady: number;
  providerInputTokens: number;
  providerOutputTokens: number;
  automaticReviewed: number;
  automaticApproved: number;
  automaticRejected: number;
  strictAutopilotUnlocked: boolean;
}

export interface BlogImageVariant {
  id?: string;
  imageId?: string;
  width: number;
  height: number;
  format: 'webp' | 'avif' | 'jpeg' | 'png';
  mimeType: string;
  fileSize: number;
  storagePath: string;
  storageUrl: string;
  status: 'ready' | 'failed' | 'deleted';
}

export interface BlogSectionRevision {
  id: string;
  articleId: string;
  sectionKey: string;
  action: string;
  beforeHtml: string;
  afterHtml: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}
