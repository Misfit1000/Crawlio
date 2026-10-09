import type { Request, Router } from 'express';
import type { ResourceAuditDocument } from '../lib/audit/resource-types';
import { readEvidencePage, validateEvidenceAffectedUrl, type EvidenceKind } from '../lib/supabase/scalable-audit-repository';
import { requireSupabaseAdminClient } from '../lib/supabase/server';
import { isAuditPresentationSection } from '../lib/audit/audit-presentation-summary';

export function parseEvidenceQuery(query: Record<string, unknown>, kind: EvidenceKind) {
  const scalar = (key: string) => {
    const value = query[key];
    if (value !== undefined && typeof value !== 'string') throw new Error(`Invalid ${key}`);
    return value as string | undefined;
  };
  const cursor = scalar('cursor');
  const rawLimit = scalar('limit');
  const severity = scalar('severity');
  const category = scalar('category');
  const search = scalar('query');
  const section = scalar('section');
  const affectedUrl = validateEvidenceAffectedUrl(scalar('affectedUrl'));
  if (cursor !== undefined && !/^[a-zA-Z0-9_-]{1,100}$/.test(cursor)) throw new Error('Invalid cursor');
  if (rawLimit !== undefined && (!/^\d+$/.test(rawLimit) || !Number.isSafeInteger(Number(rawLimit)) || Number(rawLimit) < 1)) throw new Error('Invalid limit');
  if (severity !== undefined && !['critical', 'high', 'medium', 'low', 'info'].includes(severity)) throw new Error('Invalid severity');
  if (category !== undefined && (!category.trim() || category.length > 100)) throw new Error('Invalid category');
  if (search !== undefined && (search.length > 160 || /[\u0000-\u001f\u007f]/.test(search))) throw new Error('Invalid query');
  if (section !== undefined && !isAuditPresentationSection(section)) throw new Error('Invalid section');
  if (kind !== 'issues' && (severity !== undefined || category !== undefined || search !== undefined || section !== undefined || affectedUrl !== undefined)) throw new Error('Filters require issues');
  return { cursor, limit: Math.min(100, Number(rawLimit ?? 50)), severity, category, query: search?.trim() || undefined, section, affectedUrl };
}

export async function evidenceTotal(audit: ResourceAuditDocument, kind: EvidenceKind): Promise<number | null> {
  if (kind === 'issues') return audit.issuesFound;
  if (kind !== 'pages') return null;
  if (audit.processingVersion !== 2) return audit.pagesCrawled;
  const { data, error } = await requireSupabaseAdminClient().from('audit_crawl_runs')
    .select('page_count').eq('audit_id', audit.id).maybeSingle();
  if (error) throw error;
  // page_count includes successful, failed and robots-blocked stored pages.
  return data?.page_count == null ? null : Number(data.page_count);
}

export function registerScalableEvidenceRoutes(router: Router, dependencies: {
  requireAccess: (req: Request, auditId: string) => Promise<ResourceAuditDocument | null>;
  readPage?: typeof readEvidencePage;
  readTotal?: typeof evidenceTotal;
}) {
  router.get('/audit/:id/evidence/:kind', async (req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      // Never query evidence until ownership (including guest ownership) is established.
      const audit = await dependencies.requireAccess(req, String(req.params.id));
      if (!audit) { res.status(404).json({ success: false, error: 'Audit not found.' }); return; }
      const kind = req.params.kind as EvidenceKind;
      if (!['pages', 'issues', 'events'].includes(kind)) { res.status(400).json({ success: false, error: 'Invalid evidence kind.' }); return; }
      let input: ReturnType<typeof parseEvidenceQuery>;
      try { input = parseEvidenceQuery(req.query, kind); }
      catch (error) { res.status(400).json({ success: false, error: (error as Error).message }); return; }
      const page = await (dependencies.readPage || readEvidencePage)(audit.id, kind, input);
      const total = await (dependencies.readTotal || evidenceTotal)(audit, kind);
      const filtered = !!(input.severity || input.category || input.query || input.section || input.affectedUrl);
      const sectionOnly = kind === 'issues' && input.section && !input.severity && !input.category && !input.query && !input.affectedUrl;
      const matchingCount = !filtered ? total : sectionOnly && audit.presentationSummary
        ? audit.presentationSummary.findingsBySection[input.section!] ?? 0 : null;
      res.json({ success: true, data: {
        ...page, auditId: audit.id, kind,
        total, totalScope: 'audit',
        // Only unfiltered totals and complete section aggregates are available without another scan.
        matchingCount, filteredTotal: matchingCount,
      } });
    } catch (error) { next(error); }
  });
}
