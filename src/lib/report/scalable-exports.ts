import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Response } from 'express';
import type { ResourceAuditDocument, ResourceAuditReport } from '../audit/resource-types';
import { requireSupabaseAdminClient } from '../supabase/server';
import { buildPublicAuditExport, csvRow } from './export';

export const EXPORT_BUCKET = 'audit-exports';
export const EXPORT_CHUNK_SIZE = 50;
export const EXPORT_LEASE_MS = 120_000;
export type ExportFormat = 'json' | 'pages.csv' | 'issues.csv';
export type ExportSection = 'pages' | 'issues' | 'events' | 'done';
export interface ExportJob {
  id: string;
  audit_id: string;
  format: ExportFormat;
  state: 'queued' | 'running' | 'ready' | 'failed';
  owner: string | null;
  lease_until: string | null;
  cursor: string | null;
  section: ExportSection;
  part: number;
  object_prefix: string;
  error: string | null;
  created_at: string;
  expires_at: string;
}

const PAGE_FIELDS = 'id url statusCode responseTimeMs pageSizeBytes title metaDescription h1 canonicalUrl siteName faviconUrl openGraphImage themeColor screenshotUrl fetchStatus failureCode failureCategory safeTitle safeExplanation suggestedAction retryable attemptCount recoveredAfterRetry sourceUrl anchorText wordCount crawlDepth issueCount crawledAt'.split(' ');
const ISSUE_FIELDS = 'id severity category title description affectedUrl evidence recommendation checkId failureCode findingKey sourceUrls affectedPageCount detectedAt'.split(' ');
const EVENT_FIELDS = 'id type timestamp message phase currentUrl affectedUrl category checkId checkTitle severity progress'.split(' ');
const CSV_FIELDS = {
  'pages.csv': 'statusCode,url,responseTimeMs,pageSizeBytes,title,wordCount,crawlDepth,issueCount'.split(','),
  'issues.csv': 'severity,category,title,affectedUrl,evidence,recommendation'.split(','),
};

export function isScalableExportFormat(value: string): value is ExportFormat {
  return value === 'json' || value === 'pages.csv' || value === 'issues.csv';
}

// Pick only public scalar evidence. Never serialize arbitrary row metadata or event data.
export function publicExportEvidence(section: Exclude<ExportSection, 'done'>, item: unknown) {
  const source = item as Record<string, unknown>;
  const fields = section === 'pages' ? PAGE_FIELDS : section === 'issues' ? ISSUE_FIELDS : EVENT_FIELDS;
  return Object.fromEntries(fields.flatMap(key => {
    const value = source[key];
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return [[key, value]];
    if (key === 'sourceUrls' && Array.isArray(value)) return [[key, value.filter(v => typeof v === 'string')]];
    return [];
  }));
}

export function exportPartPath(prefix: string, part: number) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(prefix)
      || !Number.isSafeInteger(part) || part < 0) throw new Error('Invalid export part');
  return `${prefix}/${String(part).padStart(10, '0')}`;
}

export function exportDisposition(hostname: string, format: ExportFormat) {
  const host = hostname.replace(/[^a-z0-9.-]/gi, '-').slice(0, 100) || 'website';
  return `attachment; filename="crawlio-${host}-audit.${format}"`;
}

export function exportJsonHeader(audit: ResourceAuditDocument, finalReport?: ResourceAuditReport | null) {
  const value = buildPublicAuditExport({ audit, latestPages: [], latestIssues: [], latestEvents: [], finalReport: null })!;
  // Keep canonical scores, but place complete evidence only in the streamed arrays.
  const report = finalReport ? { scores: finalReport.scores, summary: finalReport.summary, generatedAt: finalReport.generatedAt } : null;
  return `{"success":true,"data":${JSON.stringify({ generator: value.generator, audit: value.audit, report }).slice(0, -1)},"pages":[`;
}

export interface ExportChunk {
  text: string;
  cursor: string | null;
  section: ExportSection;
  part: number;
  ready: boolean;
}

