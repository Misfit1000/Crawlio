import { randomUUID } from 'node:crypto';
import { getSupabaseAdminClient } from '../supabase/server';
import { estimateReadingTime } from './seo';
import type { BlogListResult, BlogPost, BlogPostStatus } from './types';
import { inspectBlogLinks } from './quality';
import type { CompetitorReferenceSnapshot } from './research';
import type { BlogSectionRevision } from './types';
import { replaceSelectedBlogSection, selectBlogSection } from './section-regeneration';

type BlogPostRow = Record<string, any>;

const memoryPosts = new Map<string, BlogPostRow>();
const memorySectionRevisions = new Map<string, Record<string, any>>();

function toPost(row: BlogPostRow): BlogPost {
  const contentText = String(row.content_text ?? row.contentText ?? '');
  return {
    id: String(row.id),
    slug: String(row.slug || ''),
    title: String(row.title || ''),
    excerpt: String(row.excerpt || ''),
    tagline: String(row.tagline || ''),
    summary: String(row.summary || row.excerpt || ''),
    contentHtml: String(row.content_html ?? row.contentHtml ?? ''),
    contentText,
    focusKeyword: String(row.focus_keyword ?? row.focusKeyword ?? ''),
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    seoTitle: String(row.seo_title ?? row.seoTitle ?? ''),
    metaDescription: String(row.meta_description ?? row.metaDescription ?? ''),
    canonicalUrl: String(row.canonical_url ?? row.canonicalUrl ?? ''),
    ogImageUrl: String(row.og_image_url ?? row.ogImageUrl ?? ''),
    ogTitle: String(row.og_title ?? row.ogTitle ?? row.seo_title ?? row.title ?? ''),
    ogDescription: String(row.og_description ?? row.ogDescription ?? row.meta_description ?? row.excerpt ?? ''),
    ogImageAlt: String(row.og_image_alt ?? row.ogImageAlt ?? ''),
    ogImageAttribution: String(row.og_image_attribution ?? row.ogImageAttribution ?? ''),
    imageVariants: Array.isArray(row.responsive_images ?? row.imageVariants) ? (row.responsive_images ?? row.imageVariants) : [],
    status: String(row.status || 'draft') as BlogPostStatus,
    origin: row.origin || 'admin_manual',
    articleType: String(row.article_type ?? row.articleType ?? 'evergreen guide'),
    topicCluster: String(row.topic_cluster ?? row.topicCluster ?? ''),
    language: String(row.language || 'en'),
    robotsDirective: String(row.robots_directive ?? row.robotsDirective ?? 'index,follow,max-image-preview:large'),
    freshnessStatus: row.freshness_status ?? row.freshnessStatus ?? 'evergreen',
    sourcePublishedAt: row.source_published_at ?? row.sourcePublishedAt ?? null,
    sourceUpdatedAt: row.source_updated_at ?? row.sourceUpdatedAt ?? null,
    discoveredAt: row.discovered_at ?? row.discoveredAt ?? null,
    continuingDevelopment: Boolean(row.continuing_development ?? row.continuingDevelopment),
    scheduledAt: row.scheduled_at ?? row.scheduledAt ?? null,
    recommendedPublicationAt: row.recommended_publication_at ?? row.recommendedPublicationAt ?? null,
    publicationRule: String(row.publication_rule ?? row.publicationRule ?? ''),
    publicationUrgency: String(row.publication_urgency ?? row.publicationUrgency ?? 'normal'),
    scheduleVersion: Number(row.schedule_version ?? row.scheduleVersion ?? 0),
    publicationReason: String(row.publication_reason ?? row.publicationReason ?? ''),
    qualityStatus: row.quality_status ?? row.qualityStatus ?? 'pending',
    qualityResults: row.quality_results ?? row.qualityResults ?? null,
    originalityStatus: row.originality_status ?? row.originalityStatus ?? 'pending',
    sourceStatus: row.source_status ?? row.sourceStatus ?? 'pending',
    prerenderStatus: row.prerender_status ?? row.prerenderStatus ?? 'pending',
    imageStatus: row.image_status ?? row.imageStatus ?? 'pending',
    sources: Array.isArray(row.sources) ? row.sources : [],
    relatedArticles: Array.isArray(row.related_articles ?? row.relatedArticles) ? (row.related_articles ?? row.relatedArticles) : [],
    generationJobId: row.generation_job_id ?? row.generationJobId ?? null,
    batchId: row.batch_id ?? row.batchId ?? null,
    authorId: row.author_id ?? row.authorId ?? null,
    reviewerId: row.reviewer_id ?? row.reviewerId ?? null,
    updatedBy: row.updated_by ?? row.updatedBy ?? null,
    publishedAt: row.published_at ?? row.publishedAt ?? null,
    createdAt: String(row.created_at ?? row.createdAt ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? new Date().toISOString()),
    readingTimeMinutes: estimateReadingTime(contentText),
  };
}

