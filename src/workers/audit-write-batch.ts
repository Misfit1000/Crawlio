import { createHash } from 'node:crypto';
import type {
  ResourceAuditDocument,
  ResourceAuditEvent,
  ResourceAuditIssue,
  ResourceAuditPage,
} from '../lib/audit/resource-types';
import { auditRepository } from '../lib/supabase/audit-repository';

type AuditIssueInput = Omit<ResourceAuditIssue, 'id' | 'detectedAt'> & {
  id?: string;
  detectedAt?: string;
};
type AuditPageInput = Omit<ResourceAuditPage, 'id'>;
type AuditEventInput = Omit<Partial<ResourceAuditEvent>, 'id'>;

export interface AuditWriteSink {
  updateAudit(id: string, patch: Partial<ResourceAuditDocument>): Promise<unknown>;
  appendPages(id: string, pages: Array<AuditPageInput & { id?: string }>): Promise<ResourceAuditPage[]>;
  appendIssues(id: string, issues: AuditIssueInput[]): Promise<ResourceAuditIssue[]>;
  appendEvents(id: string, events: AuditEventInput[]): Promise<ResourceAuditEvent[]>;
}

export interface AuditWriteBatchOptions {
  workerId?: string;
  pageBatchSize?: number;
  issueBatchSize?: number;
  eventBatchSize?: number;
  progressThrottleMs?: number;
  writeTimeoutMs?: number;
  now?: () => number;
}

export interface AuditWriteMetrics {
  flushes: number;
  writeOperations: number;
  dbWriteMs: number;
  pagesWritten: number;
  issuesWritten: number;
  eventsWritten: number;
  progressWrites: number;
  analysisMs: number;
}

function createDefaultSink(workerId?: string): AuditWriteSink {
  return {
    updateAudit: (id, patch) => workerId
      ? auditRepository.updateAuditForWorker(id, workerId, patch)
      : auditRepository.updateAudit(id, patch),
    appendPages: (id, pages) => auditRepository.appendPages(id, pages),
    appendIssues: (id, issues) => auditRepository.appendIssues(id, issues),
    appendEvents: (id, events) => auditRepository.appendEvents(id, events),
  };
}

function pageId(auditId: string, url: string) {
  return createHash('sha256').update(`${auditId}:${url}`).digest('hex').slice(0, 40);
}

