import { API_ROUTES } from '../api/routes';
import { getAuthHeaders } from '../api/auth-headers';
import { safeJsonFetch } from '../http/safe-json';
import type { BlogAdminOverview, BlogApprovedSource, BlogFixtureScenario, BlogGenerationJob, BlogListResult, BlogOperationsSnapshot, BlogPost, BlogPostInput, BlogSectionRevision } from './types';

type Envelope<T> = { success: boolean; data: T; error?: string };

async function request<T>(url: string, init?: RequestInit) {
  const response = await safeJsonFetch<Envelope<T>>(url, init);
  if (response.success === false) throw new Error(response.error);
  if (!response.data.success) throw new Error(response.data.error || 'Blog request failed.');
  return response.data.data;
}

export function getPublishedPosts(options: { query?: string; limit?: number; offset?: number } = {}) {
  const params = new URLSearchParams();
  if (options.query) params.set('q', options.query);
  params.set('limit', String(options.limit || 12));
  params.set('offset', String(options.offset || 0));
  return request<BlogListResult>(`${API_ROUTES.blogPosts}?${params}`);
}

export function getPublishedPost(slug: string) {
  return request<{ post: BlogPost }>(API_ROUTES.blogPost(slug));
}

export async function getAdminBlogPosts() {
  return request<{ posts: BlogPost[] }>(API_ROUTES.adminBlogPosts, { headers: await getAuthHeaders() });
}

export async function saveAdminBlogPost(input: BlogPostInput, id?: string) {
  return request<{ post: BlogPost }>(id ? API_ROUTES.adminBlogPost(id) : API_ROUTES.adminBlogPosts, {
    method: id ? 'PUT' : 'POST',
    headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(input),
  });
}

export async function archiveAdminBlogPost(id: string, reason: string) {
  return request<{ post: BlogPost }>(API_ROUTES.adminBlogPost(id), {
    method: 'DELETE',
    headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ reason }),
  });
}

export async function runAdminBlogWorkflow(id: string, input: { action: 'hold' | 'cancel' | 'publish_now' | 'reschedule' | 'convert_manual' | 'unschedule' | 'reset_recommended_time'; scheduledAt?: string | null; scheduleVersion?: number; reason: string }) {
  return request<{ post: BlogPost }>(API_ROUTES.adminBlogPostWorkflow(id), {
    method: 'POST', headers: await getAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(input),
  });
}

export async function getBlogAutomationDashboard() {
  return request<{ overview: BlogAdminOverview; jobs: BlogGenerationJob[]; discoveries: Array<Record<string, any>>; provider: { provider: string; execution: string; enabled: boolean; configured: boolean; model: string; structuredModel: string; writerModel: string; baseUrlHost: string; health?: string; fixtureAvailable?: boolean } }>(API_ROUTES.adminBlogOverview, { headers: await getAuthHeaders() });
}

export async function getBlogAutomationSettings() {
  return request<{ settings: Record<string, any> }>(API_ROUTES.adminBlogSettings, { headers: await getAuthHeaders() });
}

export async function saveBlogAutomationSettings(settings: Record<string, unknown>) {
  return request<{ settings: Record<string, any> }>(API_ROUTES.adminBlogSettings, {
    method: 'PUT', headers: await getAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(settings),
  });
}

export async function queueBlogJob(input: { mode: 'manual' | 'custom_headline' | 'discover' | 'fixture'; topic?: string; headline?: string; audience?: string; keywords?: string; feedUrls?: string[]; sourceUrls?: string[]; competitorUrls?: string[]; requestId?: string; articleType?: string; lengthMode?: string; customMinimum?: number; customMaximum?: number; fixtureScenario?: BlogFixtureScenario }) {
  return request<{ job: BlogGenerationJob }>(API_ROUTES.adminBlogJobs, {
    method: 'POST', headers: await getAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(input),
  });
}

export async function retryBlogJob(id: string) {
  return request<{ job: BlogGenerationJob }>(API_ROUTES.adminBlogJobRetry(id), { method: 'POST', headers: await getAuthHeaders() });
}

export async function queueBlogBatch(input: { headlines: string[]; audience?: string; keywords?: string; sourceUrls?: string[]; competitorUrls?: string[]; maximumCost?: number; articleType?: string; lengthMode?: string; customMinimum?: number; customMaximum?: number }) {
  return request<{ batch: Record<string, any>; jobs: BlogGenerationJob[] }>(API_ROUTES.adminBlogBatches, {
    method: 'POST', headers: await getAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(input),
  });
}

export async function testAdminBlogProvider() {
  return request<{ result: { status: string; model: string; host: string; durationMs: number | null; errorCode: string | null } }>(API_ROUTES.adminBlogProviderTest, { method: 'POST', headers: await getAuthHeaders() });
}

export async function getBlogSectionRevisions(articleId: string) {
  return request<{ revisions: BlogSectionRevision[] }>(API_ROUTES.adminBlogSectionRevisions(articleId), { headers: await getAuthHeaders() });
}

export async function queueBlogSectionRegeneration(articleId: string, sectionKey: string, action: string, useFixture = false) {
  return request<{ job: BlogGenerationJob }>(API_ROUTES.adminBlogSectionRegeneration(articleId), { method: 'POST', headers: await getAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ sectionKey, action, useFixture }) });
}

export async function decideBlogSectionRevision(revisionId: string, decision: 'accepted' | 'rejected') {
  return request<{ revision: BlogSectionRevision }>(API_ROUTES.adminBlogSectionRevisionDecision(revisionId), { method: 'POST', headers: await getAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ decision }) });
}

export async function importAdminBlogImage(input: { sourceUrl: string; creator?: string; publisher: string; licence: string; attribution?: string; attributionUrl?: string; altText: string; caption?: string; articleId?: string | null }) {
  return request<{ image: Record<string, any> }>(API_ROUTES.adminBlogImageImport, {
    method: 'POST', headers: await getAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(input),
  });
}

export async function getApprovedBlogSources() {
  return request<{ sources: BlogApprovedSource[] }>(API_ROUTES.adminBlogSources, { headers: await getAuthHeaders() });
}

export async function saveApprovedBlogSource(input: Partial<BlogApprovedSource>, id?: string) {
  return request<{ source: BlogApprovedSource }>(id ? API_ROUTES.adminBlogSource(id) : API_ROUTES.adminBlogSources, {
    method: id ? 'PUT' : 'POST', headers: await getAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(input),
  });
}

export async function testApprovedBlogSource(id: string) {
  return request<{ source: BlogApprovedSource; result: { success: boolean; safeFailureCode: string; itemCount: number } }>(API_ROUTES.adminBlogSourceTest(id), { method: 'POST', headers: await getAuthHeaders() });
}

export async function deleteApprovedBlogSource(id: string, reason: string) {
  return request<{ deleted: boolean }>(API_ROUTES.adminBlogSource(id), { method: 'DELETE', headers: await getAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ reason }) });
}

export async function runBlogTrendAction(id: string, action: string) {
  return request<{ discovery: Record<string, any>; job: BlogGenerationJob | null }>(API_ROUTES.adminBlogTrendAction(id), { method: 'POST', headers: await getAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ action }) });
}

export async function getBlogOperations() {
  return request<{ snapshot: BlogOperationsSnapshot; jobs: BlogGenerationJob[] }>(API_ROUTES.adminBlogOperations, { headers: await getAuthHeaders() });
}

export async function runBlogOperation(action: string, reason: string, targetId = '') {
  return request<{ result: unknown }>(API_ROUTES.adminBlogOperationAction, { method: 'POST', headers: await getAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ action, reason, targetId }) });
}
