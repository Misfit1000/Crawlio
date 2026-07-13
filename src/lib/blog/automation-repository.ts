import { randomUUID } from 'node:crypto';
import { getSupabaseAdminClient } from '../supabase/server';
import { countBlogOrigins } from './automation';
import type { BlogAdminOverview, BlogArticleOrigin, BlogGenerationJob, BlogJobState, BlogTrendOpportunity } from './types';
import { blogRepository } from './repository';
import { getNvidiaBlogConfiguration } from './nvidia';

type Row = Record<string, any>;
const memoryJobs = new Map<string, Row>();
const memoryBatches = new Map<string, Row>();
const memoryDiscoveries = new Map<string, Row>();
let memorySettings: Row = {
  id: 'default', enabled: false, daily_automatic_limit: 2, weekly_automatic_limit: 10,
  automatic_timing: true, timezone: 'UTC', preferred_start_hour: 9, preferred_end_hour: 17,
  minimum_spacing_minutes: 180, delay_after_discovery_minutes: 60, maximum_posts_per_day: 2,
  blackout_weekdays: [], approved_feed_urls: [], require_review_for_urgent: true,
  blackout_dates: [], required_reviewed_articles_before_autopublish: 30,
  automatic_articles_reviewed: 0, automatic_articles_approved: 0, automatic_articles_rejected: 0,
  strict_autopilot_enabled: false, emergency_pause: false, pause_all_publication: false,
  urgent_news_hold: true, fixed_publication_minute: null, maintenance_mode: false,
  provider_last_success_at: null, provider_last_error_code: '', provider_last_duration_ms: null,
  provider_live_verification_status: 'not_run',
  provider_enabled: false,
};

