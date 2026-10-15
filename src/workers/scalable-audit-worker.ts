import { auditRepository } from '../lib/supabase/audit-repository';
import { claimScalableAudit, finishScalableSlice, frontierItem, readFrontier, readScoreAggregate, registerScalableWorker, scalableRpc, scoreAggregateFromGroups, type EfficientCommitResult, type CrawlRun, type FrontierItem } from '../lib/supabase/scalable-audit-repository';
import { calculateTransparentAuditScore } from '../lib/audit/audit-scoring';
import { buildScalableReport } from '../lib/audit/scalable-report';
import { CRAWL_SLICE_MS, CRAWL_SLICE_PAGES } from '../lib/audit/scalable-policy';
import { shouldPublishProvisionalScore } from '../lib/audit/audit-provisional-score';
import { storedMeasuredAuditCategories } from '../lib/audit/audit-evidence-quality';
import type { ResourceAuditDocument, ResourceAuditReport } from '../lib/audit/resource-types';
import { safePublicFetch } from '../lib/security/safe-public-fetch';
import { SCORING_VERSION } from '../lib/platform/version';
import { HostRequestScheduler } from './host-request-scheduler';
import { isScalableWorkerStopRequested } from './scalable-worker-lifecycle';
import { recordProjectAuditCompletion, recordProjectAuditFailure } from '../lib/projects/completion';
import { workerFetchOptions } from './audit-worker';
import { auditFocusLabel, scopeIncludesGroup } from '../lib/audit/audit-scope';
import { analyseScalableItem as analyseItem, scoreOptions, type ScalableAnalysisFetcher } from '../lib/audit/scalable-item-analysis';
export { auditHtmlExtraction, selectedCheckModules, scoreGroups } from '../lib/audit/scalable-item-analysis';

const renderScalableFetch: ScalableAnalysisFetcher = (url, options) => safePublicFetch(url, {
  ...workerFetchOptions(options.timeoutMs ?? 10_000),
  ...options,
});

export function analyseScalableItem(audit: ResourceAuditDocument, run: CrawlRun, item: FrontierItem, scheduler: HostRequestScheduler, fetcher: ScalableAnalysisFetcher = renderScalableFetch): Promise<Record<string, unknown>> {
  return analyseItem(audit, run, item, scheduler, fetcher);
}

