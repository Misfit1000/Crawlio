import type { Response } from 'express';
import { isTerminalAuditStatus } from '../audit/audit-time';
import type { ResourceAuditDocument, ResourceAuditReport } from '../audit/resource-types';
import { toAuditIssue, toAuditPage } from '../supabase/audit-repository';
import { requireSupabaseAdminClient } from '../supabase/server';
import {
  EXPORT_CHUNK_SIZE, exportDisposition, exportJsonHeader, exportSitemapHeader,
  exportSitemapOrigin, formatExportChunk, type ExportFormat, type ExportSection,
} from './scalable-exports';

type EvidenceSection = Exclude<ExportSection, 'done'>;
export const IMMEDIATE_EXPORT_LIMITS = { pages: 100, issues: 1000, events: 300, bytes: 2 * 1024 * 1024, milliseconds: 4000 } as const;
const TABLES = { pages: 'audit_pages', issues: 'audit_issues', events: 'audit_events' } as const;
const FIELDS = {
  pages: 'id,url,status_code,response_time_ms,page_size_bytes,title,meta_description,h1,canonical_url,site_name,favicon_url,open_graph_image,theme_color,screenshot_url,fetch_status,failure_code,failure_category,safe_title,safe_explanation,suggested_action,retryable,attempt_count,recovered_after_retry,source_url,anchor_text,word_count,crawl_depth,issue_count,crawled_at,tool_evidence',
  issues: 'id,severity,category,title,description,affected_url,evidence,recommendation,check_id,failure_code,finding_key,source_urls,affected_page_count,detected_at',
  events: 'id,type,created_at,message',
} as const;

export interface ImmediateExportDependencies {
  count: (auditId: string, section: EvidenceSection, maximum: number, signal: AbortSignal) => Promise<number>;
  read: (auditId: string, section: EvidenceSection, cursor: string | null, signal: AbortSignal) => Promise<{ items: unknown[]; nextCursor: string | null }>;
  report: (auditId: string, signal: AbortSignal) => Promise<ResourceAuditReport | null>;
  now?: () => number;
}

const databaseDependencies: ImmediateExportDependencies = {
  async count(auditId, section, maximum, signal) {
    // An indexed, capped ID read avoids an unbounded COUNT on large audits.
    const { data, error } = await requireSupabaseAdminClient().from(TABLES[section])
      .select('id').eq('audit_id', auditId).limit(maximum + 1).abortSignal(signal);
    if (error) throw error;
    if (!data) throw new Error('Export evidence counts are unavailable.');
    return data.length;
  },
  async read(auditId, section, cursor, signal) {
    let query = requireSupabaseAdminClient().from(TABLES[section]).select(FIELDS[section])
      .eq('audit_id', auditId).order('id').limit(EXPORT_CHUNK_SIZE + 1).abortSignal(signal);
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query.returns<Record<string, unknown>[]>();
    if (error) throw error;
    if (!data) throw new Error('Export evidence is unavailable.');
    const rows = data.slice(0, EXPORT_CHUNK_SIZE);
    const items = rows.map(row => section === 'pages' ? toAuditPage(row) : section === 'issues' ? toAuditIssue(row)
      : { id: row.id, type: row.type, timestamp: row.created_at, message: row.message });
    return { items, nextCursor: data.length > EXPORT_CHUNK_SIZE ? String(rows.at(-1)!.id) : null };
  },
  async report(auditId, signal) {
    const { data, error } = await requireSupabaseAdminClient().from('audit_reports')
      .select('scores,summary,generated_at').eq('audit_id', auditId).abortSignal(signal).maybeSingle();
    if (error) throw error;
    return data ? { scores: data.scores ?? {}, summary: typeof data.summary === 'string' ? data.summary : data.summary?.text ?? '',
      generatedAt: data.generated_at, pages: [], topIssues: [], exports: { json: '', issuesCsv: '', pagesCsv: '' } } : null;
  },
};

class PreparationLimit extends Error {}