export class AuditWriteBatch {
  private readonly pageBatchSize: number;
  private readonly issueBatchSize: number;
  private readonly eventBatchSize: number;
  private readonly progressThrottleMs: number;
  private readonly now: () => number;
  private readonly writeTimeoutMs: number;
  private readonly metrics: AuditWriteMetrics = {
    flushes: 0,
    writeOperations: 0,
    dbWriteMs: 0,
    pagesWritten: 0,
    issuesWritten: 0,
    eventsWritten: 0,
    progressWrites: 0,
    analysisMs: 0,
  };
  private pages: Array<AuditPageInput & { id?: string }> = [];
  private issues: AuditIssueInput[] = [];
  private events: AuditEventInput[] = [];
  private progress: Partial<ResourceAuditDocument> | null = null;
  private lastProgressWriteAt = 0;
  private highestProgress = 0;
  private flushChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly auditId: string,
    sink: AuditWriteSink | undefined = undefined,
    options: AuditWriteBatchOptions = {},
  ) {
    this.sink = sink ?? createDefaultSink(options.workerId);
    this.pageBatchSize = Math.max(1, options.pageBatchSize ?? 5);
    this.issueBatchSize = Math.max(1, options.issueBatchSize ?? 40);
    this.eventBatchSize = Math.max(1, options.eventBatchSize ?? 20);
    this.progressThrottleMs = Math.max(0, options.progressThrottleMs ?? 1_200);
    this.writeTimeoutMs = Math.max(1_000, options.writeTimeoutMs ?? 15_000);
    this.now = options.now ?? Date.now;
  }

  private readonly sink: AuditWriteSink;

  async addPage(page: AuditPageInput) {
    const fullPage: ResourceAuditPage = { id: pageId(this.auditId, page.url), ...page };
    this.pages.push(fullPage);
    if (this.pages.length >= this.pageBatchSize) await this.flush(false);
    return fullPage;
  }

  async addIssue(issue: AuditIssueInput) {
    this.issues.push(issue);
    if (this.issues.length >= this.issueBatchSize) await this.flush(false);
  }

  async addEvent(event: AuditEventInput) {
    this.events.push(event);
    if (this.events.length >= this.eventBatchSize) await this.flush(false);
  }

  async writeProgress(
    patch: Partial<ResourceAuditDocument>,
    event?: AuditEventInput,
    options: { force?: boolean } = {},
  ) {
    if (typeof patch.progress === 'number') {
      this.highestProgress = Math.max(this.highestProgress, Math.min(100, Math.max(0, patch.progress)));
      patch = { ...patch, progress: this.highestProgress };
    }
    this.progress = { ...(this.progress ?? {}), ...patch };
    if (event) {
      this.events.push({
        ...event,
        phase: event.phase ?? patch.currentPhase,
        currentUrl: event.currentUrl ?? patch.currentUrl,
        checkTitle: event.checkTitle ?? patch.currentCheck ?? undefined,
        progress: event.progress ?? patch.progress,
      });
    }
    const terminal = patch.status === 'completed' || patch.status === 'completed_with_warnings' || patch.status === 'failed' || patch.status === 'cancelled' || patch.status === 'abandoned';
    const throttleElapsed = this.now() - this.lastProgressWriteAt >= this.progressThrottleMs;
    if (options.force || terminal || throttleElapsed || this.events.length >= this.eventBatchSize) {
      await this.flush(options.force || terminal || throttleElapsed);
    }
  }

  recordAnalysisDuration(durationMs: number) {
    this.metrics.analysisMs += Math.max(0, durationMs);
  }

  getMetrics(): AuditWriteMetrics {
    return { ...this.metrics };
  }

  async flush(includeProgress = true) {
    const flushTask = this.flushChain.then(() => this.flushPending(includeProgress));
    this.flushChain = flushTask.catch(() => undefined);
    return flushTask;
  }

  private async measureWrite<T>(operation: () => Promise<T>) {
    const startedAt = this.now();
    this.metrics.writeOperations += 1;
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          operation(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error(`Database write exceeded ${this.writeTimeoutMs}ms.`)), this.writeTimeoutMs);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    } finally {
      this.metrics.dbWriteMs += Math.max(0, this.now() - startedAt);
    }
  }

  private async flushPending(includeProgress: boolean) {
    const pages = this.pages.splice(0);
    const issues = this.issues.splice(0);
    const events = this.events.splice(0);
    const progress = includeProgress ? this.progress : null;
    if (includeProgress) this.progress = null;
    if (!pages.length && !issues.length && !events.length && !progress) return;

    this.metrics.flushes += 1;
    if (pages.length) {
      const stored = await this.measureWrite(() => this.sink.appendPages(this.auditId, pages));
      this.metrics.pagesWritten += stored.length;
    }
    if (issues.length) {
      const stored = await this.measureWrite(() => this.sink.appendIssues(this.auditId, issues));
      this.metrics.issuesWritten += stored.length;
      if (stored.length) {
        events.push({
          type: 'issue_found',
          message: `${stored.length} issue${stored.length === 1 ? '' : 's'} found in this analysis batch`,
          severity: stored.some((issue) => issue.severity === 'critical') ? 'critical'
            : stored.some((issue) => issue.severity === 'high') ? 'high'
              : stored.some((issue) => issue.severity === 'medium') ? 'medium'
                : stored.some((issue) => issue.severity === 'low') ? 'low' : 'info',
          data: { count: stored.length },
        });
      }
    }
    if (events.length) {
      const stored = await this.measureWrite(() => this.sink.appendEvents(this.auditId, events));
      this.metrics.eventsWritten += stored.length;
    }
    if (progress) {
      await this.measureWrite(() => this.sink.updateAudit(this.auditId, progress));
      this.metrics.progressWrites += 1;
      this.lastProgressWriteAt = this.now();
    }
  }
}
