import type { Request, Router } from 'express';
import type { ResourceAuditDocument } from '../lib/audit/resource-types';
import { requireSupabaseAdminClient } from '../lib/supabase/server';

export function registerAuditToolRoutes(router: Router, dependencies: {
  requireAccess: (request: Request, auditId: string) => Promise<ResourceAuditDocument | null>;
  readMetadata?: (audit: ResourceAuditDocument) => Promise<Record<string, unknown>>;
}) {
  router.get('/audit/:id/tool-evidence', async (request, response, next) => {
    response.setHeader('Cache-Control', 'private, no-store');
    try {
      const audit = await dependencies.requireAccess(request, String(request.params.id));
      if (!audit) { response.status(404).json({ success: false, code: 'AUDIT_NOT_FOUND', error: 'Audit not found.' }); return; }
      const metadata = dependencies.readMetadata ? await dependencies.readMetadata(audit) : await (async () => {
        const result = await requireSupabaseAdminClient().from('audit_tool_documents').select('robots').eq('audit_id', audit.id).maybeSingle();
        if (result.error) throw result.error;
        return { robotsEvidence: result.data?.robots || null, retainedCount: audit.presentationSummary?.attemptedPages ?? null };
      })();
      const robots = metadata.robotsEvidence && typeof metadata.robotsEvidence === 'object' ? metadata.robotsEvidence as Record<string, unknown> : null;
      // Never serialize arbitrary run metadata, leases, tokens or internal error details.
      response.json({ success: true, data: {
        auditId: audit.id, processingVersion: audit.processingVersion || 1, status: audit.status,
        analysedCount: audit.pagesCrawled, retainedCount: metadata.retainedCount ?? null, evidenceTimestamp: audit.updatedAt,
        robots: robots ? { state: robots.state, raw: typeof robots.raw === 'string' ? robots.raw.slice(0, 128_000) : '',
          statusCode: typeof robots.statusCode === 'number' ? robots.statusCode : null, fetchedAt: robots.fetchedAt,
          truncated: robots.truncated === true,
          warnings: Array.isArray(robots.warnings) ? robots.warnings.filter(value => typeof value === 'string').slice(0, 20) : [] } : null,
      } });
    } catch (error) { next(error); }
  });
}
