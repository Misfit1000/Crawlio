import { getSupabaseAdminClient, requireSupabaseAdminClient } from './server';
import type { RobotsFetchEvidence } from '../seo/robots-evaluator';

/** One write at legacy audit initialization, never a per-page or browser write. */
export async function persistAuditRobotsEvidence(auditId: string, evidence: Omit<RobotsFetchEvidence, 'document'>) {
  if (!getSupabaseAdminClient() && process.env.SEOINTEL_ALLOW_PRIVATE_TEST_TARGETS === 'true'
      && process.env.NODE_ENV !== 'production' && !process.env.VERCEL && !process.env.RENDER) return;
  const { error } = await requireSupabaseAdminClient().from('audit_tool_documents').upsert({ audit_id: auditId, robots: evidence, updated_at: new Date().toISOString() });
  if (error) throw new Error('Retained robots evidence requires migration 031 and a healthy database.');
}