function toJob(row: Row): BlogGenerationJob {
  return {
    id: String(row.id),
    origin: row.origin,
    state: row.state,
    topic: String(row.topic || ''),
    customHeadline: String(row.custom_headline || ''),
    batchId: row.batch_id || null,
    provider: String(row.provider || ''),
    model: String(row.model || ''),
    attemptCount: Number(row.attempt_count || 0),
    maxAttempts: Number(row.max_attempts || 3),
    requestedBy: row.requested_by || null,
    articleId: row.article_id || null,
    payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
    result: row.result && typeof row.result === 'object' ? row.result : {},
    inputTokens: row.input_tokens == null ? null : Number(row.input_tokens),
    outputTokens: row.output_tokens == null ? null : Number(row.output_tokens),
    actualCost: row.actual_cost == null ? null : Number(row.actual_cost),
    scheduledFor: row.scheduled_for || null,
    error: String(row.error || ''),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function nowIso() {
  return new Date().toISOString();
}

export const blogAutomationRepository = {
  async getSettings() {
    const client = getSupabaseAdminClient();
    if (!client) return { ...memorySettings };
    const { data, error } = await client.from('blog_autopilot_settings').select('*').eq('id', 'default').single();
    if (error) throw error;
    return data as Row;
  },

  async updateSettings(input: Row, updatedBy: string) {
    const allowed = ['enabled', 'daily_automatic_limit', 'weekly_automatic_limit', 'automatic_timing', 'timezone', 'preferred_start_hour', 'preferred_end_hour', 'minimum_spacing_minutes', 'delay_after_discovery_minutes', 'maximum_posts_per_day', 'blackout_weekdays', 'blackout_dates', 'approved_feed_urls', 'require_review_for_urgent', 'required_reviewed_articles_before_autopublish', 'strict_autopilot_enabled', 'emergency_pause', 'pause_all_publication', 'urgent_news_hold', 'fixed_publication_minute', 'maintenance_mode', 'provider_enabled'];
    const row = Object.fromEntries(Object.entries(input).filter(([key]) => allowed.includes(key)));
    const current = await blogAutomationRepository.getSettings();
    if (row.strict_autopilot_enabled === true && Number(current.automatic_articles_approved || 0) < Number(row.required_reviewed_articles_before_autopublish || current.required_reviewed_articles_before_autopublish || 30)) {
      throw new Error('Strict Autopilot remains locked until the required number of automatic articles has been reviewed and approved.');
    }
    const client = getSupabaseAdminClient();
    if (!client) {
      memorySettings = { ...memorySettings, ...row, updated_by: updatedBy, updated_at: nowIso() };
      return { ...memorySettings };
    }
    const { data, error } = await client.from('blog_autopilot_settings').update({ ...row, updated_by: updatedBy }).eq('id', 'default').select('*').single();
    if (error) throw error;
    return data as Row;
  },
  async createJob(input: {
    origin: BlogArticleOrigin;
    topic?: string;
    customHeadline?: string;
    batchId?: string | null;
    requestedBy?: string | null;
    provider?: string;
    model?: string;
    payload?: Record<string, unknown>;
    idempotencyKey: string;
    scheduledFor?: string | null;
  }) {
    const row = {
      origin: input.origin,
      state: 'queued',
      topic: input.topic || '',
      custom_headline: input.customHeadline || '',
      batch_id: input.batchId || null,
      requested_by: input.requestedBy || null,
      provider: input.provider || 'nvidia_nim',
      model: input.model || process.env.NVIDIA_BLOG_MODEL || 'qwen/qwen3.5-122b-a10b',
      prompt_version: 'qwen-blog-v3',
      payload: input.payload || {},
      idempotency_key: input.idempotencyKey,
      scheduled_for: input.scheduledFor || null,
    };
    const client = getSupabaseAdminClient();
    if (!client) {
      const existing = [...memoryJobs.values()].find((job) => job.idempotency_key === input.idempotencyKey);
      if (existing) return toJob(existing);
      const stored = { ...row, id: randomUUID(), attempt_count: 0, max_attempts: 3, error: '', created_at: nowIso(), updated_at: nowIso() };
      memoryJobs.set(stored.id, stored);
      return toJob(stored);
    }
    const { data: existing, error: readError } = await client.from('blog_generation_jobs').select('*').eq('idempotency_key', input.idempotencyKey).maybeSingle();
    if (readError) throw readError;
    if (existing) return toJob(existing);
    const { data, error } = await client.from('blog_generation_jobs').insert(row).select('*').single();
    if (error?.code === '23505') {
      const { data: raced, error: racedError } = await client.from('blog_generation_jobs').select('*').eq('idempotency_key', input.idempotencyKey).single();
      if (racedError) throw racedError;
      return toJob(raced);
    }
    if (error) throw error;
    return toJob(data);
  },

  async createBatch(input: { createdBy: string; count: number; settings: Record<string, unknown>; maximumCost?: number | null }) {
    const row = { created_by: input.createdBy, requested_count: input.count, settings: input.settings, maximum_cost: input.maximumCost ?? null };
    const client = getSupabaseAdminClient();
    if (!client) {
      const stored = { ...row, id: randomUUID(), state: 'queued', completed_count: 0, failed_count: 0, created_at: nowIso(), updated_at: nowIso() };
      memoryBatches.set(stored.id, stored);
      return stored;
    }
    const { data, error } = await client.from('blog_batches').insert(row).select('*').single();
    if (error) throw error;
    return data;
  },

  async listJobs(limit = 100) {
    const safeLimit = Math.max(1, Math.min(200, limit));
    const client = getSupabaseAdminClient();
    if (!client) return [...memoryJobs.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, safeLimit).map(toJob);
    const { data, error } = await client.from('blog_generation_jobs').select('*').order('created_at', { ascending: false }).limit(safeLimit);
    if (error) throw error;
    return (data || []).map(toJob);
  },

  async retryJob(id: string) {
    const client = getSupabaseAdminClient();
    const patch = { state: 'queued', attempt_count: 0, locked_by: null, locked_at: null, lease_expires_at: null, error: '', completed_at: null, scheduled_for: null, updated_at: nowIso() };
    if (!client) {
      const existing = memoryJobs.get(id);
      if (!existing || !['failed', 'ready_for_review'].includes(existing.state)) return null;
      const stored = { ...existing, ...patch };
      memoryJobs.set(id, stored);
      return toJob(stored);
    }
    const { data, error } = await client.from('blog_generation_jobs').update(patch).eq('id', id).in('state', ['failed', 'ready_for_review']).select('*').maybeSingle();
    if (error) throw error;
    return data ? toJob(data) : null;
  },

  async updateJob(id: string, patch: { state?: BlogJobState; articleId?: string | null; result?: Record<string, unknown>; error?: string; completedAt?: string | null; inputTokens?: number | null; outputTokens?: number | null; actualCost?: number | null; generationStages?: string[] }) {
    const row: Row = {};
    if (patch.state) row.state = patch.state;
    if ('articleId' in patch) row.article_id = patch.articleId;
    if (patch.result) row.result = patch.result;
    if (patch.error != null) row.error = patch.error.slice(0, 1000);
    if ('completedAt' in patch) row.completed_at = patch.completedAt;
    if ('inputTokens' in patch) row.input_tokens = patch.inputTokens;
    if ('outputTokens' in patch) row.output_tokens = patch.outputTokens;
    if ('actualCost' in patch) row.actual_cost = patch.actualCost;
    if (patch.generationStages) row.generation_stages = patch.generationStages;
    const client = getSupabaseAdminClient();
    if (!client) {
      const existing = memoryJobs.get(id);
      if (!existing) return null;
      const stored = { ...existing, ...row, updated_at: nowIso() };
      memoryJobs.set(id, stored);
      return toJob(stored);
    }
    const { data, error } = await client.from('blog_generation_jobs').update(row).eq('id', id).select('*').maybeSingle();
    if (error) throw error;
    return data ? toJob(data) : null;
  },

  async claimJob(workerId: string) {
    const client = getSupabaseAdminClient();
    if (!client) {
      const row = [...memoryJobs.values()].find((job) => job.state === 'queued' && (!job.scheduled_for || new Date(job.scheduled_for).getTime() <= Date.now()));
      if (!row) return null;
      row.attempt_count = Number(row.attempt_count || 0) + 1;
      row.locked_by = workerId;
      row.locked_at = nowIso();
      row.lease_expires_at = new Date(Date.now() + 300_000).toISOString();
      row.updated_at = nowIso();
      return toJob(row);
    }
    const { data, error } = await client.rpc('claim_blog_generation_job', { worker_id: workerId, lease_seconds: 300 });
    if (error) throw error;
    const row = data?.[0];
    return row ? toJob(row) : null;
  },

  async upsertDiscovery(opportunity: BlogTrendOpportunity & { status?: string; priorityLabel?: string }) {
    const row = {
      source_url: opportunity.sourceUrl,
      source_title: opportunity.sourceTitle,
      publisher: opportunity.publisher,
      author: opportunity.author || '',
      published_at: opportunity.publishedAt,
      source_updated_at: opportunity.updatedAt || null,
      discovered_at: opportunity.discoveredAt,
      summary: opportunity.summary || '',
      topic_cluster: opportunity.topicCluster,
      search_intent: opportunity.searchIntent,
      proposed_angle: opportunity.proposedAngle,
      audience_relevance: opportunity.audienceRelevance,
      source_authority: opportunity.sourceAuthority,
      novelty: opportunity.novelty,
      primary_source: opportunity.primarySource,
      continuing_development: Boolean(opportunity.continuingDevelopment),
      existing_coverage: Boolean(opportunity.existingCoverage),
      freshness_status: opportunity.freshnessStatus || 'unverified',
      age_hours: opportunity.ageHours ?? null,
      priority_label: opportunity.priorityLabel || 'Insufficient evidence',
      priority_reason: opportunity.priorityReason || '',
      expires_at: opportunity.expiresAt || null,
      status: opportunity.status || 'monitor',
    };
    const client = getSupabaseAdminClient();
    if (!client) {
      const existing = [...memoryDiscoveries.values()].find((item) => item.source_url === row.source_url);
      const stored = { ...existing, ...row, id: existing?.id || randomUUID(), updated_at: nowIso() };
      memoryDiscoveries.set(stored.id, stored);
      return stored;
    }
    const { data, error } = await client.from('blog_trend_discoveries').upsert(row, { onConflict: 'source_url' }).select('*').single();
    if (error) throw error;
    return data;
  },

  async listDiscoveries(limit = 100) {
    const client = getSupabaseAdminClient();
    if (!client) return [...memoryDiscoveries.values()].slice(0, limit);
    const { data, error } = await client.from('blog_trend_discoveries').select('*').order('published_at', { ascending: false }).limit(Math.min(200, limit));
    if (error) throw error;
    return data || [];
  },

  async recordProviderHealth(input: { status: string; errorCode?: string | null; durationMs?: number | null; actorId?: string | null; testKind?: string }) {
    const config = getNvidiaBlogConfiguration();
    const patch = {
      provider_last_success_at: input.status === 'connected' ? nowIso() : memorySettings.provider_last_success_at,
      provider_last_error_code: input.errorCode || '',
      provider_last_duration_ms: input.durationMs ?? null,
      provider_live_verification_status: input.testKind === 'live' ? input.status : memorySettings.provider_live_verification_status,
    };
    const client = getSupabaseAdminClient();
    if (!client) { memorySettings = { ...memorySettings, ...patch }; return; }
    const [settingsResult, healthResult] = await Promise.all([
      client.from('blog_autopilot_settings').update(patch).eq('id', 'default'),
      client.from('blog_provider_health').insert({ provider: 'nvidia_nim', model: config.model, status: input.status, safe_error_code: input.errorCode || '', duration_ms: input.durationMs ?? null, test_kind: input.testKind || 'admin_test', actor_id: input.actorId || null }),
    ]);
    if (settingsResult.error) throw settingsResult.error;
    if (healthResult.error) throw healthResult.error;
  },

  async recordAutomaticReview(approved: boolean) {
    const client = getSupabaseAdminClient();
    if (!client) {
      memorySettings.automatic_articles_reviewed = Number(memorySettings.automatic_articles_reviewed || 0) + 1;
      memorySettings[approved ? 'automatic_articles_approved' : 'automatic_articles_rejected'] = Number(memorySettings[approved ? 'automatic_articles_approved' : 'automatic_articles_rejected'] || 0) + 1;
      return { ...memorySettings };
    }
    const settings = await blogAutomationRepository.getSettings();
    const patch = {
      automatic_articles_reviewed: Number(settings.automatic_articles_reviewed || 0) + 1,
      automatic_articles_approved: Number(settings.automatic_articles_approved || 0) + (approved ? 1 : 0),
      automatic_articles_rejected: Number(settings.automatic_articles_rejected || 0) + (approved ? 0 : 1),
    };
    const { data, error } = await client.from('blog_autopilot_settings').update(patch).eq('id', 'default').select('*').single();
    if (error) throw error;
    return data;
  },

  async overview(now = new Date()): Promise<BlogAdminOverview> {
    const [posts, jobs, discoveries, settings] = await Promise.all([blogRepository.listAdmin(200), blogAutomationRepository.listJobs(200), blogAutomationRepository.listDiscoveries(200), blogAutomationRepository.getSettings()]);
    const counts = countBlogOrigins(posts, jobs, now);
    const topicCounts = posts.reduce((result, post) => {
      const key = (post.topicCluster || post.title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (key) result.set(key, (result.get(key) || 0) + 1);
      return result;
    }, new Map<string, number>());
    const failedQualityCheck = (post: (typeof posts)[number], ids: string[]) => post.qualityResults?.checks?.some((check) => ids.includes(check.id) && !check.passed);
    return {
      ...counts,
      highPriorityStories: discoveries.filter((item: Row) => item.status === 'high_priority').length,
      expiringStories: discoveries.filter((item: Row) => item.expires_at && new Date(item.expires_at).getTime() > now.getTime() && new Date(item.expires_at).getTime() - now.getTime() <= 24 * 60 * 60 * 1000).length,
      draftsNeedingReview: posts.filter((post) => post.status === 'review' || post.status === 'needs_review').length,
      activeJobs: jobs.filter((job) => !['published', 'skipped', 'failed', 'cancelled'].includes(job.state)).length,
      unresolvedClaims: posts.filter((post) => /\[SOURCE REVIEW REQUIRED\]/i.test(post.contentText)).length,
      sourceFailures: posts.filter((post) => post.sourceStatus === 'blocked' || post.sourceStatus === 'needs_review').length,
      linkFailures: posts.filter((post) => failedQualityCheck(post, ['source-links', 'internal-links', 'descriptive-anchors'])).length,
      imageFailures: posts.filter((post) => post.imageStatus === 'blocked' || post.imageStatus === 'needs_review').length,
      qualityFailures: posts.filter((post) => post.qualityStatus === 'blocked').length,
      originalityWarnings: posts.filter((post) => post.originalityStatus !== 'passed').length,
      duplicateTopicWarnings: [...topicCounts.values()].filter((count) => count > 1).length,
      prerenderFailures: posts.filter((post) => post.prerenderStatus === 'blocked').length,
      updatesDue: posts.filter((post) => post.freshnessStatus === 'expired' || (post.freshnessStatus === 'low' && post.status === 'published')).length,
      sitemapReady: posts.filter((post) => post.status === 'published' && post.robotsDirective.startsWith('index')).length,
      rssReady: posts.filter((post) => post.status === 'published' && post.robotsDirective.startsWith('index')).length,
      providerInputTokens: jobs.reduce((total, job) => total + Number(job.inputTokens || 0), 0),
      providerOutputTokens: jobs.reduce((total, job) => total + Number(job.outputTokens || 0), 0),
      automaticReviewed: Number(settings.automatic_articles_reviewed || 0),
      automaticApproved: Number(settings.automatic_articles_approved || 0),
      automaticRejected: Number(settings.automatic_articles_rejected || 0),
      strictAutopilotUnlocked: Number(settings.automatic_articles_approved || 0) >= Number(settings.required_reviewed_articles_before_autopublish || 30),
    };
  },
};
