import { randomUUID } from 'node:crypto';
import { requireSupabaseAdminClient } from '../lib/supabase/server';
import { auditRepository } from '../lib/supabase/audit-repository';
import { readEvidencePage } from '../lib/supabase/scalable-audit-repository';
import {
  EXPORT_BUCKET, EXPORT_CHUNK_SIZE, EXPORT_LEASE_MS, exportJsonHeader, exportPartPath, exportSitemapHeader, exportSitemapOrigin,
  formatExportChunk, type ExportJob, type ExportChunk,
} from '../lib/report/scalable-exports';

function owned(job: ExportJob) {
  return requireSupabaseAdminClient().from('audit_export_jobs').select('id')
    .eq('id', job.id).eq('owner', job.owner!).eq('state', 'running').eq('part', job.part)
    .eq('lease_until', job.lease_until!).gt('lease_until', new Date().toISOString());
}

async function claimExportJob(workerId: string, shouldContinue: () => boolean): Promise<ExportJob | null> {
  if (!shouldContinue()) return null;
  const client = requireSupabaseAdminClient();
  const now = new Date().toISOString();
  const result = await client.from('audit_export_jobs').select('*').in('state', ['queued', 'running'])
    .not('audit_id', 'is', null)
    .gt('expires_at', now).or(`lease_until.is.null,lease_until.lt.${now}`).order('created_at').limit(8);
  if (result.error) throw result.error;
  for (const candidate of (result.data || []) as ExportJob[]) {
    if (!shouldContinue()) return null;
    // A fresh token per claim fences even overlapping calls from the same worker.
    let query = client.from('audit_export_jobs').update({ state: 'running', owner: `${workerId.slice(0, 80)}:${randomUUID()}`,
      lease_until: new Date(Date.now() + EXPORT_LEASE_MS).toISOString(),
    }).eq('id', candidate.id).eq('state', candidate.state).eq('part', candidate.part).gt('expires_at', now);
    query = candidate.lease_until === null ? query.is('lease_until', null) : query.eq('lease_until', candidate.lease_until);
    const claimed = await query.select('*').maybeSingle();
    if (claimed.error) throw claimed.error;
    if (claimed.data) return claimed.data as ExportJob;
  }
  return null;
}

async function checkLease(job: ExportJob) {
  const result = await owned(job).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data || Date.parse(job.expires_at) <= Date.now()) throw new Error('EXPORT_LEASE_LOST');
}

async function uploadPart(job: ExportJob, text: string, shouldContinue: () => boolean) {
  await checkLease(job);
  ensureMaintenanceIdle(shouldContinue);
  const storage = requireSupabaseAdminClient().storage.from(EXPORT_BUCKET);
  const path = exportPartPath(job.object_prefix, job.part);
  // Immutable writes prevent a stale worker overwriting a part committed by its successor.
  const result = await storage.upload(path, Buffer.from(text), { upsert: false, contentType: 'application/octet-stream' });
  if (!result.error) return;
  if (!['409', 'Duplicate', 'ResourceAlreadyExists'].includes(String((result.error as { statusCode?: string }).statusCode))
      && !['Duplicate', 'ResourceAlreadyExists'].includes((result.error as { error?: string }).error || '')) throw result.error;
  ensureMaintenanceIdle(shouldContinue);
  const previous = await storage.download(path);
  if (previous.error) throw previous.error;
  if (await previous.data.text() !== text) throw new Error('EXPORT_PART_CONFLICT');
}

async function commitPart(job: ExportJob, chunk: ExportChunk) {
  const client = requireSupabaseAdminClient();
  const result = await client.from('audit_export_jobs').update({
    state: chunk.ready ? 'ready' : 'queued', part: chunk.part, section: chunk.section, cursor: chunk.cursor,
    owner: null, lease_until: null, error: null,
  }).eq('id', job.id).eq('owner', job.owner!).eq('state', 'running').eq('part', job.part)
    .eq('lease_until', job.lease_until!).gt('lease_until', new Date().toISOString())
    .gt('expires_at', new Date().toISOString()).select('id').maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error('EXPORT_LEASE_LOST');
}

