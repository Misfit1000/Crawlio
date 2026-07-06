import { FullAuditResult } from './types';

// In-memory store for audit jobs (suitable for single-instance or temporary dev)
const jobs = new Map<string, FullAuditResult>();

export const auditStore = {
  getJob(id: string): FullAuditResult | undefined {
    return jobs.get(id);
  },
  
  createJob(targetUrl: string): string {
    const id = Math.random().toString(36).substring(2, 15);
    const newJob: FullAuditResult = {
      jobId: id,
      targetUrl,
      status: 'pending',
      startedAt: new Date().toISOString(),
      overallScore: 0,
      categoryScores: {
        'technical': 0,
        'on-page': 0,
        'crawlability': 0,
        'indexability': 0,
        'content': 0,
        'performance': 0,
        'security': 0,
        'links': 0
      },
      pagesCrawled: 0,
      pagesIndexable: 0,
      pagesNonIndexable: 0,
      criticalIssues: 0,
      highIssues: 0,
      mediumIssues: 0,
      lowIssues: 0,
      passedChecks: 0,
      allIssues: [],
      crawledPages: []
    };
    jobs.set(id, newJob);
    return id;
  },

  updateJob(id: string, updates: Partial<FullAuditResult>) {
    const job = jobs.get(id);
    if (job) {
      jobs.set(id, { ...job, ...updates });
    }
  },
  
  getAllJobs(): FullAuditResult[] {
    return Array.from(jobs.values()).sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }
};
