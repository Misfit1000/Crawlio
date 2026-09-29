import { createHash } from 'node:crypto';
import { requireSupabaseAdminClient } from './server';
import { toAuditDocument, toAuditPage, toAuditIssue, reportToRow } from './audit-repository';
import type { AuditScoreAggregate, AuditScoreCategory } from '../audit/audit-scoring';
import type { ResourceAuditDocument, ResourceAuditReport, AuditSeverity } from '../audit/resource-types';
import { EVIDENCE_MAX_PAGE_SIZE, EVIDENCE_PAGE_SIZE } from '../audit/scalable-policy';

export interface CrawlRun {
  audit_id: string;
  generation: number;
  owner: string;
  active_ms: number;
  budget_ms: number;
  candidate_limit: number;
  discovered: number;
  attempted: number;
  analysed: number;
  failed: number;
  blocked: number;
  page_count: number;
  error_pages: number;
  redirect_pages: number;
  slow_pages: number;
  large_pages: number;
  check_count: number;
  unavailable_count: number;
  failure_count: number;
  discovery_documents: number;
  last_score_pages: number;
  last_score_at: string | null;
  metadata: Record<string, unknown>;
}

export interface FrontierItem {
  key: string;
  url: string;
  kind: 'robots' | 'sitemap' | 'page';
  depth: number;
  source_url?: string;
  anchor?: string;
  attempts: number;
  next_attempt_at?: string;
  discovery_offset?: number;
}

export function frontierItem(url: string, kind: FrontierItem['kind'], depth = 0, source?: string, anchor?: string): FrontierItem {
  return { key: createHash('sha256').update(`${kind}:${url}`).digest('hex'), url, kind, depth, source_url: source?.slice(0, 2048), anchor: anchor?.slice(0, 160), attempts: 0 };
}

export async function scalableRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireSupabaseAdminClient().rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data as T;
}

let readinessCache: { until: number; ready: boolean; deepReady: boolean } | undefined;
export async function scalableReadiness(): Promise<{ ready: boolean; deepReady: boolean }> {
  if (process.env.SCALABLE_AUDITS_ENABLED !== 'true') return { ready: false, deepReady: false };
  if (readinessCache && readinessCache.until > Date.now()) return readinessCache;
  const { data, error } = await requireSupabaseAdminClient().from('audit_scalable_workers')
    .select('worker_id,deep_enabled').eq('processing_version', 2).gte('seen_at', new Date(Date.now() - 90_000).toISOString()).limit(20);
  if (error) return { ready: false, deepReady: false };
  readinessCache = { ready: !!data?.length, deepReady: !!data?.some(row => row.deep_enabled), until: Date.now() + 10_000 };
  return readinessCache;
}

export async function registerScalableWorker(workerId: string) {
  const { error } = await requireSupabaseAdminClient().from('audit_scalable_workers').upsert({
    worker_id: workerId, seen_at: new Date().toISOString(), processing_version: 2,
    commit_id: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT_SHA || 'local',
    deep_enabled: process.env.DEEP_AUDIT_ENABLED === 'true',
  });
  if (error) throw new Error(`Scalable audit schema is unavailable: ${error.message}`);
}

export async function claimScalableAudit(worker: string): Promise<{ audit: ResourceAuditDocument; run: CrawlRun } | null> {
  const result = await scalableRpc<{ audit: Record<string, unknown>; run: CrawlRun } | null>('claim_scalable_audit', { p_worker: worker, p_deep: process.env.DEEP_AUDIT_ENABLED === 'true' });
  const audit = result && toAuditDocument(result.audit);
  return result && audit ? { audit, run: result.run } : null;
}

export async function readFrontier(auditId: string, limit = 2): Promise<FrontierItem[]> {
  const client = requireSupabaseAdminClient();
  for (const kind of ['robots', 'root', 'sitemap', 'page']) {
    let query = client.from('audit_crawl_frontier').select('key,url,kind,depth,source_url,anchor,attempts,next_attempt_at,discovery_offset')
      .eq('audit_id', auditId).eq('state', 'pending').eq('kind', kind === 'root' ? 'page' : kind);
    if (kind === 'root') query = query.eq('depth', 0);
    if (kind !== 'robots') query = query.lte('next_attempt_at', new Date().toISOString());
    const { data, error } = await query
      .order('depth').order('key').limit(Math.min(2, limit));
    if (error) throw error;
    const ready = (data || []).filter(row => Date.parse(row.next_attempt_at) <= Date.now());
    if (ready.length) return ready as FrontierItem[];
    if (kind === 'robots' && data?.length) return [];
  }
  return [];
}

export async function hasPendingFrontier(auditId: string) {
  const { data, error } = await requireSupabaseAdminClient().from('audit_crawl_frontier').select('key').eq('audit_id', auditId).eq('state', 'pending').limit(1);
  if (error) throw error;
  return !!data?.length;
}

export async function readScoreAggregate(run: CrawlRun): Promise<AuditScoreAggregate> {
  const { data, error } = await requireSupabaseAdminClient().from('audit_score_groups').select('key,category,title,severity,affected_pages')
    .eq('audit_id', run.audit_id).order('key').limit(1000);
  if (error) throw error;
  if (data?.length === 1000) throw new Error('Scoring group bound reached; finalization requires investigation.');
  return {
    pageCount: run.page_count, errorPages: run.error_pages, redirectPages: run.redirect_pages,
    slowPages: run.slow_pages, largePages: run.large_pages,
    groups: (data || []).map(row => ({ key: row.key, category: row.category as AuditScoreCategory, title: row.title, severity: row.severity as AuditSeverity, affectedPages: row.affected_pages })),
  };
}

export async function finishScalableSlice(run: CrawlRun, report: ResourceAuditReport | null, reason?: string) {
  const finished = await scalableRpc<boolean>('scalable_audit_finish_slice', { p_audit: run.audit_id, p_worker: run.owner, p_generation: run.generation, p_report: report ? reportToRow(run.audit_id, report) : null, p_reason: reason || null });
  if (!finished) throw new Error('AUDIT_OWNERSHIP_LOST');
  return finished;
}

export type EvidenceKind = 'pages' | 'issues' | 'events';
export async function readEvidencePage(auditId: string, kind: EvidenceKind, input: { cursor?: string; limit?: number; severity?: string; category?: string } = {}) {
  const limit = Math.min(EVIDENCE_MAX_PAGE_SIZE, Math.max(1, Math.floor(input.limit || EVIDENCE_PAGE_SIZE)));
  if (input.cursor && !/^[a-zA-Z0-9_-]{1,100}$/.test(input.cursor)) throw new Error('Invalid evidence cursor');
  const table = kind === 'pages' ? 'audit_pages' : kind === 'issues' ? 'audit_issues' : 'audit_events';
  let query = requireSupabaseAdminClient().from(table).select('*').eq('audit_id', auditId).order('id').limit(limit + 1);
  if (input.cursor) query = query.gt('id', input.cursor);
  if (kind === 'issues' && input.severity) query = query.eq('severity', input.severity);
  if (kind === 'issues' && input.category) query = query.eq('category', input.category.slice(0, 100));
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data || []).slice(0, limit);
  const items = rows.map(row => kind === 'pages' ? toAuditPage(row) : kind === 'issues' ? toAuditIssue(row) : ({ id: row.id, type: row.type, timestamp: row.created_at, message: row.message, data: row.data }));
  return { items, nextCursor: (data?.length || 0) > limit ? String(rows.at(-1)!.id) : null, limit };
}
