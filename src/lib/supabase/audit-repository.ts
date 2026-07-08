import { createHash, randomUUID } from 'node:crypto';
import {
  AUDIT_LIMITS,
  type AuditMode,
  type ResourceAuditDocument,
  type ResourceAuditEvent,
  type ResourceAuditIssue,
  type ResourceAuditLiveData,
  type ResourceAuditPage,
  type ResourceAuditReport,
  getAuditModeConfig,
} from '../audit/resource-types';
import { getSupabaseAdminClient } from './server';

type DbRow = Record<string, any>;

function nowIso() {
  return new Date().toISOString();
}

function expiresAtIso() {
  const date = new Date();
  date.setDate(date.getDate() + AUDIT_LIMITS.defaultExpiresInDays);
  return date.toISOString();
}

function pageIdForAuditUrl(auditId: string, url: string) {
  return createHash('sha256').update(`${auditId}:${url}`).digest('hex').slice(0, 40);
}

function assertNoError(error: { message?: string } | null | undefined, action: string) {
  if (error) {
    throw new Error(`${action}: ${error.message || 'Unknown Supabase error'}`);
  }
}

function toAuditDocument(row: DbRow | null | undefined): ResourceAuditDocument | null {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id ?? null,
    projectId: row.project_id ?? null,
    submittedInput: row.submitted_input,
    normalizedUrl: row.normalized_url,
    finalUrl: row.final_url ?? null,
    hostname: row.hostname,
    mode: row.mode,
    status: row.status,
    progress: row.progress ?? 0,
    currentPhase: row.current_phase ?? 'Queued',
    currentUrl: row.current_url ?? null,
    currentCheck: row.current_check ?? null,
    pageLimit: row.page_limit ?? 0,
    pagesDiscovered: row.pages_discovered ?? 0,
    pagesCrawled: row.pages_crawled ?? 0,
    checksTotal: row.checks_total ?? 0,
    checksCompleted: row.checks_completed ?? 0,
    issuesFound: row.issues_found ?? 0,
    criticalCount: row.critical_count ?? 0,
    highCount: row.high_count ?? 0,
    mediumCount: row.medium_count ?? 0,
    lowCount: row.low_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? null,
    expiresAt: row.expires_at,
    cancelledAt: row.cancelled_at ?? null,
    error: row.error ?? null,
    lockedBy: row.locked_by ?? null,
    lockedAt: row.locked_at ?? null,
    leaseExpiresAt: row.lease_expires_at ?? null,
    usedHttpFallback: row.used_http_fallback ?? undefined,
  };
}

function auditToRow(audit: ResourceAuditDocument) {
  return {
    id: audit.id,
    user_id: audit.userId,
    project_id: audit.projectId,
    submitted_input: audit.submittedInput,
    normalized_url: audit.normalizedUrl,
    final_url: audit.finalUrl,
    hostname: audit.hostname,
    mode: audit.mode,
    status: audit.status,
    progress: audit.progress,
    current_phase: audit.currentPhase,
    current_url: audit.currentUrl,
    current_check: audit.currentCheck,
    page_limit: audit.pageLimit,
    pages_discovered: audit.pagesDiscovered,
    pages_crawled: audit.pagesCrawled,
    checks_total: audit.checksTotal,
    checks_completed: audit.checksCompleted,
    issues_found: audit.issuesFound,
    critical_count: audit.criticalCount,
    high_count: audit.highCount,
    medium_count: audit.mediumCount,
    low_count: audit.lowCount,
    created_at: audit.createdAt,
    updated_at: audit.updatedAt,
    completed_at: audit.completedAt,
    expires_at: audit.expiresAt,
    cancelled_at: audit.cancelledAt,
    error: audit.error,
    locked_by: audit.lockedBy,
    locked_at: audit.lockedAt,
    lease_expires_at: audit.leaseExpiresAt,
    used_http_fallback: audit.usedHttpFallback ?? false,
  };
}