/** Complete retained evidence only. A null result asks the caller to use the existing worker job. */
export async function prepareImmediateExport(audit: ResourceAuditDocument, format: ExportFormat,
  dependencies: ImmediateExportDependencies = databaseDependencies, signal?: AbortSignal,
): Promise<{ body: Buffer; contentType: string } | null> {
  if (!isTerminalAuditStatus(audit.status)) return null;
  signal?.throwIfAborted();
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  const now = dependencies.now || Date.now;
  const started = now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const checkBudget = () => {
    signal?.throwIfAborted();
    if (controller.signal.aborted || now() - started >= IMMEDIATE_EXPORT_LIMITS.milliseconds) throw new PreparationLimit();
  };
  const prepare = async () => {
    const sections: EvidenceSection[] = ['pages', 'issues', 'events'];
    const counts = await Promise.all(sections.map(section => dependencies.count(audit.id, section, IMMEDIATE_EXPORT_LIMITS[section], controller.signal)));
    checkBudget();
    if (counts.some((count, index) => !Number.isSafeInteger(count) || count < 0 || count > IMMEDIATE_EXPORT_LIMITS[sections[index]])) return null;
    const expected = Object.fromEntries(sections.map((section, index) => [section, counts[index]])) as Record<EvidenceSection, number>;
    const finalReport = format === 'json' ? await dependencies.report(audit.id, controller.signal) : null;
    checkBudget();
    const header = format === 'json' ? exportJsonHeader(audit, finalReport) : format === 'sitemap.xml' ? exportSitemapHeader() : '';
    const origin = format === 'sitemap.xml' ? exportSitemapOrigin(audit) : undefined;
    const parts: Buffer[] = [];
    let bytes = 0;
    let job = { format, section: format === 'issues.csv' ? 'issues' as ExportSection : 'pages' as ExportSection, cursor: null as string | null, part: 0 };
    const seen = { pages: new Set<string>(), issues: new Set<string>(), events: new Set<string>() };
    while (job.section !== 'done') {
      checkBudget();
      const section = job.section as EvidenceSection;
      const page = await dependencies.read(audit.id, section, job.cursor, controller.signal);
      checkBudget();
      // Reject inconsistent reads rather than exporting a sample during concurrent cleanup.
      for (const item of page.items) {
        const id = (item as { id?: unknown })?.id;
        if (typeof id !== 'string' || seen[section].has(id)) throw new PreparationLimit();
        seen[section].add(id);
      }
      if (seen[section].size > expected[section] || (page.nextCursor === null && seen[section].size !== expected[section])) throw new PreparationLimit();
      const chunk = formatExportChunk(job, page, job.part === 0 ? header : '', origin, audit.scope);
      const part = Buffer.from(chunk.text);
      bytes += part.length;
      if (bytes > IMMEDIATE_EXPORT_LIMITS.bytes) throw new PreparationLimit();
      parts.push(part);
      job = { format, section: chunk.section, cursor: chunk.cursor, part: chunk.part };
    }
    checkBudget();
    return { body: Buffer.concat(parts, bytes), contentType: format === 'json' ? 'application/json; charset=utf-8'
      : format === 'sitemap.xml' ? 'application/xml; charset=utf-8' : 'text/csv; charset=utf-8' };
  };
  try {
    const deadline = new Promise<null>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, IMMEDIATE_EXPORT_LIMITS.milliseconds); });
    return await Promise.race([prepare(), deadline]);
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof PreparationLimit || controller.signal.aborted) return null;
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
    signal?.removeEventListener('abort', cancel);
  }
}

/** Authorization and plan checks belong to the route. Set download headers only after complete preparation. */
export async function tryImmediateExportDownload(res: Response, audit: ResourceAuditDocument, format: ExportFormat,
  dependencies?: ImmediateExportDependencies, signal?: AbortSignal,
) {
  const prepared = await prepareImmediateExport(audit, format, dependencies, signal);
  if (!prepared) return false;
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', prepared.contentType);
  res.setHeader('Content-Disposition', exportDisposition(audit.hostname, format));
  res.setHeader('Content-Length', String(prepared.body.length));
  res.status(200).send(prepared.body);
  return true;
}
