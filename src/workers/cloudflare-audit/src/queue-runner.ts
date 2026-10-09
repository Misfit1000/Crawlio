import { analyseScalableItem, analysisFrontierItem, scoreOptions } from '../../../lib/audit/scalable-item-analysis';
import { buildScalableReport } from '../../../lib/audit/scalable-report';
import { calculateTransparentAuditScore, type AuditScoreAggregate } from '../../../lib/audit/audit-scoring';
import { shouldPublishProvisionalScore } from '../../../lib/audit/audit-provisional-score';
import { storedMeasuredAuditCategories } from '../../../lib/audit/audit-evidence-quality';
import { auditFocusLabel, normalizeAuditScope, scopeIncludesGroup } from '../../../lib/audit/audit-scope';
import { SCORING_VERSION, API_SCHEMA_VERSION, AUDIT_ENGINE_VERSION, CHECK_REGISTRY_VERSION } from '../../../lib/platform/version';
import { readToolEvidence } from '../../../lib/tools/audit-tools';
import type { ResourceAuditDocument, ResourceAuditPage, ResourceAuditIssue, ResourceAuditReport } from '../../../lib/audit/resource-types';
import type { CrawlRun, CommittedScoreGroup, EfficientCommitResult, FrontierItem } from '../../../lib/supabase/scalable-audit-repository';
import { HostRequestScheduler } from '../../host-request-scheduler';
import { cloudflareSafeFetch, createCloudflareFetchBudget } from './safe-fetch';
import { recordSecondaryProjectAuditOutcome } from './project-completion';

export interface SecondaryEnvironment {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  GIT_COMMIT_SHA: string;
}
export interface SliceOutcome { worked: boolean; completed: boolean; pages: number }

const workerId = 'cloudflare:secondary-v1';
const fail = (code: string) => Object.assign(new Error(code), { code });
const camelRow = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value]));

export function secondaryAudit(row: Record<string, unknown>): ResourceAuditDocument {
  if (row.processing_version !== 2 || typeof row.id !== 'string' || typeof row.normalized_url !== 'string' || !Number.isInteger(row.page_limit) || Number(row.page_limit) < 1 || Number(row.page_limit) > 5000) throw fail('INVALID_QUEUE_CONTRACT');
  const scope = normalizeAuditScope(row.audit_scope);
  if (row.audit_scope && !scope) throw fail('INVALID_QUEUE_CONTRACT');
  return { ...camelRow(row), scope: scope || null, effectiveMode: row.effective_mode || row.mode,
    planPageLimit: row.plan_page_limit ?? row.page_limit } as ResourceAuditDocument;
}

function aggregate(run: CrawlRun, groups: CommittedScoreGroup[]): AuditScoreAggregate {
  if (groups.length >= 1000) throw fail('SCORING_GROUP_BOUND');
  return { pageCount: run.page_count, errorPages: run.error_pages, redirectPages: run.redirect_pages, slowPages: run.slow_pages, largePages: run.large_pages,
    groups: groups.map(group => ({ ...group, affectedPages: group.affected_pages })) };
}

