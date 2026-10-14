import { requireSupabaseAdminClient } from '../supabase/server';
import { allowedWorkerControlUrl } from '../audit/worker-wake';
import type { ResourceAuditDocument } from '../audit/resource-types';
import type { SitePreview, SitePreviewStatus } from './types';

export function previewTargetAllowed(value: string): boolean {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      && ![...url.searchParams.keys()].some(key => /^(access_token|token|password|secret|api_key|apikey|signature|auth|authorization|code)$/i.test(key));
  } catch { return false; }
}

export function previewsConfigured() {
  return process.env.SITE_PREVIEWS_ENABLED === 'true'
    && !!allowedWorkerControlUrl(process.env.SITE_PREVIEW_WORKER_URL, 'preview')
    && (process.env.PREVIEW_CONTROL_SECRET?.length || 0) >= 32;
}

export async function wakePreviewWorker() {
  if (!previewsConfigured()) return;
  const url = allowedWorkerControlUrl(process.env.SITE_PREVIEW_WORKER_URL, 'preview')!;
  try {
    const response = await fetch(url, { method: 'POST', redirect: 'error',
      headers: { authorization: `Bearer ${process.env.PREVIEW_CONTROL_SECRET}` }, signal: AbortSignal.timeout(3_000) });
    await response.body?.cancel();
    if (!response.ok) console.warn(JSON.stringify({ event: 'preview_wake_unconfirmed', status: response.status }));
  } catch { console.warn(JSON.stringify({ event: 'preview_wake_unconfirmed' })); }
}

export async function enqueueAuditPreview(audit: Pick<ResourceAuditDocument, 'id' | 'normalizedUrl'>, wake = true): Promise<void> {
  if (!previewsConfigured() || !previewTargetAllowed(audit.normalizedUrl)) return;
  const { data, error } = await requireSupabaseAdminClient().rpc('request_audit_preview', { p_audit: audit.id });
  if (error) { console.warn(JSON.stringify({ event: 'preview_queue_unavailable' })); return; }
  if (wake && (data?.status === 'queued' || data?.status === 'running')) await wakePreviewWorker();
}

export async function getAuditPreview(audit: Pick<ResourceAuditDocument, 'id' | 'normalizedUrl'>): Promise<SitePreview> {
  if (!previewTargetAllowed(audit.normalizedUrl)) return { status: 'blocked', targetUrl: audit.normalizedUrl, failureCode: 'SENSITIVE_URL' };
  const client = requireSupabaseAdminClient();
  const { data: link, error } = await client.from('audit_preview_links').select('capture_id').eq('audit_id', audit.id).maybeSingle();
  if (error) return { status: 'unavailable', targetUrl: audit.normalizedUrl, failureCode: 'PREVIEW_DATABASE_UNAVAILABLE' };
  if (!link) return { status: 'unavailable', targetUrl: audit.normalizedUrl, failureCode: previewsConfigured() ? 'NO_CAPTURE' : 'PREVIEW_NOT_CONFIGURED' };
  const { data: capture, error: captureError } = await client.from('site_preview_captures')
    .select('id,generation,status,target_url,final_url,desktop_path,mobile_path,captured_at,fresh_until,expires_at,failure_code')
    .eq('id', link.capture_id).maybeSingle();
  if (captureError || !capture || capture.target_url !== audit.normalizedUrl) return { status: 'unavailable', targetUrl: audit.normalizedUrl, failureCode: 'CAPTURE_UNAVAILABLE' };
  const state: SitePreview = { status: capture.status as SitePreviewStatus, targetUrl: capture.target_url,
    finalUrl: capture.final_url, capturedAt: capture.captured_at, expiresAt: capture.expires_at,
    failureCode: capture.failure_code, stale: Boolean(capture.fresh_until && Date.parse(capture.fresh_until) <= Date.now()) };
  if (capture.expires_at && Date.parse(capture.expires_at) <= Date.now()) return { ...state, status: 'unavailable', failureCode: 'CAPTURE_EXPIRED' };
  const paths = [capture.desktop_path, capture.mobile_path];
  if (paths.every(path => typeof path === 'string' && path.startsWith(`${capture.id}/`) && /^[-a-f0-9]+\/\d+\/(desktop|mobile)\.webp$/.test(path))) {
    const { data, error: signingError } = await client.storage.from('audit-previews').createSignedUrls(paths, 300);
    if (!signingError && data?.[0]?.signedUrl && data?.[1]?.signedUrl) {
      state.desktop = { url: data[0].signedUrl, width: 1440, height: 900 };
      state.mobile = { url: data[1].signedUrl, width: 390, height: 844 };
    }
  }
  if (state.status === 'captured' && (!state.desktop || !state.mobile)) return { ...state, status: 'unavailable', failureCode: 'CAPTURE_MEDIA_UNAVAILABLE' };
  return state;
}
