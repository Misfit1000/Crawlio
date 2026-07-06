import { auditStore } from './audit-store';
import { crawlDomain } from '../seo/crawler';
import { runAllChecks } from '../seo/checks/runner';
import { AuditIssue } from './types';

export async function runAuditJob(jobId: string, maxPages = 10) {
  const job = auditStore.getJob(jobId);
  if (!job) return;

  try {
    auditStore.updateJob(jobId, { status: 'crawling' });
    
    // 1. Crawl
    const crawlResults = await crawlDomain(job.targetUrl, maxPages);
    
    auditStore.updateJob(jobId, { status: 'analyzing', pagesCrawled: crawlResults.length });
    
    // 2. Analyze each page
    let allIssues: AuditIssue[] = [];
    let indexable = 0;
    let nonIndexable = 0;
    let critical = 0;
    let high = 0;
    let medium = 0;
    let low = 0;
    let passed = 0;
    
    const analyzedPages = crawlResults.map(page => {
      // Flatten for the checks
      const flatPageData = {
        ...page,
        ...page.data,
      };
      
      const pageIssues = runAllChecks(flatPageData);
      
      const isIndexable = flatPageData.status === 200 && !flatPageData.metaRobots?.includes('noindex');
      if (isIndexable) indexable++;
      else nonIndexable++;
      
      pageIssues.forEach(issue => {
        if (issue.severity === 'critical') critical++;
        else if (issue.severity === 'high') high++;
        else if (issue.severity === 'medium') medium++;
        else if (issue.severity === 'low') low++;
        else if (issue.severity === 'info') passed++; // Treat info as passed/ok for now
      });
      
      allIssues.push(...pageIssues);
      
      return {
        url: flatPageData.url,
        title: flatPageData.title || '',
        status: flatPageData.status,
        wordCount: flatPageData.wordCount || 0,
        isIndexable,
        issues: pageIssues
      };
    });
    
    // 3. Scoring
    const totalIssues = critical * 10 + high * 5 + medium * 2 + low;
    const baseScore = 100 - (totalIssues / (analyzedPages.length || 1));
    const overallScore = Math.max(0, Math.min(100, Math.round(baseScore)));
    
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
      passedChecks: passed, // Mock passed count based on missing criticals
      allIssues,
      crawledPages: analyzedPages
    });
    
  } catch (error: any) {
    console.error('Audit Job failed', error);
    auditStore.updateJob(jobId, { 
      status: 'failed', 
      error: error.message || 'Unknown error occurred',
      completedAt: new Date().toISOString()
    });
  }
}
