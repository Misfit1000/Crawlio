import { requireSupabaseAdminClient } from '../supabase/server';

export async function recordAuditLaunchObservation(auditId: string, authMs: number, admissionMs: number, responseMs: number) {
  const bounded = (value: number) => Math.max(0, Math.min(120_000, Number.isFinite(value) ? value : 0));
  const { error } = await requireSupabaseAdminClient().from('audit_launch_observations').upsert({
    audit_id: auditId, auth_ms: bounded(authMs), admission_ms: bounded(admissionMs), response_preparation_ms: bounded(responseMs),
  }, { onConflict: 'audit_id', ignoreDuplicates: true }).abortSignal(AbortSignal.timeout(2_000));
  if (error) console.warn(JSON.stringify({ event: 'audit_launch_observation_unavailable', code: error.code }));
}