export function formatExportChunk(
  job: Pick<ExportJob, 'format' | 'section' | 'cursor' | 'part'>,
  page: { items: unknown[]; nextCursor: string | null },
  header = '',
): ExportChunk {
  if (job.section === 'done' || page.items.length > EXPORT_CHUNK_SIZE) throw new Error('Invalid export chunk');
  if (page.nextCursor && (!page.items.length || page.nextCursor === job.cursor)) throw new Error('Export cursor did not advance');
  let section: ExportSection = job.section;
  let text: string;
  let ready = false;
  if (job.format !== 'json') {
    const fields = CSV_FIELDS[job.format];
    text = (job.part === 0 ? `${fields.join(',')}\n` : '')
      + page.items.map(item => csvRow(fields.map(key => (item as Record<string, unknown>)[key])) + '\n').join('');
    ready = page.nextCursor === null;
    if (ready) section = 'done';
  } else {
    if (job.part === 0 && !header) throw new Error('JSON export requires a header');
    text = (job.part === 0 ? header : '') + (job.cursor && page.items.length ? ',' : '')
      + page.items.map(item => JSON.stringify(publicExportEvidence(job.section as Exclude<ExportSection, 'done'>, item))).join(',');
    if (page.nextCursor === null) {
      if (section === 'pages') { text += '],"issues":['; section = 'issues'; }
      else if (section === 'issues') { text += '],"events":['; section = 'events'; }
      else { text += ']}}'; section = 'done'; ready = true; }
    }
  }
  return { text, cursor: page.nextCursor, section, part: job.part + 1, ready };
}

/** Internal compact manifest: part is the exclusive upper bound of committed parts. */
export function exportManifest(job: ExportJob) {
  if (job.state !== 'ready' || job.section !== 'done' || job.part < 1) throw new Error('Export is not ready');
  exportPartPath(job.object_prefix, job.part - 1);
  return { version: 1 as const, bucket: EXPORT_BUCKET, prefix: job.object_prefix, parts: job.part,
    contentType: job.format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8' };
}

/** Caller MUST authorize audit access and plan exports before invoking this helper. */
export async function enqueueOrGetScalableExport(audit: ResourceAuditDocument, format: ExportFormat): Promise<ExportJob> {
  if (!isScalableExportFormat(format)) throw new Error('Unsupported export format');
  if (audit.status === 'queued' || audit.status === 'running') throw new Error('Audit evidence is still changing');
  const client = requireSupabaseAdminClient();
  const { error } = await client.from('audit_export_jobs').upsert({ audit_id: audit.id, format,
    section: format === 'issues.csv' ? 'issues' : 'pages',
  }, { onConflict: 'audit_id,format', ignoreDuplicates: true });
  if (error) throw error;
  const result = await client.from('audit_export_jobs').select('*').eq('audit_id', audit.id).eq('format', format).single();
  if (result.error) throw result.error;
  return result.data as ExportJob;
}

export async function* readExportParts(job: ExportJob, signal?: AbortSignal) {
  const manifest = exportManifest(job);
  const storage = requireSupabaseAdminClient().storage.from(manifest.bucket);
  for (let part = 0; part < manifest.parts; part++) {
    signal?.throwIfAborted();
    if (Date.parse(job.expires_at) <= Date.now()) throw new Error('Export expired');
    // Supabase buffers a single bounded part, never the whole export.
    const { data, error } = await storage.download(exportPartPath(manifest.prefix, part));
    signal?.throwIfAborted();
    if (error) throw error;
    yield new Uint8Array(await data.arrayBuffer());
  }
}

/** Call only AFTER ownership and exportsEnabled checks, BEFORE getLiveData. */
export async function handleScalableExportDownload(res: Response, audit: ResourceAuditDocument, format: ExportFormat) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (audit.status === 'queued' || audit.status === 'running') {
    return res.status(409).json({ success: false, error: 'Data export is available after the audit stops.' });
  }
  const job = await enqueueOrGetScalableExport(audit, format);
  if (Date.parse(job.expires_at) <= Date.now()) {
    return res.status(410).json({ success: false, error: 'Export expired. Cleanup is pending; try again shortly.' });
  }
  if (job.state === 'failed') return res.status(500).json({ success: false, error: 'Export generation failed. Please try again after this export expires.' });
  if (job.state !== 'ready') {
    res.setHeader('Retry-After', '2');
    return res.status(202).json({ success: true, data: { id: job.id, state: job.state, expiresAt: job.expires_at } });
  }
  const manifest = exportManifest(job);
  res.setHeader('Content-Type', manifest.contentType);
  res.setHeader('Content-Disposition', exportDisposition(audit.hostname, format));
  const controller = new AbortController();
  const cancel = () => controller.abort();
  res.once('close', cancel);
  try {
    await pipeline(Readable.from(readExportParts(job, controller.signal)), res, { signal: controller.signal });
  } finally { res.off('close', cancel); }
}
