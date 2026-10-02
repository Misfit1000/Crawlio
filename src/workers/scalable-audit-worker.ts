import { createHash } from 'node:crypto';
import { auditRepository, issueToRow, pageToRow } from '../lib/supabase/audit-repository';
import { claimScalableAudit, finishScalableSlice, frontierItem, hasPendingFrontier, readFrontier, readScoreAggregate, registerScalableWorker, scalableRpc, type CrawlRun, type FrontierItem } from '../lib/supabase/scalable-audit-repository';
import { calculateTransparentAuditScore, categoryForIssue, deduplicatePageIssues, normalizedIssueKey, toReportScoreRecord } from '../lib/audit/audit-scoring';
import { CRAWL_SLICE_MS, CRAWL_SLICE_PAGES, retryDelayMs } from '../lib/audit/scalable-policy';
import { getAuditModeConfig } from '../lib/audit/audit-config';
import { getAuditProfileForDocument, isSeoIssueAllowedForProfile } from '../lib/audit/audit-profiles';
import { shouldPublishProvisionalScore } from '../lib/audit/audit-provisional-score';
import { readAuditPresentationSummary } from '../lib/audit/audit-presentation-summary';
import { measuredAuditCategories, storedMeasuredAuditCategories } from '../lib/audit/audit-evidence-quality';
import { classifyAuditFailure, failureForCode, failureForHttpStatus, type AuditFailure } from '../lib/audit/audit-failures';
import type { ResourceAuditDocument, ResourceAuditIssue, ResourceAuditPage, ResourceAuditReport } from '../lib/audit/resource-types';
import { CHECKS, runCheckSetSafely } from '../lib/seo/checks/runner';
import { isSameDomain } from '../lib/seo/url-utils';
import { createRobotsFetchEvidence, parseRobotsTxt, isBlockedByRobots } from '../lib/seo/robots';
import { collectToolEvidence } from '../lib/tools/audit-tools';
import { parseSitemapXml } from '../lib/seo/sitemap';
import { safePublicFetch } from '../lib/security/safe-public-fetch';
import { AUDIT_ENGINE_VERSION, SCORING_VERSION, LEGACY_SCORING_VERSION, CHECK_REGISTRY_VERSION } from '../lib/platform/version';
import { HostRequestScheduler } from './host-request-scheduler';
import { isScalableWorkerStopRequested } from './scalable-worker-lifecycle';
import { recordProjectAuditCompletion, recordProjectAuditFailure } from '../lib/projects/completion';
import { buildSecurityIssues, fetchHtmlPage, mapAuditIssue, normalizeCrawlUrl, workerFetchOptions } from './audit-worker';

const severityRanks = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
const stableId = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 40);
const QUICK_CHECK_MODULES = new Set(['images', 'indexability', 'robots', 'sitemap', 'security', 'on-page', 'content', 'accessibility']);

function scoreOptions(run: CrawlRun): { scoringVersion: '2.1' | '2.2'; measuredCategories?: ReturnType<typeof measuredAuditCategories> } {
  const scoringVersion = run.metadata.scoringVersion === SCORING_VERSION ? SCORING_VERSION : LEGACY_SCORING_VERSION;
  return {
    scoringVersion,
    measuredCategories: !run.analysed ? [] : scoringVersion === SCORING_VERSION
      ? storedMeasuredAuditCategories(run.metadata.measuredCategories) : undefined,
  };
}

export function scoreGroups(issues: ResourceAuditIssue[]) {
  const groups = new Map<string, { key: string; category: string; title: string; severity: string; rank: number }>();
  for (const issue of issues) {
    if (issue.severity === 'info') continue;
    const key = normalizedIssueKey(issue);
    const rank = severityRanks[issue.severity];
    if (!groups.has(key) || groups.get(key)!.rank < rank) groups.set(key, { key, category: categoryForIssue(issue), title: issue.title, severity: issue.severity, rank });
  }
  return [...groups.values()];
}