function auditPatchToRow(patch: Partial<ResourceAuditDocument>) {
  const row: DbRow = { updated_at: nowIso() };
  if ('userId' in patch) row.user_id = patch.userId;
  if ('projectId' in patch) row.project_id = patch.projectId;
  if ('submittedInput' in patch) row.submitted_input = patch.submittedInput;
  if ('normalizedUrl' in patch) row.normalized_url = patch.normalizedUrl;
  if ('finalUrl' in patch) row.final_url = patch.finalUrl;
  if ('hostname' in patch) row.hostname = patch.hostname;
  if ('mode' in patch) row.mode = patch.mode;
  if ('status' in patch) row.status = patch.status;
  if ('progress' in patch) row.progress = patch.progress;
  if ('currentPhase' in patch) row.current_phase = patch.currentPhase;
  if ('currentUrl' in patch) row.current_url = patch.currentUrl;
  if ('currentCheck' in patch) row.current_check = patch.currentCheck;
  if ('pageLimit' in patch) row.page_limit = patch.pageLimit;
  if ('pagesDiscovered' in patch) row.pages_discovered = patch.pagesDiscovered;
  if ('pagesCrawled' in patch) row.pages_crawled = patch.pagesCrawled;
  if ('checksTotal' in patch) row.checks_total = patch.checksTotal;
  if ('checksCompleted' in patch) row.checks_completed = patch.checksCompleted;
  if ('issuesFound' in patch) row.issues_found = patch.issuesFound;
  if ('criticalCount' in patch) row.critical_count = patch.criticalCount;
  if ('highCount' in patch) row.high_count = patch.highCount;
  if ('mediumCount' in patch) row.medium_count = patch.mediumCount;
  if ('lowCount' in patch) row.low_count = patch.lowCount;
  if ('completedAt' in patch) row.completed_at = patch.completedAt;
  if ('expiresAt' in patch) row.expires_at = patch.expiresAt;
  if ('cancelledAt' in patch) row.cancelled_at = patch.cancelledAt;
  if ('error' in patch) row.error = patch.error;
  if ('lockedBy' in patch) row.locked_by = patch.lockedBy;
  if ('lockedAt' in patch) row.locked_at = patch.lockedAt;
  if ('leaseExpiresAt' in patch) row.lease_expires_at = patch.leaseExpiresAt;
  if ('usedHttpFallback' in patch) row.used_http_fallback = patch.usedHttpFallback;
  return row;
}

function toAuditEvent(row: DbRow): ResourceAuditEvent {
  return {
    id: row.id,
    type: row.type,
    timestamp: row.created_at,
    message: row.message ?? '',
    phase: row.phase ?? undefined,
    currentUrl: row.current_url ?? undefined,
    affectedUrl: row.affected_url ?? undefined,
    category: row.category ?? undefined,
    checkId: row.check_id ?? undefined,
    checkTitle: row.check_title ?? undefined,
    severity: row.severity ?? undefined,
    progress: row.progress ?? undefined,
    data: row.data ?? undefined,
  };
}

function eventToRow(auditId: string, event: ResourceAuditEvent) {
  return {
    id: event.id,
    audit_id: auditId,
    type: event.type,
    created_at: event.timestamp,
    message: event.message,
    phase: event.phase,
    current_url: event.currentUrl,
    affected_url: event.affectedUrl,
    category: event.category,
    check_id: event.checkId,
    check_title: event.checkTitle,
    severity: event.severity,
    progress: event.progress,
    data: event.data ?? null,
  };
}

function toAuditPage(row: DbRow): ResourceAuditPage {
  return {
    id: row.id,
    url: row.url,
    statusCode: row.status_code ?? 0,
    responseTimeMs: row.response_time_ms ?? 0,
    pageSizeBytes: row.page_size_bytes ?? 0,
    title: row.title ?? '',
    metaDescription: row.meta_description ?? '',
    h1: row.h1 ?? '',
    wordCount: row.word_count ?? 0,
    crawlDepth: row.crawl_depth ?? 0,
    issueCount: row.issue_count ?? 0,
    crawledAt: row.crawled_at,
  };
}

function pageToRow(auditId: string, page: ResourceAuditPage) {
  return {
    id: page.id,
    audit_id: auditId,
    url: page.url,
    status_code: page.statusCode,
    response_time_ms: page.responseTimeMs,
    page_size_bytes: page.pageSizeBytes,
    title: page.title,
    meta_description: page.metaDescription,
    h1: page.h1,
    word_count: page.wordCount,
    crawl_depth: page.crawlDepth,
    issue_count: page.issueCount,
    crawled_at: page.crawledAt,
  };
}

