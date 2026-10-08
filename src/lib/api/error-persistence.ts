import { getSupabaseAdminClient } from '../supabase/server';
import { getCommitIdentifier } from '../platform/version';

interface ApiErrorContext {
  request_id: string;
  route: string;
  method: string;
  user_id: string | null;
  internal_code: string;
}

export function redactInternalDetails(value: unknown) {
  const text = value instanceof Error ? `${value.name}: ${value.message}\n${value.stack || ''}` : String(value || 'Unknown error');
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
    .replace(/(service[_-]?role|api[_-]?key|password|authorization)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .slice(0, 12_000);
}

export async function persistApiError(context: ApiErrorContext, error: unknown) {
  try {
    const client = getSupabaseAdminClient();
    if (!client) return;
    await client.from('api_error_logs').insert({
      ...context,
      internal_details: redactInternalDetails(error),
      deployment_version: getCommitIdentifier(),
    }).abortSignal(AbortSignal.timeout(1_000));
  } catch {
    // Persistence is best-effort and must not replace the safe API response.
  }
}