function eligibleChild(audit: ResourceAuditDocument, url: string, kind: FrontierItem['kind'], depth: number, source?: string, anchor?: string) {
  const clean = normalizeCrawlUrl(url, source || audit.normalizedUrl);
  if (!clean || Buffer.byteLength(clean) > 2048 || depth > 100 || !isSameDomain(clean, audit.normalizedUrl)) return null;
  return frontierItem(clean, kind, depth, source, anchor);
}

function failurePage(audit: ResourceAuditDocument, item: FrontierItem, failure: AuditFailure) {
  const now = new Date().toISOString();
  const page: ResourceAuditPage = { id: stableId(`${audit.id}:${item.url}`), url: item.url, statusCode: failure.httpStatus || 0,
    responseTimeMs: 0, pageSizeBytes: 0, title: '', metaDescription: '', h1: '', wordCount: 0, crawlDepth: item.depth,
    issueCount: 1, crawledAt: now, fetchStatus: failure.code === 'ROBOTS_BLOCKED' ? 'blocked' : 'failed',
    failureCode: failure.code, failureCategory: failure.category, safeTitle: failure.safeTitle, safeExplanation: failure.safeExplanation,
    suggestedAction: failure.suggestedAction, retryable: failure.retryable, attemptCount: item.attempts + 1, sourceUrl: item.source_url };
  const issue: ResourceAuditIssue = { id: stableId(`${audit.id}:${item.url}:${failure.code}`), severity: failure.code === 'ROBOTS_BLOCKED' ? 'info' : 'high',
    category: 'crawlability', title: failure.safeTitle, description: failure.safeExplanation, affectedUrl: item.url,
    evidence: failure.httpStatus ? `HTTP ${failure.httpStatus}` : failure.safeTitle, recommendation: failure.suggestedAction,
    checkId: failure.code, failureCode: failure.code, findingKey: `${failure.code}|${item.url}`.toLowerCase(), detectedAt: now };
  return { key: item.key, page: pageToRow(audit.id, page), issues: [issueToRow(audit.id, issue)], groups: scoreGroups([issue]), checks: 1, children: [] };
}

