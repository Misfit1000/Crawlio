import { CAPTURE_POLICY, PreviewFailure, trustedHttpsUrl } from '../../lib/preview/capture-policy';
import type { CaptureClaim, CaptureResult, Fetch, PreviewEnv } from './contracts';

export function configuration(env: PreviewEnv) {
  const proxyUrl = trustedHttpsUrl(env.PREVIEW_PROXY_URL, CAPTURE_POLICY.proxyPath);
  const supabaseUrl = trustedHttpsUrl(env.SUPABASE_URL);
  const checks = {
    explicitlyEnabled: env.SITE_PREVIEW_ENABLED === 'true',
    browserBinding: typeof env.BROWSER?.fetch === 'function',
    coordinatorBinding: Boolean(env.SITE_PREVIEW_COORDINATOR),
    proxyUrl: Boolean(proxyUrl),
    controlSecret: Boolean(env.PREVIEW_CONTROL_SECRET && env.PREVIEW_CONTROL_SECRET.length >= 32 && !/[\r\n]/.test(env.PREVIEW_CONTROL_SECRET)),
    supabaseUrl: Boolean(supabaseUrl),
    supabaseServiceRole: Boolean(env.SUPABASE_SERVICE_ROLE_KEY && !/[\r\n]/.test(env.SUPABASE_SERVICE_ROLE_KEY)),
  };
  return { checks, ready: Object.values(checks).every(Boolean), proxyUrl, supabaseUrl };
}

export class SubrequestBudget {
  used = 0;
  take(reserve = 0) {
    if (this.used >= CAPTURE_POLICY.maxSubrequests - reserve) throw new PreviewFailure('WORKER_SUBREQUEST_LIMIT');
    this.used++;
  }
}

export async function readJsonLimited(response: Response, maxBytes: number): Promise<any> {
  if (!response.body) throw new PreviewFailure('INVALID_CONTROL_RESPONSE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) throw new PreviewFailure('CONTROL_RESPONSE_LIMIT');
      chunks.push(part.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const all = new Uint8Array(bytes);
  let at = 0;
  for (const chunk of chunks) { all.set(chunk, at); at += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(all)); } catch { throw new PreviewFailure('INVALID_CONTROL_RESPONSE'); }
}

export class PreviewApi {
  readonly config;
  constructor(readonly env: PreviewEnv, readonly fetch: Fetch, readonly budget: SubrequestBudget) {
    this.config = configuration(env);
    if (!this.config.ready) throw new PreviewFailure('NOT_CONFIGURED');
  }

  private async request(path: string, init: RequestInit = {}, signal?: AbortSignal) {
    this.budget.take();
    const response = await this.fetch(`${this.config.supabaseUrl}${path}`, {
      ...init,
      headers: {
        apikey: this.env.SUPABASE_SERVICE_ROLE_KEY!,
        authorization: `Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        'content-type': 'application/json',
        ...init.headers,
      },
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new PreviewFailure(response.status === 429 ? 'SUPABASE_RATE_LIMIT' : 'SUPABASE_UNAVAILABLE');
    }
    return response;
  }

  async rpc<T>(name: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const response = await this.request(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(body) }, signal);
    return readJsonLimited(response, 128 * 1024) as Promise<T>;
  }

  claim() { return this.rpc<CaptureClaim | null>('claim_site_preview', { p_worker: 'cloudflare-site-preview-global-v1' }); }
  complete(job: CaptureClaim, result: CaptureResult) {
    return this.rpc<boolean>('complete_site_preview', { p_id: job.id, p_generation: job.generation, p_result: result });
  }

  async currentArtifacts(id: string): Promise<{ desktop_path?: string; mobile_path?: string } | null> {
    const response = await this.request(`/rest/v1/site_preview_captures?id=eq.${encodeURIComponent(id)}&select=desktop_path,mobile_path&limit=1`);
    const data = await readJsonLimited(response, 16 * 1024);
    if (!Array.isArray(data) || data.length > 1) throw new PreviewFailure('INVALID_CONTROL_RESPONSE');
    return data[0] ?? null;
  }

  async upload(path: string, bytes: Uint8Array, signal: AbortSignal) {
    const response = await this.request(`/storage/v1/object/${CAPTURE_POLICY.bucket}/${path}`, {
      method: 'POST', headers: { 'content-type': 'image/webp', 'x-upsert': 'false', 'cache-control': 'private, max-age=0' }, body: bytes as BodyInit,
    }, signal);
    await response.body?.cancel();
  }

  async remove(paths: string[]) {
    if (!paths.length) return;
    const response = await this.request(`/storage/v1/object/${CAPTURE_POLICY.bucket}`, {
      method: 'DELETE', body: JSON.stringify({ prefixes: [...new Set(paths)] }),
    });
    await response.body?.cancel();
  }
}