export async function runScalableSlice(workerId: string, onActivity?: (auditId: string | null) => Promise<void>): Promise<boolean> {
  if (isScalableWorkerStopRequested(workerId)) return false;
  const claimed = await claimScalableAudit(workerId);
  if (!claimed) return false;
  const { audit } = claimed;
  let run = claimed.run;
  let pending = claimed.pending;
  const committedGroups = new Map(claimed.scoreGroups.map(group => [group.key, group]));
  const started = Date.now();
  const scheduler = new HostRequestScheduler(2,150);
  let processed = 0;
  let writeChain: Promise<unknown> = Promise.resolve();
  let leaseError: unknown;
  let sliceReleased = false;
  const commit = (payload: Record<string,unknown>) => {
    const task = writeChain.then(async () => {
      if (leaseError) throw leaseError;
      const result = await scalableRpc<EfficientCommitResult>('scalable_audit_commit_efficient',{p_audit:audit.id,p_worker:workerId,p_generation:run.generation,p_payload:{...payload,phase:audit.scope ? `Running ${auditFocusLabel(audit.scope).toLowerCase()}` : 'Checking pages',rss:process.memoryUsage().rss}});
      run = result.run;
      pending = result.pending;
      for (const group of result.scoreGroups) committedGroups.set(group.key, group);
      if (committedGroups.size >= 1000) throw new Error('Scoring group bound reached; finalization requires investigation.');
    });
    writeChain = task.catch(error=>{leaseError=error;});
    return task;
  };
  let renewalPending = false;
  const leaseTimer = setInterval(()=>{
    if (renewalPending || leaseError) return;
    renewalPending = true;
    const task = writeChain.then(async () => {
      if (leaseError) throw leaseError;
      await scalableRpc('renew_scalable_audit_lease', { p_audit: audit.id, p_worker: workerId,
        p_generation: run.generation, p_rss: process.memoryUsage().rss });
    });
    writeChain = task.catch(error => { leaseError = error; });
    void task.catch(()=>undefined).finally(()=>{ renewalPending = false; });
  },30_000);
  leaseTimer.unref();
  const finish = async (report: ResourceAuditReport | null, reason?: string) => {
    // Keep renewing through report reads, then drain writes before releasing the lease.
    clearInterval(leaseTimer);
    await writeChain;
    if (leaseError) throw leaseError;
    await finishScalableSlice(run,report,reason);
    sliceReleased = true;
  };
  const publishScore = async (force = false) => {
    if (!shouldPublishProvisionalScore({ pagesAnalysed:run.analysed,lastPublishedPages:run.last_score_pages,nowMs:Date.now(),lastPublishedAtMs:run.last_score_at ? Date.parse(run.last_score_at) : 0,force })) return;
    const result = calculateTransparentAuditScore({issues:[],pages:[],aggregate:scoreAggregateFromGroups(run,[...committedGroups.values()]),...scoreOptions(run,audit)});
    await commit({score:{ overallScore:result.overall,categoryScores:Object.fromEntries(Object.entries(result.categories).map(([key,value])=>[key,value.score])),
      scoreState:'provisional',pagesAnalysed:run.analysed,pagesDiscovered:run.discovered,pageLimit:audit.pageLimit,unavailableCount:run.unavailable_count,updatedAt:new Date().toISOString() }});
  };
  try {
    await onActivity?.(audit.id);
    if (isScalableWorkerStopRequested(workerId)) {
      await finish(null);
      return true;
    }
    if (!run.metadata.initialized) {
      const origin = new URL(audit.normalizedUrl).origin;
      const sitemapPaths = audit.effectiveMode==='deep' ? ['/sitemap.xml','/sitemap_index.xml','/page-sitemap.xml','/post-sitemap.xml','/product-sitemap.xml'] : ['/sitemap.xml'];
      const needsSitemap = audit.scope?.coverage !== 'page' || scopeIncludesGroup(audit.scope,'crawlability');
      await commit({seed:[frontierItem(new URL('/robots.txt',origin).href,'robots'), ...(needsSitemap ? sitemapPaths.map(path=>frontierItem(new URL(path,origin).href,'sitemap')) : [])],metadata:{initialized:true,scoringVersion:SCORING_VERSION,measuredCategories:[]}});
    }
    let pauseReason: string | undefined;
    crawl: while (!isScalableWorkerStopRequested(workerId) && processed<CRAWL_SLICE_PAGES && Date.now()-started<CRAWL_SLICE_MS && run.analysed<audit.pageLimit && run.active_ms+Date.now()-started<run.budget_ms) {
      if (leaseError) throw leaseError;
      const memoryLimit = Math.max(128,Number(process.env.AUDIT_WORKER_RSS_LIMIT_MB || 384))*1024*1024;
      if (process.memoryUsage().rss>memoryLimit) { pauseReason='Worker memory pressure; waiting to resume'; break; }
      const nextScorePage = run.last_score_pages === 0 ? 1 : run.last_score_pages + 5;
      const untilScore = Math.max(1, nextScorePage - run.analysed);
      const items = await readFrontier(audit.id,Math.min(2,untilScore,audit.pageLimit-run.analysed,CRAWL_SLICE_PAGES-processed), audit.scope?.coverage==='page' && scopeIncludesGroup(audit.scope,'crawlability'));
      if (leaseError) throw leaseError;
      if (isScalableWorkerStopRequested(workerId)) break;
      if (!items.length) break;
      const results = await Promise.all(items.map(item=>analyseScalableItem(audit,run,item,scheduler)));
      const batchMetadata: Record<string, unknown> = {};
      for (const result of results) {
        // Discovery is inserted in bounded chunks before marking a document done.
        // A restart repeats inserts safely through the frontier's unique key.
        const source = items.find(item=>item.key===result.key)!;
        let discoveryOffset = source.discovery_offset || 0;
        const children = ((result.children || []) as FrontierItem[]).slice(discoveryOffset);
        while (children.length>100) {
          if (isScalableWorkerStopRequested(workerId) || Date.now()-started>=CRAWL_SLICE_MS || run.active_ms+Date.now()-started>=run.budget_ms) break crawl;
          discoveryOffset += 100;
          await commit({items:[{key:result.key,children:children.splice(0,100),discoveryOnly:true,discoveryOffset}]});
          if (run.discovered >= run.candidate_limit) {
            // Once the page budget is filled, only bounded sitemap documents remain useful.
            children.splice(0,children.length,...children.filter(child=>child.kind!=='page').slice(0,128));
          }
        }
        result.children = children;
        const metadata: Record<string, unknown> = result.robots ? {robots:result.robots} : result.robotsUnavailable ? {robotsUnavailable:true} : {};
        if (result.robotsEvidence) {
          metadata.robotsEvidence = result.robotsEvidence;
          metadata.robotsState = (result.robotsEvidence as { state: string }).state;
        }
        if (result.sitemapInspected) metadata.sitemapInspected = true;
        if (result.sitemapContainsTarget) metadata.sitemapContainsTarget = true;
        const measured = storedMeasuredAuditCategories(batchMetadata.measuredCategories || run.metadata.measuredCategories);
        const newlyMeasured = storedMeasuredAuditCategories(result.measuredCategories).filter(category => !measured.includes(category));
        if (newlyMeasured.length) metadata.measuredCategories = [...measured, ...newlyMeasured];
        delete result.measuredCategories;
        Object.assign(batchMetadata, metadata);
      }
      await commit({items:results,metadata:batchMetadata,currentUrl:items.at(-1)?.url});
      processed += results.length;
      await publishScore();
    }
    await publishScore(true);
    const timedOut=run.active_ms+Date.now()-started>=run.budget_ms;
    if (run.analysed>=audit.pageLimit || timedOut || !pending) {
      const aggregate = await readScoreAggregate(run);
      const [pages,topIssues]=await Promise.all([auditRepository.getLatestPages(audit.id,25),auditRepository.getLatestIssues(audit.id,25)]);
      const { report, reason } = buildScalableReport(audit, run, aggregate, pages, topIssues, timedOut);
      await finish(report,reason);
      const completed = await auditRepository.getAudit(audit.id);
      if (completed?.status === 'failed') await recordProjectAuditFailure(completed, completed.error || 'No usable evidence.').catch(()=>undefined);
      else if (completed && ['completed','completed_with_warnings'].includes(completed.status)) {
        await recordProjectAuditCompletion(completed, report).catch(()=>undefined);
      }
    } else await finish(null,pauseReason);
    return true;
  } catch (error) {
    clearInterval(leaseTimer);
    await writeChain;
    if (!sliceReleased && !String(error).includes('AUDIT_OWNERSHIP_LOST') && !String(leaseError).includes('AUDIT_OWNERSHIP_LOST')) await finishScalableSlice(run,null,'Audit paused after a service error; retrying').catch(()=>undefined);
    throw error;
  } finally {
    clearInterval(leaseTimer);
    await writeChain;
    try { await onActivity?.(null); } catch { /* Health reporting must not replace the durable slice outcome. */ }
  }
}

const registrations = new Map<string, { attemptedAt: number; task?: Promise<void> }>();
export function maintainScalableWorker(workerId: string): Promise<void> {
  const previous = registrations.get(workerId);
  if (previous?.task) return previous.task;
  if (previous && Date.now() - previous.attemptedAt < 30_000) return Promise.resolve();
  const registration = { attemptedAt: Date.now(), task: undefined as Promise<void> | undefined };
  const task = registerScalableWorker(workerId).finally(() => {
    registration.attemptedAt = Date.now();
    registration.task = undefined;
  });
  registration.task = task;
  registrations.set(workerId, registration);
  return task;
}