export async function runSecondarySlice(env: SecondaryEnvironment, fetchImpl: typeof fetch = fetch): Promise<SliceOutcome> {
  const origin = new URL(env.SUPABASE_URL || 'https://invalid.local');
  if (origin.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/.test(origin.hostname) || origin.port || !env.SUPABASE_SERVICE_ROLE_KEY) throw fail('SUPABASE_NOT_CONFIGURED');
  const network = createCloudflareFetchBudget(40);
  const db = async <T>(path: string, args?: Record<string, unknown>): Promise<T> => {
    try {
    network.consume();
    const response = await fetchImpl(new URL(`/rest/v1/${path}`, origin), { method: args ? 'POST' : 'GET', redirect: 'error',
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY!, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
      ...(args ? { body: JSON.stringify(args) } : {}), signal: AbortSignal.timeout(8_000) });
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (reader) try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 1_200_000) { await reader.cancel(); throw fail('DATABASE_RESPONSE_TOO_LARGE'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder().decode(body);
    if (!response.ok) {
      const code = /AUDIT_OWNERSHIP_LOST/.test(text) ? 'AUDIT_OWNERSHIP_LOST' : /SECONDARY_EXECUTOR_INCOMPATIBLE/.test(text) ? 'SECONDARY_EXECUTOR_INCOMPATIBLE' : 'DATABASE_REQUEST_FAILED';
      throw fail(code);
    }
    return text ? JSON.parse(text) as T : null as T;
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (['AUDIT_OWNERSHIP_LOST', 'SECONDARY_EXECUTOR_INCOMPATIBLE', 'DATABASE_RESPONSE_TOO_LARGE', 'DATABASE_REQUEST_FAILED', 'SUBREQUEST_BUDGET_EXCEEDED'].includes(code || '')) throw fail(code!);
      throw fail('DATABASE_REQUEST_FAILED');
    }
  };
  const rpc = <T>(name: string, args: Record<string, unknown>) => db<T>(`rpc/${name}`, args);
  const claimed = await rpc<EfficientCommitResult & { audit: Record<string, unknown> } | null>('claim_secondary_audit', {
    p_worker: workerId, p_commit: env.GIT_COMMIT_SHA, p_schema: API_SCHEMA_VERSION,
    p_engine: AUDIT_ENGINE_VERSION, p_scoring: SCORING_VERSION, p_checks: CHECK_REGISTRY_VERSION });
  if (!claimed) return { worked: false, completed: false, pages: 0 };
  let run = claimed.run;
  let audit: ResourceAuditDocument;
  const initialPages = run.analysed;
  let pending = claimed.pending;
  const groups = new Map(claimed.scoreGroups.map(group => [group.key, group]));
  const start = Date.now();
  let released = false;
  const commit = async (payload: Record<string, unknown>) => {
    const result = await rpc<EfficientCommitResult>('scalable_audit_commit_efficient', {
      p_audit: audit.id, p_worker: workerId, p_generation: run.generation,
      p_payload: { ...payload, phase: audit.scope ? `Running ${auditFocusLabel(audit.scope).toLowerCase()}` : 'Checking pages' } });
    run = result.run; pending = result.pending;
    for (const group of result.scoreGroups) groups.set(group.key, group);
  };
  const publish = async (force = false) => {
    if (!shouldPublishProvisionalScore({ pagesAnalysed: run.analysed, lastPublishedPages: run.last_score_pages,
      nowMs: Date.now(), lastPublishedAtMs: run.last_score_at ? Date.parse(run.last_score_at) : 0, force })) return;
    const score = calculateTransparentAuditScore({ issues: [], pages: [], aggregate: aggregate(run, [...groups.values()]), ...scoreOptions(run, audit) });
    await commit({ score: { overallScore: score.overall, categoryScores: Object.fromEntries(Object.entries(score.categories).map(([key, value]) => [key, value.score])),
      scoreState: 'provisional', pagesAnalysed: run.analysed, pagesDiscovered: run.discovered, pageLimit: audit.pageLimit,
      unavailableCount: run.unavailable_count, updatedAt: new Date().toISOString() } });
  };
  try {
    audit = secondaryAudit(claimed.audit);
    if (!run.metadata.initialized) {
      const root = new URL(audit.normalizedUrl).origin;
      const paths = audit.effectiveMode === 'deep' ? ['/sitemap.xml', '/sitemap_index.xml', '/page-sitemap.xml', '/post-sitemap.xml', '/product-sitemap.xml'] : ['/sitemap.xml'];
      const sitemap = audit.scope?.coverage !== 'page' || scopeIncludesGroup(audit.scope, 'crawlability');
      await commit({ seed: [analysisFrontierItem(new URL('/robots.txt', root).href, 'robots'), ...(sitemap ? paths.map(path => analysisFrontierItem(new URL(path, root).href, 'sitemap')) : [])],
        metadata: { initialized: true, scoringVersion: SCORING_VERSION, measuredCategories: [] } });
    }
    const scheduler = new HostRequestScheduler(1, 150);
    const fetcher = (url: string, options: Parameters<typeof cloudflareSafeFetch>[1]) => cloudflareSafeFetch(url, { ...options, subrequestBudget: network }, fetchImpl);
    let documents = 0;
    while (documents < 4 && Date.now() - start < 20_000 && network.remaining >= 28 && run.analysed < audit.pageLimit && run.active_ms + Date.now() - start < run.budget_ms) {
      const read = audit.scope?.coverage === 'page' && scopeIncludesGroup(audit.scope, 'crawlability') ? 'read_scoped_audit_frontier' : 'read_scalable_audit_frontier';
      const items = await rpc<FrontierItem[]>(read, { p_audit: audit.id, p_limit: 1 });
      if (!items.length) break;
      const item = items[0];
      const result = await analyseScalableItem(audit, run, item, scheduler, fetcher);
      const children = ((result.children || []) as FrontierItem[]).slice(item.discovery_offset || 0);
      let offset = item.discovery_offset || 0;
      let incompleteDiscovery = false;
      while (children.length > 100) {
        if (Date.now() - start >= 20_000 || network.remaining < 12) { incompleteDiscovery = true; break; }
        offset += 100;
        await commit({ items: [{ key: item.key, children: children.splice(0, 100), discoveryOnly: true, discoveryOffset: offset }] });
        if (run.discovered >= run.candidate_limit) children.splice(0, children.length, ...children.filter(child => child.kind !== 'page').slice(0, 128));
      }
      if (incompleteDiscovery) break;
      result.children = children;
      const metadata: Record<string, unknown> = result.robots ? { robots: result.robots } : result.robotsUnavailable ? { robotsUnavailable: true } : {};
      if (result.robotsEvidence) { metadata.robotsEvidence = result.robotsEvidence; metadata.robotsState = (result.robotsEvidence as { state: string }).state; }
      if (result.sitemapInspected) metadata.sitemapInspected = true;
      if (result.sitemapContainsTarget) metadata.sitemapContainsTarget = true;
      const measured = storedMeasuredAuditCategories(run.metadata.measuredCategories);
      const added = storedMeasuredAuditCategories(result.measuredCategories).filter(category => !measured.includes(category));
      if (added.length) metadata.measuredCategories = [...measured, ...added];
      delete result.measuredCategories;
      await commit({ items: [result], metadata, currentUrl: item.url });
      documents++;
      await publish();
    }
    await publish(true);
    const timedOut = run.active_ms + Date.now() - start >= run.budget_ms;
    // Leave enough budget for complete final evidence and project side effects.
    const completed = (run.analysed >= audit.pageLimit || timedOut || !pending) && network.remaining >= (audit.projectId ? 14 : 6);
    let terminalReport: ResourceAuditReport | null = null;
    if (completed) {
      if (Date.now() - start >= 30_000) await rpc('renew_scalable_audit_lease', {
        p_audit: audit.id, p_worker: workerId, p_generation: run.generation });
      const allGroups = await db<CommittedScoreGroup[]>(`audit_score_groups?audit_id=eq.${audit.id}&select=key,category,title,severity,affected_pages&order=key&limit=1000`);
      const pageRows = await db<Record<string, unknown>[]>(`audit_pages?audit_id=eq.${audit.id}&select=*&order=crawled_at.desc&limit=25`);
      const issueRows = await db<Record<string, unknown>[]>(`audit_issues?audit_id=eq.${audit.id}&select=*&order=detected_at.desc&limit=25`);
      const pages = pageRows.map(row => ({ ...camelRow(row), toolEvidence: readToolEvidence(row.tool_evidence) })) as unknown as ResourceAuditPage[];
      const issues = issueRows.map(camelRow) as unknown as ResourceAuditIssue[];
      const { report, reason } = buildScalableReport(audit, run, aggregate(run, allGroups), pages, issues, timedOut);
      terminalReport = report;
      const ok = await rpc<boolean>('scalable_audit_finish_slice', { p_audit: audit.id, p_worker: workerId, p_generation: run.generation,
        p_report: { audit_id: audit.id, scores: report.scores, summary: { text: report.summary }, pages: report.pages,
          top_issues: report.topIssues, presentation_summary: report.presentationSummary, exports: report.exports, generated_at: report.generatedAt }, p_reason: reason });
      if (!ok) throw fail('AUDIT_OWNERSHIP_LOST');
    } else {
      const ok = await rpc<boolean>('scalable_audit_finish_slice', { p_audit: audit.id, p_worker: workerId, p_generation: run.generation, p_report: null, p_reason: null });
      if (!ok) throw fail('AUDIT_OWNERSHIP_LOST');
    }
    released = true;
    if (completed) await recordSecondaryProjectAuditOutcome(env, audit, terminalReport, { fetchImpl, subrequestBudget: network })
      .catch(error => console.error(JSON.stringify({ event: 'secondary_project_completion_failed', code: (error as { code?: string }).code || 'PROJECT_COMPLETION_FAILED' })));
    await rpc('secondary_executor_slice_finished', { p_worker: workerId }).catch(() => undefined);
    return { worked: true, completed, pages: run.analysed - initialPages };
  } catch (error) {
    const code = (error as { code?: string }).code || 'SECONDARY_SLICE_FAILED';
    if (!released && code !== 'AUDIT_OWNERSHIP_LOST') await rpc('scalable_audit_finish_slice', { p_audit: run.audit_id, p_worker: workerId, p_generation: run.generation,
      p_report: null, p_reason: 'Secondary executor paused after a service error; work will resume' }).catch(() => undefined);
    await rpc('secondary_executor_slice_finished', { p_worker: workerId, p_error_code: code }).catch(() => undefined);
    throw error;
  }
}
