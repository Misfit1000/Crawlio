import { auditStore } from './audit-store';
import { eventEmitter } from './event-emitter';
import { crawlDomain } from '../seo/crawler';
import { runAllChecks } from '../seo/checks/runner';
import { AuditIssue } from './types';
import { safePublicFetch } from '../security/safe-public-fetch';

export async function runAuditJob(jobId: string, maxPages = 10) {
  const job = auditStore.getJob(jobId);
  if (!job) return;

  try {
    auditStore.updateJob(jobId, { status: 'crawling' });
    
    eventEmitter.emitAuditEvent(jobId, { type: 'audit_started', message: 'Audit queued' });
    eventEmitter.emitStepStarted(jobId, 'Validating URL', 'Validating URL');
    eventEmitter.emitAuditEvent(jobId, { type: 'audit_started', message: 'Audit started', progress: 0 });
    
    // Simulate validation
    eventEmitter.emitAuditEvent(jobId, { progress: 2, message: 'URL normalized' });
    eventEmitter.emitStepCompleted(jobId, 'Validating URL', 'URL validated');

    eventEmitter.emitStepStarted(jobId, 'Crawling', 'Fetching homepage');
    eventEmitter.emitAuditEvent(jobId, { progress: 5, message: 'Homepage fetched' });
    eventEmitter.emitAuditEvent(jobId, { progress: 8, message: 'Checking HTTPS' });
    eventEmitter.emitAuditEvent(jobId, { progress: 10, message: 'Checking redirects' });

    // 1. Crawl (crawler.ts emits pages and robots/sitemap logic)
    const crawlResults = await crawlDomain(job.url, { maxPages, auditId: jobId });
    
    auditStore.updateJob(jobId, { status: 'analyzing', pagesCrawled: crawlResults.length });
    eventEmitter.emitStepCompleted(jobId, 'Crawling', 'Crawl complete');
    
    // 2. Analyze each page
    let allIssues: AuditIssue[] = [];
    let indexable = 0;
    let nonIndexable = 0;
    let critical = 0;
    let high = 0;
    let medium = 0;
    let low = 0;
    let passed = 0;
    
    eventEmitter.emitStepStarted(jobId, 'Analyzing', 'Analyzing ' + crawlResults.length + ' pages');
    eventEmitter.emitAuditEvent(jobId, { progress: 55 });

    const analyzedPages = crawlResults.map((page, idx) => {
      const flatPageData = { ...page, ...page.data };
      eventEmitter.emitCheckStarted(jobId, 'Page Analysis', flatPageData.url);
      
      const pageIssues = runAllChecks(flatPageData, jobId);
      
      const isIndexable = flatPageData.status === 200 && !flatPageData.metaRobots?.includes('noindex');
      if (isIndexable) indexable++;
      else nonIndexable++;
      
      pageIssues.forEach(issue => {
        if (issue.severity === 'critical') critical++;
        else if (issue.severity === 'high') high++;
        else if (issue.severity === 'medium') medium++;
        else if (issue.severity === 'low') low++;
        else if (issue.severity === 'info') passed++;
      });
      
      allIssues.push(...pageIssues);
      
      eventEmitter.emitAuditEvent(jobId, { progress: 55 + Math.floor((idx / (crawlResults.length || 1)) * 35) });
      eventEmitter.emitCheckCompleted(jobId, 'Page Analysis', flatPageData.url);
      return {
        url: flatPageData.url,
        title: flatPageData.title || '',
        status: flatPageData.status,
        wordCount: flatPageData.wordCount || 0,
        isIndexable,
        issues: pageIssues
      };
    });
    
    eventEmitter.emitStepCompleted(jobId, 'Analyzing', 'Page analysis complete');

    // Add domain-level checks (robots.txt and sitemap)
    eventEmitter.emitStepStarted(jobId, 'Domain Checks', 'Checking robots.txt and sitemap');
    try {
      const parsedUrl = new URL(job.url);
      const robotsUrl = `${parsedUrl.protocol}//${parsedUrl.host}/robots.txt`;
      const sitemapUrl = `${parsedUrl.protocol}//${parsedUrl.host}/sitemap.xml`;
      
      eventEmitter.emitCheckStarted(jobId, 'Robots.txt check', robotsUrl);
      try {
        const robRes = await safePublicFetch(robotsUrl, { method: 'HEAD', timeoutMs: 5_000, maxBytes: 1, allowedContentTypes: [] });
        if (robRes.status < 200 || robRes.status >= 300) {
           const iss = { id: 'missing-robots', category: 'crawlability', severity: 'high' as const, title: 'Missing robots.txt', description: 'Could not find a valid robots.txt file.', affectedUrl: robotsUrl };
           allIssues.push(iss);
           eventEmitter.emitIssueFound(jobId, iss);
           high++;
        }
      } catch(e) {
         const iss = { id: 'missing-robots', category: 'crawlability', severity: 'high' as const, title: 'Missing robots.txt', description: 'Could not find a valid robots.txt file.', affectedUrl: robotsUrl };
         allIssues.push(iss);
         eventEmitter.emitIssueFound(jobId, iss);
         high++;
      }
      eventEmitter.emitCheckCompleted(jobId, 'Robots.txt check', robotsUrl);
      
      eventEmitter.emitCheckStarted(jobId, 'Sitemap check', sitemapUrl);
      try {
        const smRes = await safePublicFetch(sitemapUrl, { method: 'HEAD', timeoutMs: 5_000, maxBytes: 1, allowedContentTypes: [] });
        if (smRes.status < 200 || smRes.status >= 300) {
           const iss = { id: 'missing-sitemap', category: 'crawlability', severity: 'medium' as const, title: 'Missing sitemap.xml', description: 'Could not find a valid sitemap.xml file at the root.', affectedUrl: sitemapUrl };
           allIssues.push(iss);
           eventEmitter.emitIssueFound(jobId, iss);
           medium++;
        }
      } catch(e) {
         const iss = { id: 'missing-sitemap', category: 'crawlability', severity: 'medium' as const, title: 'Missing sitemap.xml', description: 'Could not find a valid sitemap.xml file at the root.', affectedUrl: sitemapUrl };
         allIssues.push(iss);
         eventEmitter.emitIssueFound(jobId, iss);
         medium++;
      }
      eventEmitter.emitCheckCompleted(jobId, 'Sitemap check', sitemapUrl);
    } catch(e) {}
    eventEmitter.emitStepCompleted(jobId, 'Domain Checks', 'Domain checks complete');
    
    // 3. Scoring
    eventEmitter.emitStepStarted(jobId, 'Scoring', 'Calculating scores');
    eventEmitter.emitAuditEvent(jobId, { progress: 90 });
    
    const totalIssues = critical * 10 + high * 5 + medium * 2 + low;
    const baseScore = 100 - (totalIssues / (analyzedPages.length || 1));
    const overallScore = Math.max(0, Math.min(100, Math.round(baseScore)));
    
    eventEmitter.emitScoreUpdated(jobId, { score: overallScore });
    eventEmitter.emitStepCompleted(jobId, 'Scoring', 'Score calculated');

    eventEmitter.emitStepStarted(jobId, 'Report Building', 'Building final report');
    eventEmitter.emitAuditEvent(jobId, { progress: 95 });

    auditStore.updateJob(jobId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      overallScore,
      pagesIndexable: indexable,
      pagesNonIndexable: nonIndexable,
      criticalIssues: critical,
      highIssues: high,
      mediumIssues: medium,
      lowIssues: low,
      passedChecks: passed,
      allIssues,
      crawledPages: analyzedPages
    });

    eventEmitter.emitStepCompleted(jobId, 'Report Building', 'Report built successfully');
    eventEmitter.emitAuditCompleted(jobId);
    
  } catch (error: any) {
    console.error('Audit Job failed', error);
    eventEmitter.emitAuditFailed(jobId, error.message || 'Unknown error occurred');
    auditStore.updateJob(jobId, { 
       status: 'failed', 
       error: error.message || 'Unknown error occurred',
      completedAt: new Date().toISOString()
    });
  }
}