function toAuditIssue(row: DbRow): ResourceAuditIssue {
  return {
    id: row.id,
    severity: row.severity,
    category: row.category,
    title: row.title,
    description: row.description,
    affectedUrl: row.affected_url,
    evidence: row.evidence ?? '',
    recommendation: row.recommendation ?? '',
    detectedAt: row.detected_at,
  };
}

function issueToRow(auditId: string, issue: ResourceAuditIssue) {
  return {
    id: issue.id,
    audit_id: auditId,
    severity: issue.severity,
    category: issue.category,
    title: issue.title,
    description: issue.description,
    affected_url: issue.affectedUrl,
    evidence: issue.evidence,
    recommendation: issue.recommendation,
    detected_at: issue.detectedAt,
  };
}

function toAuditReport(row: DbRow | null | undefined): ResourceAuditReport | null {
  if (!row) return null;
  return {
    scores: row.scores ?? {},
    summary: typeof row.summary === 'string' ? row.summary : row.summary?.text ?? '',
    topIssues: (row.top_issues ?? []) as ResourceAuditIssue[],
    pages: (row.pages ?? []) as ResourceAuditPage[],
    exports: row.exports ?? { json: '', issuesCsv: '', pagesCsv: '' },
    generatedAt: row.generated_at,
  };
}

function reportToRow(auditId: string, report: ResourceAuditReport) {
  return {
    audit_id: auditId,
    scores: report.scores,
    summary: { text: report.summary },
    top_issues: report.topIssues,
    pages: report.pages,
    exports: report.exports,
    generated_at: report.generatedAt,
  };
}

const memory = {
  audits: new Map<string, ResourceAuditDocument>(),
  events: new Map<string, ResourceAuditEvent[]>(),
  pages: new Map<string, ResourceAuditPage[]>(),
  issues: new Map<string, ResourceAuditIssue[]>(),
  reports: new Map<string, ResourceAuditReport>(),
};

