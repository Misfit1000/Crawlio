import { randomUUID } from 'node:crypto';
import { requireSupabaseAdminClient } from '../lib/supabase/server';
import { auditRepository } from '../lib/supabase/audit-repository';
import { readEvidencePage } from '../lib/supabase/scalable-audit-repository';
import {
  EXPORT_BUCKET, EXPORT_CHUNK_SIZE, EXPORT_LEASE_MS, exportJsonHeader, exportPartPath,
  formatExportChunk, type ExportJob, type ExportChunk,
} from '../lib/report/scalable-exports';

function owned(job: ExportJob) {
  return requireSupabaseAdminClient().from('audit_export_jobs').select('id')
    .eq('id', job.id).eq('owner', job.owner!).eq('state', 'running').eq('part', job.part)
    .eq('lease_until', job.lease_until!).gt('lease_until', new Date().toISOString());
}

async function claimExportJob(workerId: string): Promise<ExportJob | null> {
  const client = requireSupabaseAdminClient();
  const now = new Date().toISOString();
  const result = await client.from('audit_export_jobs').select('*').in('state', ['queued', 'running'])
    .not('audit_id', 'is', null)
    .gt('expires_at', now).or(`lease_until.is.null,lease_until.lt.${now}`).order('created_at').limit(8);
  if (result.error) throw result.error;
  for (const candidate of (result.data || []) as ExportJob[]) {
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

async function uploadPart(job: ExportJob, text: string) {
  await checkLease(job);
  const storage = requireSupabaseAdminClient().storage.from(EXPORT_BUCKET);
  const path = exportPartPath(job.object_prefix, job.part);
  // Immutable writes prevent a stale worker overwriting a part committed by its successor.
  const result = await storage.upload(path, Buffer.from(text), { upsert: false, contentType: 'application/octet-stream' });
  if (!result.error) return;
  if (!['409', 'Duplicate', 'ResourceAlreadyExists'].includes(String((result.error as { statusCode?: string }).statusCode))
      && !['Duplicate', 'ResourceAlreadyExists'].includes((result.error as { error?: string }).error || '')) throw result.error;
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
  check: (job: ExportJob) => Promise<void>;
  upload: (job: ExportJob, text: string) => Promise<void>;
  commit: (job: ExportJob, chunk: ExportChunk) => Promise<void>;
}

/** Exactly one evidence page and one deterministic part per invocation. */
export async function processExportChunk(job: ExportJob, dependencies: ExportChunkDependencies) {
  await dependencies.check(job);
  const header = job.format === 'json' && job.part === 0 ? await dependencies.header(job) : '';
  const page = await dependencies.read(job);
  const chunk = formatExportChunk(job, page, header);
  await dependencies.check(job);
  await dependencies.upload(job, chunk.text);
  await dependencies.commit(job, chunk);
  return chunk;
}

/** Invoke once per main-worker tick; never drain an export in a loop. */
export async function runScalableExportWorkerOnce(workerId: string): Promise<boolean> {
  const job = await claimExportJob(workerId);
  if (!job) return false;
  try {
    await processExportChunk(job, {
      check: checkLease,
      read: item => readEvidencePage(item.audit_id, item.section as 'pages' | 'issues' | 'events', {
        cursor: item.cursor || undefined, limit: EXPORT_CHUNK_SIZE,
      }),
      header: async item => {
        const audit = await auditRepository.getAudit(item.audit_id);
        if (!audit || ['queued', 'running'].includes(audit.status)) throw new Error('EXPORT_AUDIT_NOT_TERMINAL');
        return exportJsonHeader(audit, await auditRepository.getFinalReport(item.audit_id));
      },
      upload: uploadPart,
      commit: commitPart,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'EXPORT_LEASE_LOST') return true;
    const permanent = ['EXPORT_PART_CONFLICT', 'EXPORT_AUDIT_NOT_TERMINAL'].includes(message);
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
export async function cleanupScalableExportsOnce(): Promise<number> {
  const client = requireSupabaseAdminClient();
  const now = new Date().toISOString();
  // Grace period lets in-flight, lease-expired storage requests settle before removal.
  const cutoff = new Date(Date.now() - EXPORT_LEASE_MS * 2).toISOString();
  const candidates = await client.from('audit_export_jobs').select('*').lt('expires_at', cutoff)
    .or(`lease_until.is.null,lease_until.lt.${now}`).order('expires_at').limit(1);
  if (candidates.error) throw candidates.error;
  const job = candidates.data?.[0] as ExportJob | undefined;
  if (!job) return 0;
  exportPartPath(job.object_prefix, 0);
  const owner = `cleanup:${randomUUID()}`;
  let claim = client.from('audit_export_jobs').update({ owner, lease_until: new Date(Date.now() + EXPORT_LEASE_MS).toISOString() })
    .eq('id', job.id).lt('expires_at', cutoff);
  claim = job.lease_until === null ? claim.is('lease_until', null) : claim.eq('lease_until', job.lease_until);
  const claimed = await claim.select('id').maybeSingle();
  if (claimed.error) throw claimed.error;
  if (!claimed.data) return 0;
  const storage = client.storage.from(EXPORT_BUCKET);
  const listed = await storage.list(job.object_prefix, { limit: 100, offset: 0, sortBy: { column: 'name', order: 'asc' } });
  if (listed.error) throw listed.error;
  const paths = (listed.data || []).map(item => `${job.object_prefix}/${item.name}`);
  if (paths.length) {
    const removed = await storage.remove(paths);
    if (removed.error) throw removed.error;
    const released = await client.from('audit_export_jobs').update({ owner: null, lease_until: null }).eq('id', job.id).eq('owner', owner);
    if (released.error) throw released.error;
  } else {
    const deleted = await client.from('audit_export_jobs').delete().eq('id', job.id).eq('owner', owner);
    if (deleted.error) throw deleted.error;
  }
  return paths.length;
}