export interface ExportChunkDependencies {
  read: (job: ExportJob) => Promise<{ items: unknown[]; nextCursor: string | null }>;
  header: (job: ExportJob) => Promise<string>;
  origin?: (job: ExportJob) => Promise<string>;
  check: (job: ExportJob) => Promise<void>;
  upload: (job: ExportJob, text: string) => Promise<void>;
  commit: (job: ExportJob, chunk: ExportChunk) => Promise<void>;
  shouldContinue?: () => boolean;
}

function ensureMaintenanceIdle(shouldContinue?: () => boolean) {
  if (shouldContinue && !shouldContinue()) throw new Error('EXPORT_MAINTENANCE_YIELDED');
}

/** Exactly one evidence page and one deterministic part per invocation. */
export async function processExportChunk(job: ExportJob, dependencies: ExportChunkDependencies) {
  ensureMaintenanceIdle(dependencies.shouldContinue);
  await dependencies.check(job);
  if (job.format === 'sitemap.xml' && job.section !== 'pages') throw new Error('Sitemap export requires pages');
  ensureMaintenanceIdle(dependencies.shouldContinue);
  const header = (job.format === 'json' || job.format === 'sitemap.xml') && job.part === 0 ? await dependencies.header(job) : '';
  ensureMaintenanceIdle(dependencies.shouldContinue);
  const origin = job.format === 'sitemap.xml' ? await dependencies.origin?.(job) : undefined;
  ensureMaintenanceIdle(dependencies.shouldContinue);
  const page = await dependencies.read(job);
  ensureMaintenanceIdle(dependencies.shouldContinue);
  const chunk = formatExportChunk(job, page, header, origin);
  await dependencies.check(job);
  ensureMaintenanceIdle(dependencies.shouldContinue);
  await dependencies.upload(job, chunk.text);
  ensureMaintenanceIdle(dependencies.shouldContinue);
  await dependencies.commit(job, chunk);
  return chunk;
}

