import { AuditLiveEvent } from './events';
import { FullAuditResult } from './types';

export interface AuditJob {
  id: string;
  url: string;
  type: 'seo' | 'security' | 'combined' | 'competitor-gap' | 'website-analyzer';
  status: 'queued' | 'running' | 'crawling' | 'analyzing' | 'completed' | 'failed' | 'pending';
  progress: number;
  currentStep: string;
  pagesDiscovered: number;
  pagesCrawled: number;
  checksTotal: number;
  checksCompleted: number;
  issuesFound: number;
  startedAt: string;
  completedAt?: string;
  result?: any;
  fullAudit?: any;
  audit?: any;
  gaps?: any;
  crawledCounts?: any;
  data?: any;
  error?: string;
  jobId?: string; // legacy support
}

const jobs = new Map<string, AuditJob | FullAuditResult>();
const eventsStore = new Map<string, AuditLiveEvent[]>();
const subscriptions = new Map<string, Set<(event: AuditLiveEvent) => void>>();

export const auditStore = {
  createAudit(input: { url: string; type: 'seo' | 'security' | 'combined' | 'competitor-gap' | 'website-analyzer' }): string {
    const id = Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    const newJob: AuditJob = {
      id,
      jobId: id,
      url: input.url,
      type: input.type,
      status: 'queued',
      progress: 0,
      currentStep: 'Initializing',
      pagesDiscovered: 0,
      pagesCrawled: 0,
      checksTotal: 0,
      checksCompleted: 0,
      issuesFound: 0,
      startedAt: new Date().toISOString()
    };
    jobs.set(id, newJob);
    eventsStore.set(id, []);
    subscriptions.set(id, new Set());
    
    this.appendAuditEvent(id, {
      type: 'audit_queued',
      message: 'Audit added to queue',
      progress: 0
    });
    
    return id;
  },
  
  createJob(targetUrl: string): string {
    return this.createAudit({ url: targetUrl, type: 'seo' });
  },
  
  getAudit(id: string): any {
    return jobs.get(id);
  },

  getJob(id: string): any {
    return jobs.get(id);
  },
  
  updateAudit(id: string, patch: Partial<AuditJob & FullAuditResult>) {
    const job = jobs.get(id) as any;
    if (job) {
      jobs.set(id, { ...job, ...patch });
    }
  },

  updateJob(id: string, patch: Partial<AuditJob & FullAuditResult>) {
    this.updateAudit(id, patch);
  },
  
  appendAuditEvent(id: string, eventData: Partial<AuditLiveEvent>) {
    const job = jobs.get(id) as AuditJob;
    if (!job) return;
    
    const event: AuditLiveEvent = {
      id: Math.random().toString(36).substring(2, 15),
      auditId: id,
      type: eventData.type || 'audit_warning',
      timestamp: new Date().toISOString(),
      message: eventData.message || '',
      progress: eventData.progress ?? (job.progress || 0),
      step: eventData.step || job.currentStep,
      pagesDiscovered: eventData.pagesDiscovered ?? job.pagesDiscovered,
      pagesCrawled: eventData.pagesCrawled ?? job.pagesCrawled,
      checksTotal: eventData.checksTotal ?? job.checksTotal,
      checksCompleted: eventData.checksCompleted ?? (eventData.type === 'check_completed' ? (job.checksCompleted || 0) + 1 : job.checksCompleted),
      issuesFound: eventData.issuesFound ?? (eventData.type === 'issue_found' ? (job.issuesFound || 0) + 1 : job.issuesFound),
      ...eventData
    };
    
    // Update job state based on event
    this.updateAudit(id, { 
      progress: event.progress,
      currentStep: event.step,
      pagesDiscovered: event.pagesDiscovered,
      pagesCrawled: event.pagesCrawled,
      checksTotal: event.checksTotal,
      checksCompleted: event.checksCompleted,
      issuesFound: event.issuesFound,
      ...(event.type === 'audit_started' ? { status: 'running' } : {}),
      ...(event.type === 'audit_completed' ? { status: 'completed' } : {}),
      ...(event.type === 'audit_failed' ? { status: 'failed', error: event.message } : {}),
    });
    
    const events = eventsStore.get(id) || [];
    events.push(event);
    
    // Keep last 500 events
    if (events.length > 500) {
      events.shift();
    }
    
    // Notify subscribers
    const subs = subscriptions.get(id);
    if (subs) {
      subs.forEach(cb => {
        try {
          cb(event);
        } catch (err) {}
      });
    }
  },
  
  getAuditEvents(id: string): AuditLiveEvent[] {
    return eventsStore.get(id) || [];
  },
  
  subscribeToAudit(id: string, callback: (event: AuditLiveEvent) => void) {
    let subs = subscriptions.get(id);
    if (!subs) {
      subs = new Set();
      subscriptions.set(id, subs);
    }
    subs.add(callback);
  },
  
  unsubscribeFromAudit(id: string, callback: (event: AuditLiveEvent) => void) {
    const subs = subscriptions.get(id);
    if (subs) {
      subs.delete(callback);
    }
  },

  getAllJobs(): any[] {
    return Array.from(jobs.values()).sort((a: any, b: any) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }
};