export async function analyseScalableItem(audit: ResourceAuditDocument, run: CrawlRun, item: FrontierItem, scheduler: HostRequestScheduler): Promise<Record<string, unknown>> {
  const config = getAuditModeConfig(audit.effectiveMode);
  try {
    if (item.kind === 'sitemap' && run.metadata.robotsUnavailable) return {key:item.key,children:[]};
    if (item.kind !== 'page') {
      const response = await scheduler.schedule(item.url, () => safePublicFetch(item.url, {
        ...workerFetchOptions(config.timeoutMs), maxBytes: item.kind === 'robots' ? 128_000 : 2_000_000,
        allowedContentTypes: item.kind === 'robots' ? ['text/plain','text/html'] : ['application/xml','text/xml','text/plain','application/xhtml+xml'],
      }));
      if ((response.status === 429 || response.status >= 500) && item.attempts < 2) {
        return { key: item.key, retryAt: new Date(Date.now() + retryDelayMs(response.headers['retry-after'], item.attempts)).toISOString() };
      }
      if (item.kind === 'robots') {
        const { document, ...robotsEvidence } = createRobotsFetchEvidence({ status: response.status, body: response.body, url: item.url });
        if (robotsEvidence.policy === 'disallow-all') return { key: item.key, children: [], robotsUnavailable: true, robotsEvidence };
        const rules = document || parseRobotsTxt('');
        return { key: item.key, children: rules.sitemaps.map(url => eligibleChild(audit,url,'sitemap',0,item.url)).filter(Boolean), robots: rules, robotsEvidence };
      }
      const parsed = response.status >= 200 && response.status < 300 ? parseSitemapXml(response.body) : { urls: [], sitemaps: [], errors: [`HTTP ${response.status}`] };
      const children = [ ...parsed.urls.map(url => eligibleChild(audit,url,'page',1,item.url)), ...parsed.sitemaps.map(url => eligibleChild(audit,url,'sitemap',0,item.url)) ].filter(Boolean);
      return { key: item.key, children, discoveryErrors: parsed.errors };
    }
    if (run.metadata.robotsUnavailable || (run.metadata.robots && isBlockedByRobots(item.url, run.metadata.robots))) return failurePage(audit,item,failureForCode('ROBOTS_BLOCKED',{ affectedUrl: item.url }));
    const fetched = await scheduler.schedule(item.url, () => fetchHtmlPage(item.url,config.timeoutMs));
    if ([429,502,503,504].includes(fetched.statusCode) && item.attempts < 2) {
      return { key: item.key, retryAt: new Date(Date.now()+retryDelayMs(fetched.headers['retry-after'],item.attempts)).toISOString() };
    }
    if (!isSameDomain(fetched.finalUrl,audit.normalizedUrl)) return failurePage(audit,item,failureForCode('UNKNOWN_TARGET_FAILURE',{ affectedUrl: item.url, internalDetails: 'Redirect left the audited domain.' }));
    if (fetched.statusCode>=400) return failurePage(audit,item,failureForHttpStatus(fetched.statusCode,{ affectedUrl:item.url,attemptCount:item.attempts+1 }));
    if (!fetched.html.trim()) return failurePage(audit,item,failureForCode('EMPTY_RESPONSE',{ affectedUrl:item.url }));
    const profile = getAuditProfileForDocument(audit);
    const checkModules = run.metadata.scoringVersion === SCORING_VERSION && profile.processingTier === 'free'
      ? CHECKS.filter(check => QUICK_CHECK_MODULES.has(check.id)) : CHECKS;
    const checks = runCheckSetSafely(checkModules, { ...fetched.parsed, url:fetched.finalUrl,finalUrl:fetched.finalUrl,status:fetched.statusCode,
      headers:fetched.headers,loadTimeMs:fetched.responseTimeMs,pageSizeBytes:fetched.pageSizeBytes,contentType:fetched.contentType,depth:item.depth });
    const now = new Date().toISOString();
    const recordedIssues: ResourceAuditIssue[] = [ ...checks.issues.filter(issue=>isSeoIssueAllowedForProfile(profile,issue)).map(issue=>mapAuditIssue(issue,fetched.finalUrl)), ...buildSecurityIssues(fetched) ]
      .map(issue=>({ ...issue, id:stableId(`${audit.id}:${fetched.finalUrl}:${issue.checkId || issue.title}:${issue.category}`),detectedAt:now }));
    const issues = run.metadata.scoringVersion === SCORING_VERSION ? deduplicatePageIssues(recordedIssues) : recordedIssues;
    const page: ResourceAuditPage = { id:stableId(`${audit.id}:${fetched.finalUrl}`),url:fetched.finalUrl,statusCode:fetched.statusCode,
      responseTimeMs:fetched.responseTimeMs,pageSizeBytes:fetched.pageSizeBytes,title:fetched.parsed?.title || '',metaDescription:fetched.parsed?.metaDescription || '',
      h1:fetched.parsed?.h1?.[0] || '',canonicalUrl:fetched.parsed?.canonical || '',siteName:fetched.parsed?.siteName || '',faviconUrl:fetched.parsed?.faviconUrl || '',
      openGraphImage:fetched.parsed?.ogImage || '',themeColor:fetched.parsed?.themeColor || '',wordCount:fetched.parsed?.wordCount || 0,
      crawlDepth:item.depth,issueCount:issues.length,crawledAt:now,fetchStatus:'success',attemptCount:item.attempts+1,recoveredAfterRetry:item.attempts>0,sourceUrl:item.source_url };
    page.toolEvidence = collectToolEvidence({ ...fetched, requestedUrl: item.url,
      robotsAllowed: run.metadata.robots && run.metadata.robotsState !== 'malformed' ? !isBlockedByRobots(item.url, run.metadata.robots) : null });
    const children = (fetched.parsed?.internalLinks || []).map(link=>eligibleChild(audit,link.href,'page',item.depth+1,fetched.finalUrl,link.text)).filter(Boolean);
    return { key:item.key,page:pageToRow(audit.id,page),issues:issues.map(issue=>issueToRow(audit.id,issue)),groups:scoreGroups(issues),checks:checks.completedChecks+2,unavailable:checks.unavailableChecks.length,children,
      measuredCategories: measuredAuditCategories(checks.completedCheckIds) };
  } catch (error) {
    if (item.kind === 'robots') return item.attempts < 2
      ? { key: item.key, retryAt: new Date(Date.now() + retryDelayMs(undefined, item.attempts)).toISOString() }
      : { key: item.key, children: [], robotsUnavailable: true, robotsEvidence: createRobotsFetchEvidence({ url: item.url, error: true }) };
    const failure = classifyAuditFailure(error,{ affectedUrl:item.url,attemptCount:item.attempts+1 });
    if (failure.retryable && item.attempts<2) return { key:item.key,retryAt:new Date(Date.now()+retryDelayMs(undefined,item.attempts)).toISOString() };
    if (item.kind === 'sitemap') return { key:item.key,children:[],discoveryErrors:['Sitemap unavailable'] };
    return failurePage(audit,item,failure);
  }
}