/** One idle maintenance turn; never drain an export in a loop. */
export async function runScalableExportWorkerOnce(workerId: string, shouldContinue = () => true): Promise<boolean> {
  const job = await claimExportJob(workerId, shouldContinue);
  if (!job) return false;
  try {
    await processExportChunk(job, {
      shouldContinue,
      check: checkLease,
      read: item => readEvidencePage(item.audit_id, item.section as 'pages' | 'issues' | 'events', {
        cursor: item.cursor || undefined, limit: EXPORT_CHUNK_SIZE,
      }),
      header: async item => {
        if (item.format === 'sitemap.xml') return exportSitemapHeader();
        const audit = await auditRepository.getAudit(item.audit_id);
        if (!audit || ['queued', 'running'].includes(audit.status)) throw new Error('EXPORT_AUDIT_NOT_TERMINAL');
        ensureMaintenanceIdle(shouldContinue);
        return exportJsonHeader(audit, await auditRepository.getFinalReport(item.audit_id));
      },
      origin: async item => {
        const audit = await auditRepository.getAudit(item.audit_id);
        if (!audit || ['queued', 'running'].includes(audit.status)) throw new Error('EXPORT_AUDIT_NOT_TERMINAL');
        return exportSitemapOrigin(audit);
      },
      upload: async (item, text) => {
        ensureMaintenanceIdle(shouldContinue);
        await uploadPart(item, text, shouldContinue);
      },
      commit: commitPart,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    // Yield without a new write; the unchanged checkpoint resumes after lease expiry.
    if (message === 'EXPORT_LEASE_LOST' || message === 'EXPORT_MAINTENANCE_YIELDED' || !shouldContinue()) return true;
    const permanent = ['EXPORT_PART_CONFLICT', 'EXPORT_AUDIT_NOT_TERMINAL', 'EXPORT_SITEMAP_ORIGIN_INVALID'].includes(message);
    // A transient failure leaves the checkpoint untouched and retries after lease expiry.
    const result = await requireSupabaseAdminClient().from('audit_export_jobs').update({
      ...(permanent ? { state: 'failed', owner: null, lease_until: null } : {}),
      error: permanent ? 'Export could not be completed consistently.' : 'Temporary export failure; retry pending.',
    }).eq('id', job.id).eq('owner', job.owner!).eq('part', job.part).eq('lease_until', job.lease_until!)
      .gt('lease_until', new Date().toISOString());
    if (result.error) throw result.error;
  }
  return true;
}

/** One expired job, at most 100 private objects per call, including uncommitted uploads. */
export async function cleanupScalableExportsOnce(shouldContinue = () => true): Promise<number> {
  if (!shouldContinue()) return 0;
  const client = requireSupabaseAdminClient();
  const now = new Date().toISOString();
  // Grace period lets in-flight, lease-expired storage requests settle before removal.
  const cutoff = new Date(Date.now() - EXPORT_LEASE_MS * 2).toISOString();
  const candidates = await client.from('audit_export_jobs').select('*').lt('expires_at', cutoff)
    .or(`lease_until.is.null,lease_until.lt.${now}`).order('expires_at').limit(1);
  if (candidates.error) throw candidates.error;
  const job = candidates.data?.[0] as ExportJob | undefined;
  if (!job) return 0;
  if (!shouldContinue()) return 0;
  exportPartPath(job.object_prefix, 0);
  const owner = `cleanup:${randomUUID()}`;
  let claim = client.from('audit_export_jobs').update({ owner, lease_until: new Date(Date.now() + EXPORT_LEASE_MS).toISOString() })
    .eq('id', job.id).lt('expires_at', cutoff);
  claim = job.lease_until === null ? claim.is('lease_until', null) : claim.eq('lease_until', job.lease_until);
  const claimed = await claim.select('id').maybeSingle();
  if (claimed.error) throw claimed.error;
  if (!claimed.data) return 0;
  if (!shouldContinue()) return 0;
  const storage = client.storage.from(EXPORT_BUCKET);
  const listed = await storage.list(job.object_prefix, { limit: 100, offset: 0, sortBy: { column: 'name', order: 'asc' } });
  if (listed.error) throw listed.error;
  const paths = (listed.data || []).map(item => `${job.object_prefix}/${item.name}`);
  if (!shouldContinue()) return 0;
  if (paths.length) {
    const removed = await storage.remove(paths);
    if (removed.error) throw removed.error;
    if (!shouldContinue()) return paths.length;
    const released = await client.from('audit_export_jobs').update({ owner: null, lease_until: null }).eq('id', job.id).eq('owner', owner);
    if (released.error) throw released.error;
  } else {
    const deleted = await client.from('audit_export_jobs').delete().eq('id', job.id).eq('owner', owner);
    if (deleted.error) throw deleted.error;
  }
  return paths.length;
}

export const EXPORT_POLL_INTERVAL_MS = 15_000;
export const EXPORT_CLEANUP_INTERVAL_MS = 5 * 60_000;

export function createScalableExportMaintenance(
  workerId: string,
  isIdle: () => boolean,
  dependencies = { now: Date.now, runExport: runScalableExportWorkerOnce, cleanup: cleanupScalableExportsOnce },
) {
  let lastExport = -Infinity;
  let lastCleanup = -Infinity;
  let task: Promise<void> | undefined;
  const run = async () => {
    if (!isIdle()) return;
    if (dependencies.now() - lastExport >= EXPORT_POLL_INTERVAL_MS) {
      lastExport = dependencies.now();
      await dependencies.runExport(workerId, isIdle);
    }
    if (!isIdle()) return;
    if (dependencies.now() - lastCleanup >= EXPORT_CLEANUP_INTERVAL_MS) {
      lastCleanup = dependencies.now();
      await dependencies.cleanup(isIdle);
    }
  };
  return {
    tick(): Promise<void> {
      if (task) return task;
      task = run().finally(() => { task = undefined; });
      return task;
    },
  };
}