export const auditRepository = {
  isSupabaseEnabled() {
    return Boolean(getSupabaseAdminClient());
  },

  async createAuditJob(input: {
    submittedInput: string;
    normalizedUrl: string;
    hostname: string;
    mode?: AuditMode;
    userId?: string | null;
    projectId?: string | null;
  }): Promise<ResourceAuditDocument> {
    const id = randomUUID();
    const config = getAuditModeConfig(input.mode);
    const timestamp = nowIso();
    const audit: ResourceAuditDocument = {
      id,
      userId: input.userId ?? null,
      projectId: input.projectId ?? null,
      submittedInput: input.submittedInput,
      normalizedUrl: input.normalizedUrl,
      finalUrl: null,
      hostname: input.hostname,
      mode: config.mode,
      status: 'queued',
      progress: 0,
      currentPhase: 'Queued',
      currentUrl: null,
      currentCheck: null,
      pageLimit: config.pageLimit,
      pagesDiscovered: 0,
      pagesCrawled: 0,
      checksTotal: 0,
      checksCompleted: 0,
      issuesFound: 0,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
      expiresAt: expiresAtIso(),
      cancelledAt: null,
      error: null,
      lockedBy: null,
      lockedAt: null,
      leaseExpiresAt: null,
    };

    const client = getSupabaseAdminClient();
    if (client) {
      const { error } = await client.from('audits').insert(auditToRow(audit));
      assertNoError(error, 'Create audit job');
    } else {
      memory.audits.set(id, audit);
      memory.events.set(id, []);
      memory.pages.set(id, []);
      memory.issues.set(id, []);
    }

    await this.appendAuditEvent(id, {
      type: 'audit_queued',
      message: `Audit queued for ${input.hostname}`,
      phase: 'Queued',
      progress: 0,
    });

    return audit;
  },

  async getAuditJob(id: string): Promise<ResourceAuditDocument | null> {
    const client = getSupabaseAdminClient();
    if (client) {
      const { data, error } = await client.from('audits').select('*').eq('id', id).maybeSingle();
      assertNoError(error, 'Get audit job');
      return toAuditDocument(data);
    }
    return memory.audits.get(id) ?? null;
  },

  async getAudit(id: string) {
    return this.getAuditJob(id);
  },

  async updateAuditJob(id: string, patch: Partial<ResourceAuditDocument>) {
    const update = { ...patch, updatedAt: nowIso() };
    const client = getSupabaseAdminClient();
    if (client) {
      const { error } = await client.from('audits').update(auditPatchToRow(update)).eq('id', id);
      assertNoError(error, 'Update audit job');
      return;
    }
    const current = memory.audits.get(id);
    if (current) {
      memory.audits.set(id, { ...current, ...update });
    }
  },

  async updateAudit(id: string, patch: Partial<ResourceAuditDocument>) {
    return this.updateAuditJob(id, patch);
  },

  async cancelAuditJob(id: string) {
    const timestamp = nowIso();
    await this.updateAuditJob(id, {
      status: 'cancelled',
      cancelledAt: timestamp,
      completedAt: timestamp,
      currentPhase: 'Cancelled by user',
      currentCheck: null,
      lockedBy: null,
      lockedAt: null,
      leaseExpiresAt: null,
    });
    await this.appendAuditEvent(id, {
      type: 'audit_cancelled',
      timestamp,
      message: 'Audit cancelled by user',
      phase: 'Cancelled by user',
    });
  },

  async cancelAudit(id: string) {
    return this.cancelAuditJob(id);
  },

  async appendAuditEvent(auditId: string, event: Omit<Partial<ResourceAuditEvent>, 'id'>) {
    const id = randomUUID();
    const audit = await this.getAuditJob(auditId);
    const fullEvent: ResourceAuditEvent = {
      id,
      type: event.type || 'progress_update',
      timestamp: event.timestamp || nowIso(),
      message: event.message || '',
      phase: event.phase,
      currentUrl: event.currentUrl,
      affectedUrl: event.affectedUrl,
      category: event.category,
      checkId: event.checkId,
      checkTitle: event.checkTitle,
      severity: event.severity,
      progress: event.progress ?? audit?.progress,
      data: event.data,
    };

    const client = getSupabaseAdminClient();
    if (client) {
      const { error } = await client.from('audit_events').insert(eventToRow(auditId, fullEvent));
      assertNoError(error, 'Append audit event');

      const countResult = await client
        .from('audit_events')
        .select('id', { count: 'exact', head: true })
        .eq('audit_id', auditId);
      assertNoError(countResult.error, 'Count audit events');
      const overLimit = (countResult.count ?? 0) - AUDIT_LIMITS.maxEvents;
      if (overLimit > 0) {
        const { data: oldRows, error: oldRowsError } = await client
          .from('audit_events')
          .select('id')
          .eq('audit_id', auditId)
          .order('created_at', { ascending: true })
          .limit(overLimit);
        assertNoError(oldRowsError, 'Find old audit events');
        const ids = (oldRows ?? []).map((row) => row.id);
        if (ids.length) {
          const { error: deleteError } = await client.from('audit_events').delete().in('id', ids);
          assertNoError(deleteError, 'Delete old audit events');
        }
      }
      return;
    }

    const events = memory.events.get(auditId) ?? [];
    events.push(fullEvent);
    memory.events.set(auditId, events.slice(-AUDIT_LIMITS.maxEvents));
  },

  async appendEvent(auditId: string, event: Omit<Partial<ResourceAuditEvent>, 'id'>) {
    return this.appendAuditEvent(auditId, event);
  },

  async addCrawledPage(auditId: string, page: Omit<ResourceAuditPage, 'id'>) {
    const fullPage: ResourceAuditPage = { id: pageIdForAuditUrl(auditId, page.url), ...page };
    const client = getSupabaseAdminClient();
    if (client) {
      const { error } = await client.from('audit_pages').upsert(pageToRow(auditId, fullPage), { onConflict: 'id' });
      assertNoError(error, 'Add crawled page');
      return fullPage;
    }

    const pages = memory.pages.get(auditId) ?? [];
    const next = pages.filter((item) => item.id !== fullPage.id);
    next.push(fullPage);
    memory.pages.set(auditId, next);
    return fullPage;
  },

  async appendPage(auditId: string, page: Omit<ResourceAuditPage, 'id'>) {
    return this.addCrawledPage(auditId, page);
  },

  async addIssue(auditId: string, issue: Omit<ResourceAuditIssue, 'id' | 'detectedAt'> & { id?: string; detectedAt?: string }) {
    const fullIssue: ResourceAuditIssue = {
      id: issue.id || randomUUID(),
      severity: issue.severity,
      category: issue.category,
      title: issue.title,
      description: issue.description,
      affectedUrl: issue.affectedUrl,
      evidence: issue.evidence,
      recommendation: issue.recommendation,
      detectedAt: issue.detectedAt || nowIso(),
    };

    const client = getSupabaseAdminClient();
    if (client) {
      const countResult = await client
        .from('audit_issues')
        .select('id', { count: 'exact', head: true })
        .eq('audit_id', auditId);
      assertNoError(countResult.error, 'Count audit issues');
      if ((countResult.count ?? 0) >= AUDIT_LIMITS.maxIssues) {
        return null;
      }

      const { error } = await client.from('audit_issues').insert(issueToRow(auditId, fullIssue));
      assertNoError(error, 'Add audit issue');
    } else {
      const issues = memory.issues.get(auditId) ?? [];
      if (issues.length >= AUDIT_LIMITS.maxIssues) {
        return null;
      }
      issues.push(fullIssue);
      memory.issues.set(auditId, issues);
    }

    const issues = await this.getLatestIssues(auditId, AUDIT_LIMITS.maxIssues);
    await this.updateAuditJob(auditId, {
      issuesFound: issues.length,
      criticalCount: issues.filter((item) => item.severity === 'critical').length,
      highCount: issues.filter((item) => item.severity === 'high').length,
      mediumCount: issues.filter((item) => item.severity === 'medium').length,
      lowCount: issues.filter((item) => item.severity === 'low').length,
    });

    await this.appendAuditEvent(auditId, {
      type: 'issue_found',
      message: fullIssue.title,
      affectedUrl: fullIssue.affectedUrl,
      category: fullIssue.category,
      severity: fullIssue.severity,
      data: {
        evidence: fullIssue.evidence,
        recommendation: fullIssue.recommendation,
      },
    });

    return fullIssue;
  },

  async appendIssue(auditId: string, issue: Omit<ResourceAuditIssue, 'id' | 'detectedAt'> & { id?: string; detectedAt?: string }) {
    return this.addIssue(auditId, issue);
  },

  async getLatestEvents(auditId: string, limit = 50): Promise<ResourceAuditEvent[]> {
    const client = getSupabaseAdminClient();
    if (client) {
      const { data, error } = await client
        .from('audit_events')
        .select('*')
        .eq('audit_id', auditId)
        .order('created_at', { ascending: false })
        .limit(limit);
      assertNoError(error, 'Get latest audit events');
      return (data ?? []).map(toAuditEvent).reverse();
    }
    return (memory.events.get(auditId) ?? []).slice(-limit);
  },

  async getEvents(auditId: string, limit = 50) {
    return this.getLatestEvents(auditId, limit);
  },

  async getLatestPages(auditId: string, limit = 100): Promise<ResourceAuditPage[]> {
    const client = getSupabaseAdminClient();
    if (client) {
      const { data, error } = await client
        .from('audit_pages')
        .select('*')
        .eq('audit_id', auditId)
        .order('crawled_at', { ascending: false })
        .limit(limit);
      assertNoError(error, 'Get latest audit pages');
      return (data ?? []).map(toAuditPage).reverse();
    }
    return (memory.pages.get(auditId) ?? []).slice(-limit);
  },

  async getPages(auditId: string, limit = 100) {
    return this.getLatestPages(auditId, limit);
  },

  async getLatestIssues(auditId: string, limit = 1000): Promise<ResourceAuditIssue[]> {
    const client = getSupabaseAdminClient();
    if (client) {
      const { data, error } = await client
        .from('audit_issues')
        .select('*')
        .eq('audit_id', auditId)
        .order('detected_at', { ascending: false })
        .limit(limit);
      assertNoError(error, 'Get latest audit issues');
      return (data ?? []).map(toAuditIssue).reverse();
    }
    return (memory.issues.get(auditId) ?? []).slice(-limit);
  },

  async getIssues(auditId: string, limit = 1000) {
    return this.getLatestIssues(auditId, limit);
  },

  async saveFinalReport(auditId: string, report: ResourceAuditReport) {
    const client = getSupabaseAdminClient();
    if (client) {
      const { error } = await client.from('audit_reports').upsert(reportToRow(auditId, report), { onConflict: 'audit_id' });
      assertNoError(error, 'Save final report');
      return;
    }
    memory.reports.set(auditId, report);
  },

  async setFinalReport(auditId: string, report: ResourceAuditReport) {
    return this.saveFinalReport(auditId, report);
  },

  async getFinalReport(auditId: string): Promise<ResourceAuditReport | null> {
    const client = getSupabaseAdminClient();
    if (client) {
      const { data, error } = await client.from('audit_reports').select('*').eq('audit_id', auditId).maybeSingle();
      assertNoError(error, 'Get final report');
      return toAuditReport(data);
    }
    return memory.reports.get(auditId) ?? null;
  },

  async getAuditLiveSnapshot(auditId: string): Promise<ResourceAuditLiveData> {
    return {
      audit: await this.getAuditJob(auditId),
      latestEvents: await this.getLatestEvents(auditId, 50),
      latestPages: await this.getLatestPages(auditId, 100),
      latestIssues: await this.getLatestIssues(auditId, 100),
      finalReport: await this.getFinalReport(auditId),
    };
  },

  async getLiveData(auditId: string) {
    return this.getAuditLiveSnapshot(auditId);
  },

  async claimQueuedAuditJob(workerId: string): Promise<ResourceAuditDocument | null> {
    const leaseExpiresAt = new Date(Date.now() + AUDIT_LIMITS.lockLeaseMs).toISOString();
    const timestamp = nowIso();
    const client = getSupabaseAdminClient();

    if (client) {
      const queued = await client
        .from('audits')
        .select('*')
        .eq('status', 'queued')
        .order('created_at', { ascending: true })
        .limit(1);
      assertNoError(queued.error, 'Find queued audit job');

      let candidate = queued.data?.[0] ?? null;
      if (!candidate) {
        const stale = await client
          .from('audits')
          .select('*')
          .eq('status', 'running')
          .lt('lease_expires_at', timestamp)
          .order('lease_expires_at', { ascending: true })
          .limit(1);
        assertNoError(stale.error, 'Find stale audit job');
        candidate = stale.data?.[0] ?? null;
      }

      if (!candidate) return null;

      let update = client
        .from('audits')
        .update({
          status: 'running',
          progress: Math.max(candidate.progress ?? 0, 1),
          current_phase: 'Audit worker started',
          locked_by: workerId,
          locked_at: timestamp,
          lease_expires_at: leaseExpiresAt,
          updated_at: timestamp,
        })
        .eq('id', candidate.id);

      if (candidate.status === 'queued') {
        update = update.eq('status', 'queued');
      } else {
        update = update.eq('status', 'running').lt('lease_expires_at', timestamp);
      }

      const { data, error } = await update.select('*').maybeSingle();
      assertNoError(error, 'Claim audit job');
      return toAuditDocument(data);
    }

    const next = Array.from(memory.audits.values())
      .filter((audit) => {
        if (audit.status === 'queued') return true;
        return audit.status === 'running' && Boolean(audit.leaseExpiresAt) && audit.leaseExpiresAt < timestamp;
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!next) return null;

    const claimed = {
      ...next,
      status: 'running' as const,
      progress: Math.max(next.progress, 1),
      currentPhase: 'Audit worker started',
      lockedBy: workerId,
      lockedAt: timestamp,
      leaseExpiresAt,
      updatedAt: timestamp,
    };
    memory.audits.set(next.id, claimed);
    return claimed;
  },

  async claimNextQueuedAudit(workerId: string) {
    return this.claimQueuedAuditJob(workerId);
  },

  async releaseAuditLock(id: string) {
    await this.updateAuditJob(id, {
      lockedBy: null,
      lockedAt: null,
      leaseExpiresAt: null,
    });
  },

  async cleanupOldAudits(limit = 25) {
    const client = getSupabaseAdminClient();
    const current = nowIso();
    if (!client) {
      for (const audit of memory.audits.values()) {
        if (audit.expiresAt < current) {
          memory.events.delete(audit.id);
          memory.pages.delete(audit.id);
          memory.issues.delete(audit.id);
          memory.reports.delete(audit.id);
          memory.audits.delete(audit.id);
        }
      }
      return;
    }

    const { error } = await client.from('audits').delete().lt('expires_at', current).limit(limit);
    assertNoError(error, 'Clean up old audits');
  },

  async clearExpiredAuditData() {
    return this.cleanupOldAudits();
  },
};
