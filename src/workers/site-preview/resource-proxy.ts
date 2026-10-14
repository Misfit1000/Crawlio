import { CAPTURE_POLICY, PreviewFailure, browserResponseHeaders, decodeBase64, publicResourceUrl } from '../../lib/preview/capture-policy';
import type { CaptureClaim, Runtime } from './contracts';
import { PreviewApi, readJsonLimited } from './io';

interface Resource { url: string; resourceType: string; viewport: 'desktop' | 'mobile' }
interface ServedResource { status: number; headers: Record<string, string>; body: Uint8Array }
interface Pending { request: Resource; resolve: (value: ServedResource) => void; reject: (error: unknown) => void }
const RESOURCE_TYPES = new Set(['document', 'stylesheet', 'image', 'font', 'script', 'xhr', 'fetch', 'manifest', 'other']);

export class ResourceProxy {
  private queue: Pending[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private active = 0;
  private resources = 0;
  private calls = 0;
  private decodedBytes = 0;
  failure?: PreviewFailure;
  readonly deniedOrigins: string[];

  constructor(private job: CaptureClaim, private api: PreviewApi, private runtime: Runtime, private signal: AbortSignal) {
    this.deniedOrigins = [new URL(api.config.supabaseUrl!).origin];
    signal.addEventListener('abort', () => this.stop(new PreviewFailure('CAPTURE_DEADLINE')), { once: true });
  }

  request(url: string, resourceType: string, viewport: 'desktop' | 'mobile'): Promise<ServedResource> {
    try {
      if (this.failure) throw this.failure;
      if (this.signal.aborted) throw new PreviewFailure('CAPTURE_DEADLINE');
      url = publicResourceUrl(url, this.deniedOrigins);
      if (!RESOURCE_TYPES.has(resourceType)) throw new PreviewFailure('RESOURCE_TYPE_BLOCKED', 'blocked');
      // Count documents too, leaving a conservative ceiling below 60 subresources.
      if (++this.resources > CAPTURE_POLICY.maxResources) throw new PreviewFailure('RESOURCE_COUNT_LIMIT', 'blocked');
      return new Promise((resolve, reject) => {
        this.queue.push({ request: { url, resourceType, viewport }, resolve, reject });
        this.schedule();
      });
    } catch (error) { return Promise.reject(error); }
  }

  stop(error = new PreviewFailure('CAPTURE_FINISHED')) {
    this.failure ??= error;
    if (this.timer) this.runtime.clearTimer(this.timer);
    this.timer = undefined;
    for (const pending of this.queue.splice(0)) pending.reject(this.failure);
  }

  private schedule() {
    if (this.timer || this.failure || !this.queue.length || this.active >= CAPTURE_POLICY.maxProxyConcurrency) return;
    this.timer = this.runtime.setTimer(() => { this.timer = undefined; this.pump(); }, 4);
  }

  private pump() {
    while (!this.failure && this.queue.length && this.active < CAPTURE_POLICY.maxProxyConcurrency) {
      const batch = this.queue.splice(0, CAPTURE_POLICY.maxBatchRequests);
      this.active++;
      void this.send(batch).catch(error => {
        const failure = error instanceof PreviewFailure ? error : new PreviewFailure('PROXY_UNAVAILABLE');
        for (const pending of batch) pending.reject(failure);
        this.stop(failure);
      }).finally(() => { this.active--; this.schedule(); });
    }
  }

  private async send(batch: Pending[]) {
    if (++this.calls > CAPTURE_POLICY.maxProxyCalls) throw new PreviewFailure('PROXY_CALL_LIMIT', 'blocked');
    this.api.budget.take(8);
    const response = await this.runtime.fetch(this.api.config.proxyUrl!, {
      method: 'POST', redirect: 'error', signal: AbortSignal.any([this.signal, AbortSignal.timeout(7000)]),
      headers: { authorization: `Bearer ${this.api.env.PREVIEW_CONTROL_SECRET!}`, 'content-type': 'application/json' },
      body: JSON.stringify({ captureId: this.job.id, generation: this.job.generation, requests: batch.map(item => item.request) }),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new PreviewFailure(response.status === 429 ? 'PROXY_QUOTA' : 'PROXY_UNAVAILABLE', response.status === 429 ? 'quota_exhausted' : 'unavailable');
    }
    const payload = await readJsonLimited(response, Math.ceil(CAPTURE_POLICY.maxBatchBytes / 3) * 4 + 128 * 1024);
    if (!payload || !Array.isArray(payload.results) || payload.results.length !== batch.length) throw new PreviewFailure('INVALID_PROXY_RESPONSE');
    let batchBytes = 0;
    const served = payload.results.map((item: any, index: number): ServedResource => {
      const request = batch[index].request;
      if (!item || item.url !== request.url || !Number.isInteger(item.status) || item.status < 200 || item.status > 599
        || !item.headers || typeof item.headers !== 'object' || Array.isArray(item.headers)) throw new PreviewFailure('INVALID_PROXY_RESPONSE');
      if (item.error) {
        const blocked = request.resourceType === 'document' || /blocked|unsafe|private|ssrf|robots|denied/i.test(String(item.error));
        throw new PreviewFailure(blocked ? 'RESOURCE_BLOCKED' : 'RESOURCE_UNAVAILABLE', blocked ? 'blocked' : 'unavailable');
      }
      const body = decodeBase64(item.bodyBase64, CAPTURE_POLICY.maxResourceBytes);
      batchBytes += body.byteLength;
      if (batchBytes > CAPTURE_POLICY.maxBatchBytes || this.decodedBytes + batchBytes > CAPTURE_POLICY.maxDecodedBytes) throw new PreviewFailure('RESOURCE_BYTE_LIMIT', 'blocked');
      if (/attachment/i.test(item.headers['content-disposition'] ?? item.headers['Content-Disposition'] ?? '')) throw new PreviewFailure('DOWNLOAD_BLOCKED', 'blocked');
      const headers = browserResponseHeaders(item.headers, request.resourceType === 'document', request.url, this.deniedOrigins);
      if (item.status >= 300 && item.status < 400 && item.status !== 304 && !headers.location) throw new PreviewFailure('INVALID_PROXY_REDIRECT');
      return { status: item.status, headers, body };
    });
    this.decodedBytes += batchBytes;
    if (this.failure || this.signal.aborted) throw this.failure ?? new PreviewFailure('CAPTURE_DEADLINE');
    served.forEach((value: ServedResource, index: number) => batch[index].resolve(value));
  }
}
