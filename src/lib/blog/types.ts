export type BlogPostStatus = 'draft' | 'review' | 'needs_review' | 'scheduled' | 'published' | 'failed' | 'archived';
export type BlogArticleOrigin = 'autopilot' | 'trend_autopilot' | 'admin_manual' | 'admin_custom_headline' | 'admin_batch' | 'editor_update' | 'scheduled_manual';
export type BlogFreshnessStatus = 'high' | 'medium' | 'low' | 'expired' | 'evergreen' | 'unverified';
export type BlogQualityStatus = 'pending' | 'passed' | 'needs_review' | 'blocked';
export type BlogAssetStatus = BlogQualityStatus | 'not_required';
export type BlogJobState = 'queued' | 'discovering' | 'researching' | 'briefing' | 'drafting' | 'validating' | 'checking_originality' | 'optimising' | 'sourcing_images' | 'prerendering' | 'ready_for_review' | 'scheduled' | 'publishing' | 'published' | 'skipped' | 'failed' | 'cancelled';
export type BlogArticleType = 'urgent_news' | 'news_analysis' | 'glossary' | 'checklist' | 'evergreen_guide' | 'troubleshooting_guide' | 'technical_guide' | 'comparison';
export type BlogLengthMode = 'automatic' | 'brief' | 'standard' | 'detailed' | 'custom';
export type BlogProviderErrorCode =
  | 'GROQ_NOT_CONFIGURED' | 'GROQ_DISABLED' | 'GROQ_AUTH_FAILED' | 'GROQ_MODEL_PERMISSION_DENIED'
  | 'GROQ_MODEL_UNAVAILABLE' | 'GROQ_RATE_LIMITED' | 'GROQ_TIMEOUT' | 'GROQ_UNAVAILABLE'
  | 'GROQ_INVALID_RESPONSE' | 'GROQ_SCHEMA_VALIDATION_FAILED' | 'GROQ_OUTPUT_TOO_LARGE' | 'GROQ_CANCELLED';
export type BlogExecutionTarget = 'legacy_render' | 'vercel';
export type BlogWorkflowStage = 'queued' | 'source_collection' | 'source_validation' | 'topic_evaluation'
  | 'research_organisation' | 'content_gap_analysis' | 'brief_generation' | 'outline_generation'
  | 'section_drafting' | 'article_assembly' | 'editorial_review' | 'metadata_generation'
  | 'claim_validation' | 'originality_validation' | 'link_validation' | 'image_processing'
  | 'quality_gate' | 'ready_for_review' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled';
export type BlogFixtureScenario = 'evergreen' | 'news' | 'invalid' | 'timeout' | 'malformed' | 'originality_failure' | 'missing_sources' | 'image_failure';

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
  fixtureTest: boolean;
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
  fixtureTest?: boolean;
}

export interface BlogListResult {
  posts: BlogPost[];
  total: number;
  limit: number;
  offset: number;
  topics?: BlogTopic[];
}

export interface BlogTopic {
  name: string;
  slug: string;
  articleCount: number;
  latestPublishedAt: string | null;
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
  executionTarget: BlogExecutionTarget;
  workflowStage: BlogWorkflowStage;
  stageAttemptCount: number;
  stageOutputs: Record<string, unknown>;
  stageProgress: number;
  statusMessage: string;
  nextRetryAt: string | null;
  leaseExpiresAt: string | null;
  lastSafeErrorCode: string;
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
  vercelJobs: number;
  stalledVercelJobs: number;
  lastSuccessfulStageAt: string | null;
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
  sourceSnapshot?: BlogSource[];
  validationResults?: Record<string, unknown>;
}

export interface BlogApprovedSource {
  id: string;
  name: string;
  publisher: string;
  sourceUrl: string;
  feedType: 'rss' | 'atom' | 'official_blog' | 'changelog' | 'release_notes' | 'manual_url' | 'imported';
  topicClusters: string[];
  trustLevel: 'high' | 'medium' | 'low' | 'unverified';
  classification: 'primary' | 'secondary';
  enabled: boolean;
  fetchFrequencyMinutes: number;
  lastSuccessfulFetch: string | null;
  lastFailedFetch: string | null;
  safeFailureCode: string;
  latestItemDate: string | null;
  duplicateItemCount: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface BlogOperationsSnapshot {
  execution: string;
  provider: string;
  structuredModel: string;
  writerModel: string;
  providerStatus: 'disabled' | 'not_configured' | 'ready';
  lastDispatchAt: string | null;
  lastSuccessfulStageAt: string | null;
  lastRecoveryAt: string | null;
  recoveredJobs: number;
  dispatcherErrorCode: string;
  providerPauseUntil: string | null;
  fixtureAvailable: boolean;
  activeJobs: number;
  failedJobs: number;
  staleLeases: number;
  sourceFailures: number;
  staleSources: number;
  imageFailures: number;
  prerenderFailures: number;
  sitemapReady: number;
  rssReady: number;
  databaseCompatible: boolean;
  migrationVersion: string;
  checkedAt: string;
}