export async function runScalableSlice(workerId: string, onActivity?: (auditId: string | null) => Promise<void>): Promise<boolean> {
  if (isScalableWorkerStopRequested(workerId)) return false;
  const claimed = await claimScalableAudit(workerId);
  if (!claimed) return false;
  const { audit } = claimed;
  let run = claimed.run;
  const started = Date.now();
  const scheduler = new HostRequestScheduler(2,150);
  let processed = 0;
  let writeChain: Promise<unknown> = Promise.resolve();
  let leaseError: unknown;
  let sliceReleased = false;
  const commit = (payload: Record<string,unknown>) => {
    const task = writeChain.then(async () => {
      if (leaseError) throw leaseError;
      run = await scalableRpc<CrawlRun>('scalable_audit_commit',{p_audit:audit.id,p_worker:workerId,p_generation:run.generation,p_payload:{...payload,rss:process.memoryUsage().rss}});
    });
    writeChain = task.catch(error=>{leaseError=error;});
    return task;
  };
  let renewalPending = false;
  const leaseTimer = setInterval(()=>{
    if (renewalPending || leaseError) return;
    renewalPending = true;
    void commit({}).catch(()=>undefined).finally(()=>{ renewalPending = false; });
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
    const result = calculateTransparentAuditScore({issues:[],pages:[],aggregate:await readScoreAggregate(run),...scoreOptions(run)});
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
      await commit({seed:[frontierItem(new URL('/robots.txt',origin).href,'robots'), ...sitemapPaths.map(path=>frontierItem(new URL(path,origin).href,'sitemap'))],metadata:{initialized:true,scoringVersion:SCORING_VERSION,measuredCategories:[]}});
    }
    let pauseReason: string | undefined;
    crawl: while (!isScalableWorkerStopRequested(workerId) && processed<CRAWL_SLICE_PAGES && Date.now()-started<CRAWL_SLICE_MS && run.analysed<audit.pageLimit && run.active_ms+Date.now()-started<run.budget_ms) {
      if (leaseError) throw leaseError;
      const memoryLimit = Math.max(128,Number(process.env.AUDIT_WORKER_RSS_LIMIT_MB || 384))*1024*1024;
      if (process.memoryUsage().rss>memoryLimit) { pauseReason='Worker memory pressure; waiting to resume'; break; }
      const items = await readFrontier(audit.id,Math.min(run.analysed===0 ? 1 : 2,audit.pageLimit-run.analysed,CRAWL_SLICE_PAGES-processed));
      if (leaseError) throw leaseError;
      if (isScalableWorkerStopRequested(workerId)) break;
      if (!items.length) break;
      const results = await Promise.all(items.map(item=>analyseScalableItem(audit,run,item,scheduler)));
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
        const measured = storedMeasuredAuditCategories(run.metadata.measuredCategories);
        const newlyMeasured = storedMeasuredAuditCategories(result.measuredCategories).filter(category => !measured.includes(category));
        if (newlyMeasured.length) metadata.measuredCategories = [...measured, ...newlyMeasured];
        delete result.measuredCategories;
        await commit({items:[result],metadata,currentUrl:items.find(item=>item.key===result.key)?.url});
        processed++;
        await publishScore();
      }
    }
    await publishScore(true);
    const timedOut=run.active_ms+Date.now()-started>=run.budget_ms;
    const pending=await hasPendingFrontier(audit.id);
    if (run.analysed>=audit.pageLimit || timedOut || !pending) {
      const score=calculateTransparentAuditScore({issues:[],pages:[],aggregate:await readScoreAggregate(run),...scoreOptions(run),
        limitations:['Scores cover the automated checks actually run, not every possible SEO requirement.',
          'Response timing measures the HTML request, not Core Web Vitals or time to first byte.',
          'Internal-link observations do not verify every destination or measure external backlinks.'],
        unavailableChecks:{mobile:['Browser-rendered layout and Core Web Vitals were not collected.'],technical:run.unavailable_count ? [`${run.unavailable_count} check groups could not complete.`] : []}});
      const [pages,topIssues]=await Promise.all([auditRepository.getLatestPages(audit.id,25),auditRepository.getLatestIssues(audit.id,25)]);
      const reason=run.analysed>=audit.pageLimit ? 'page_limit_reached' : timedOut ? 'audit_deadline_reached' : run.discovered>=run.candidate_limit ? 'safety_limit_reached' : 'crawl_queue_exhausted';
      const report:ResourceAuditReport={scores:{...toReportScoreRecord(score),auditEngineVersion:AUDIT_ENGINE_VERSION,scoringVersion:scoreOptions(run).scoringVersion,checkRegistryVersion:CHECK_REGISTRY_VERSION,
        processingVersion:2,unavailableCount:run.unavailable_count,evidenceSample:true,checkCountUnit:'groups',coverage:{pagesDiscovered:run.discovered,pagesAttempted:run.attempted,pagesAnalysed:run.analysed,pagesFailed:run.failed,pagesBlocked:run.blocked,pageLimit:audit.pageLimit,coveragePercent:Math.round(100*run.analysed/audit.pageLimit),discoveredCoveragePercent:run.discovered ? Math.round(100*run.analysed/run.discovered) : null,quotaReached:run.analysed>=audit.pageLimit,stopReason:reason}},
        summary:`Analysed ${run.analysed} of up to ${audit.pageLimit} pages. ${run.failed} failed and ${run.blocked} were blocked. Full evidence is available in the paginated report and exports.`,
        // Finalization fills the bounded recommendations from all retained findings in the same transaction.
        presentationSummary:readAuditPresentationSummary(run.presentation_summary),
        pages,topIssues,exports:{json:`/api/tools/audit/export/${audit.id}/json`,issuesCsv:`/api/tools/audit/export/${audit.id}/issues.csv`,pagesCsv:`/api/tools/audit/export/${audit.id}/pages.csv`},generatedAt:new Date().toISOString()};
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

let lastRegistration = 0;
export async function maintainScalableWorker(workerId: string) {
  if (Date.now()-lastRegistration<30_000) return;
  await registerScalableWorker(workerId);
  lastRegistration=Date.now();
}