function isPublic(row: BlogPostRow) {
  return row.status === 'published' && row.published_at && new Date(row.published_at).getTime() <= Date.now() && (!row.robots_directive || String(row.robots_directive).startsWith('index'));
}

function publicMemoryRows() {
  return [...memoryPosts.values()].filter(isPublic).sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
}

export const blogRepository = {
  async listPublished({ query = '', limit = 12, offset = 0 } = {}): Promise<BlogListResult> {
    const safeLimit = Math.max(1, Math.min(30, Number(limit) || 12));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const search = String(query || '').replace(/[^\p{L}\p{N}\s'"-]/gu, ' ').trim().slice(0, 100);
    const client = getSupabaseAdminClient();
    if (!client) {
      const filtered = publicMemoryRows().filter((row) => !search || `${row.title} ${row.excerpt} ${row.content_text}`.toLowerCase().includes(search.toLowerCase()));
      return { posts: filtered.slice(safeOffset, safeOffset + safeLimit).map(toPost), total: filtered.length, limit: safeLimit, offset: safeOffset };
    }

    let request = client
      .from('blog_posts')
      .select('id,slug,title,excerpt,tagline,summary,focus_keyword,tags,seo_title,meta_description,canonical_url,og_image_url,og_title,og_description,og_image_alt,og_image_attribution,status,origin,article_type,topic_cluster,language,robots_directive,freshness_status,sources,related_articles,author_id,published_at,created_at,updated_at,content_text', { count: 'exact' })
      .eq('status', 'published')
      .like('robots_directive', 'index%')
      .not('published_at', 'is', null)
      .lte('published_at', new Date().toISOString())
      .order('published_at', { ascending: false })
      .range(safeOffset, safeOffset + safeLimit - 1);
    if (search) request = request.textSearch('search_vector', search, { config: 'english', type: 'websearch' });
    const { data, error, count } = await request;
    if (error) throw error;
    return { posts: (data || []).map(toPost), total: count || 0, limit: safeLimit, offset: safeOffset };
  },

  async getPublishedBySlug(slug: string) {
    const client = getSupabaseAdminClient();
    if (!client) {
      const row = [...memoryPosts.values()].find((item) => item.slug === slug && isPublic(item));
      return row ? toPost(row) : null;
    }
    const { data, error } = await client.from('blog_posts').select('*').eq('slug', slug).eq('status', 'published').lte('published_at', new Date().toISOString()).maybeSingle();
    if (error) throw error;
    return data ? toPost(data) : null;
  },

  async listAdmin(limit = 100) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 100));
    const client = getSupabaseAdminClient();
    if (!client) return [...memoryPosts.values()].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, safeLimit).map(toPost);
    const { data, error } = await client.from('blog_posts').select('*').order('updated_at', { ascending: false }).limit(safeLimit);
    if (error) throw error;
    return (data || []).map(toPost);
  },

  async getAdminById(id: string) {
    const client = getSupabaseAdminClient();
    if (!client) {
      const row = memoryPosts.get(id);
      return row ? toPost(row) : null;
    }
    const { data, error } = await client.from('blog_posts').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? toPost(data) : null;
  },

  async getByGenerationJobId(generationJobId: string) {
    const client = getSupabaseAdminClient();
    if (!client) {
      const row = [...memoryPosts.values()].find((item) => item.generation_job_id === generationJobId);
      return row ? toPost(row) : null;
    }
    const { data, error } = await client.from('blog_posts').select('*').eq('generation_job_id', generationJobId).maybeSingle();
    if (error) throw error;
    return data ? toPost(data) : null;
  },

  async slugExists(slug: string, exceptId?: string) {
    const client = getSupabaseAdminClient();
    if (!client) return [...memoryPosts.values()].some((row) => row.slug === slug && row.id !== exceptId);
    let request = client.from('blog_posts').select('id').eq('slug', slug).limit(1);
    if (exceptId) request = request.neq('id', exceptId);
    const { data, error } = await request;
    if (error) throw error;
    return Boolean(data?.length);
  },

  async create(row: BlogPostRow) {
    const now = new Date().toISOString();
    const client = getSupabaseAdminClient();
    if (!client) {
      const stored = { ...row, id: randomUUID(), created_at: now, updated_at: now };
      memoryPosts.set(stored.id, stored);
      return toPost(stored);
    }
    const { data, error } = await client.from('blog_posts').insert(row).select('*').single();
    if (error) throw error;
    return toPost(data);
  },

  async update(id: string, row: BlogPostRow) {
    const client = getSupabaseAdminClient();
    if (!client) {
      const existing = memoryPosts.get(id);
      if (!existing) return null;
      const stored = { ...existing, ...row, id, updated_at: new Date().toISOString() };
      memoryPosts.set(id, stored);
      return toPost(stored);
    }
    const { data, error } = await client.from('blog_posts').update(row).eq('id', id).select('*').maybeSingle();
    if (error) throw error;
    return data ? toPost(data) : null;
  },

  async createSectionRevision(input: { articleId: string; generationJobId?: string | null; actorId?: string | null; sectionKey: string; action: string; beforeHtml: string; afterHtml: string; sourceSnapshot: unknown; validationResults: unknown }) {
    const row = { article_id: input.articleId, generation_job_id: input.generationJobId || null, actor_id: input.actorId || null, section_key: input.sectionKey, action: input.action, before_html: input.beforeHtml, after_html: input.afterHtml, source_snapshot: input.sourceSnapshot, validation_results: input.validationResults, status: 'pending' };
    const client = getSupabaseAdminClient();
    if (!client) {
      const existing = [...memorySectionRevisions.values()].find((item) => item.article_id === input.articleId && item.section_key === input.sectionKey && item.status === 'pending');
      if (existing) return existing;
      const stored = { ...row, id: randomUUID(), created_at: new Date().toISOString(), decided_at: null };
      memorySectionRevisions.set(stored.id, stored);
      return stored;
    }
    const { data, error } = await client.from('blog_section_revisions').insert(row).select('*').single();
    if (error?.code === '23505') {
      const { data: existing, error: readError } = await client.from('blog_section_revisions').select('*').eq('article_id', input.articleId).eq('section_key', input.sectionKey).eq('status', 'pending').single();
      if (readError) throw readError;
      return existing;
    }
    if (error) throw error;
    return data;
  },

  async listSectionRevisions(articleId: string) {
    const client = getSupabaseAdminClient();
    const rows = client
      ? await client.from('blog_section_revisions').select('*').eq('article_id', articleId).order('created_at', { ascending: false }).limit(30)
      : { data: [...memorySectionRevisions.values()].filter((item) => item.article_id === articleId).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))), error: null };
    if (rows.error) throw rows.error;
    return (rows.data || []).map((row: any): BlogSectionRevision => ({ id: String(row.id), articleId: String(row.article_id), sectionKey: String(row.section_key), action: String(row.action), beforeHtml: String(row.before_html), afterHtml: String(row.after_html), status: row.status, createdAt: String(row.created_at) }));
  },

  async decideSectionRevision(id: string, decision: 'accepted' | 'rejected', actorId: string) {
    const client = getSupabaseAdminClient();
    const read = client
      ? await client.from('blog_section_revisions').select('*').eq('id', id).eq('status', 'pending').maybeSingle()
      : { data: memorySectionRevisions.get(id) || null, error: null };
    if (read.error) throw read.error;
    const revision = read.data as any;
    if (!revision) return null;
    const post = await blogRepository.getAdminById(revision.article_id);
    if (!post) return null;
    if (decision === 'accepted') {
      const selection = selectBlogSection(post, revision.section_key);
      if (selection.beforeHtml !== revision.before_html) throw new Error('The article changed after this revision was created. Regenerate the section against the current draft.');
      const replacement = replaceSelectedBlogSection(post, selection, revision.after_html);
      const row = 'tagline' in replacement ? { tagline: replacement.tagline } : 'summary' in replacement ? { summary: replacement.summary } : 'metaDescription' in replacement ? { meta_description: replacement.metaDescription } : { content_html: replacement.contentHtml };
      const updated = await blogRepository.update(post.id, { ...row, updated_by: actorId });
      if (!updated) return null;
      await blogRepository.syncEditorialRecords(updated, actorId, post.status);
    }
    const decidedAt = new Date().toISOString();
    if (!client) {
      memorySectionRevisions.set(id, { ...revision, status: decision, decided_at: decidedAt });
    } else {
      const { error } = await client.from('blog_section_revisions').update({ status: decision, decided_at: decidedAt }).eq('id', id).eq('status', 'pending');
      if (error) throw error;
    }
    return { ...revision, status: decision, decided_at: decidedAt };
  },

  async sitemapRows() {
    const client = getSupabaseAdminClient();
    if (!client) return publicMemoryRows().filter((row) => String(row.robots_directive || 'index').startsWith('index')).map((row) => ({ slug: String(row.slug), updatedAt: String(row.updated_at), imageUrl: String(row.og_image_url || '') }));
    const { data, error } = await client.from('blog_posts').select('slug,updated_at,og_image_url').eq('status', 'published').like('robots_directive', 'index%').lte('published_at', new Date().toISOString()).order('published_at', { ascending: false }).limit(5000);
    if (error) throw error;
    return (data || []).map((row) => ({ slug: String(row.slug), updatedAt: String(row.updated_at), imageUrl: String(row.og_image_url || '') }));
  },

  async relatedPublished(post: BlogPost, limit = 4) {
    const client = getSupabaseAdminClient();
    if (!client) return publicMemoryRows().filter((row) => row.id !== post.id && (!post.topicCluster || row.topic_cluster === post.topicCluster)).slice(0, limit).map(toPost);
    let request = client.from('blog_posts').select('*').eq('status', 'published').lte('published_at', new Date().toISOString()).neq('id', post.id).order('published_at', { ascending: false }).limit(limit);
    if (post.topicCluster) request = request.eq('topic_cluster', post.topicCluster);
    const { data, error } = await request;
    if (error) throw error;
    return (data || []).map(toPost);
  },

  async syncEditorialRecords(post: BlogPost, actorId: string | null, previousStatus = '') {
    const client = getSupabaseAdminClient();
    if (!client) return;
    const links = inspectBlogLinks(post.contentHtml);
    const sourceRows = post.sources.map((source) => ({
      article_id: post.id, url: source.url, title: source.title, publisher: source.publisher, author: source.author || '',
      published_at: source.publishedAt || null, updated_at_source: source.updatedAt || null, accessed_at: source.accessedAt || new Date().toISOString(),
      source_type: source.sourceType || 'reference', supported_claims: source.supportedClaims || [], primary_source: Boolean(source.primary),
      reliability: source.reliability || 'unverified', citation_status: source.citationStatus || 'needs_review',
    }));
    const linkRows = links.map((link) => ({ article_id: post.id, link_type: /^https?:\/\//i.test(link.href) ? 'external' : 'internal', href: link.href, anchor_text: link.anchor, canonical: true, validation_status: 'passed' }));
    linkRows.push(...post.relatedArticles.map((related) => ({ article_id: post.id, link_type: 'related', href: `/blog/${related.slug}`, anchor_text: related.title, canonical: true, validation_status: 'passed' })));
    const [sourcesDelete, linksDelete] = await Promise.all([
      client.from('blog_sources').delete().eq('article_id', post.id),
      client.from('blog_links').delete().eq('article_id', post.id),
    ]);
    if (sourcesDelete.error) throw sourcesDelete.error;
    if (linksDelete.error) throw linksDelete.error;
    if (sourceRows.length) { const { error } = await client.from('blog_sources').insert(sourceRows); if (error) throw error; }
    if (linkRows.length) { const { error } = await client.from('blog_links').insert(linkRows); if (error) throw error; }
    if (post.qualityResults) {
      const { error } = await client.from('blog_quality_results').insert({ article_id: post.id, generation_job_id: post.generationJobId, gate_type: 'content', status: post.qualityResults.status === 'pending' ? 'needs_review' : post.qualityResults.status, checks: post.qualityResults.checks, blocked_reasons: post.qualityResults.blockedReasons, checked_at: post.qualityResults.checkedAt });
      if (error) throw error;
    }
    const { error: revisionError } = await client.from('blog_revisions').insert({ article_id: post.id, actor_id: actorId, origin: post.origin, previous_state: previousStatus, new_state: post.status, reason: previousStatus === post.status ? 'Content or metadata updated.' : 'Editorial state changed.', snapshot: { title: post.title, slug: post.slug, qualityStatus: post.qualityStatus, sourceStatus: post.sourceStatus, originalityStatus: post.originalityStatus, prerenderStatus: post.prerenderStatus, imageStatus: post.imageStatus } });
    if (revisionError) throw revisionError;
    if (previousStatus !== post.status) {
      const { error: eventError } = await client.from('blog_publication_events').insert({ article_id: post.id, generation_job_id: post.generationJobId, actor_id: actorId, event_type: 'state_change', previous_state: previousStatus, new_state: post.status, reason: post.publicationReason, scheduled_for: post.scheduledAt });
      if (eventError) throw eventError;
    }
  },

  async publishDueScheduled(limit = 10) {
    const client = getSupabaseAdminClient();
    if (!client) return [] as string[];
    const { data: settings, error: settingsError } = await client.from('blog_autopilot_settings').select('strict_autopilot_enabled,required_reviewed_articles_before_autopublish,automatic_articles_approved,emergency_pause,pause_all_publication,maintenance_mode').eq('id', 'default').single();
    if (settingsError) throw settingsError;
    if (settings.pause_all_publication || settings.maintenance_mode) return [] as string[];
    const { data, error } = await client.from('blog_posts').select('id,scheduled_at,origin,freshness_status,source_published_at,source_updated_at,quality_status').eq('status', 'scheduled').in('quality_status', ['passed', 'needs_review']).eq('originality_status', 'passed').eq('source_status', 'passed').eq('prerender_status', 'passed').in('image_status', ['passed', 'not_required']).lte('scheduled_at', new Date().toISOString()).order('scheduled_at', { ascending: true }).limit(Math.max(1, Math.min(20, limit)));
    if (error) throw error;
    const published: string[] = [];
    for (const row of data || []) {
      const automatic = row.origin === 'autopilot' || row.origin === 'trend_autopilot';
      const automaticUnlocked = settings.strict_autopilot_enabled === true
        && settings.emergency_pause !== true
        && Number(settings.automatic_articles_approved || 0) >= Number(settings.required_reviewed_articles_before_autopublish || 30);
      if (automatic && !automaticUnlocked) {
        const { error: reviewError } = await client.from('blog_posts').update({ status: 'needs_review', robots_directive: 'noindex,nofollow', publication_reason: 'Review-first rollout prevents automatic publication.' }).eq('id', row.id).eq('status', 'scheduled');
        if (reviewError) throw reviewError;
        continue;
      }
      const timestamp = new Date().toISOString();
      const staleAutomaticStory = row.origin === 'trend_autopilot' && row.freshness_status === 'expired';
      if (staleAutomaticStory) {
        const { error: holdError } = await client.from('blog_posts').update({ status: 'needs_review', robots_directive: 'noindex,nofollow', publication_reason: 'Automatic publication held because editorial freshness is marked expired.' }).eq('id', row.id).eq('status', 'scheduled');
        if (holdError) throw holdError;
        const { error: holdEventError } = await client.from('blog_publication_events').insert({ article_id: row.id, event_type: 'freshness_hold', previous_state: 'scheduled', new_state: 'needs_review', scheduled_for: row.scheduled_at, reason: 'Editorial freshness is explicitly marked expired.' });
        if (holdEventError) throw holdEventError;
        continue;
      }
      const { data: updated, error: updateError } = await client.from('blog_posts').update({ status: 'published', published_at: timestamp, robots_directive: 'index,follow,max-image-preview:large' }).eq('id', row.id).eq('status', 'scheduled').select('id').maybeSingle();
      if (updateError) throw updateError;
      if (!updated) continue;
      published.push(row.id);
      const { error: eventError } = await client.from('blog_publication_events').insert({ article_id: row.id, event_type: 'scheduled_publish', previous_state: 'scheduled', new_state: 'published', scheduled_for: row.scheduled_at, reason: 'Configured publication time reached after all gates passed.' });
      if (eventError) throw eventError;
    }
    return published;
  },

  async storeCompetitorResearch(articleId: string, references: CompetitorReferenceSnapshot[], brief: { coveredSubtopics: string[]; contentGaps: string[]; formatObservations: string[]; proposedOriginalAngle: string; trafficLabel: string }) {
    const client = getSupabaseAdminClient();
    if (!client || !references.length) return;
    const rows = references.map((reference) => ({
      article_id: articleId, reference_url: reference.url, covered_subtopics: reference.observedTopics,
      format_observations: brief.formatObservations, content_gaps: brief.contentGaps, outdated_information: [],
      proposed_original_angle: brief.proposedOriginalAngle, traffic_label: brief.trafficLabel, traffic_data_source: '', traffic_observed_at: null,
      similarity_risk: 'needs_review', plagiarism_status: 'pending',
    }));
    const { error } = await client.from('blog_competitor_research').insert(rows);
    if (error) throw error;
  },
};

export { toPost as mapBlogPostRow };
