import { timingSafeEqual } from 'node:crypto';
import { API_SCHEMA_VERSION, AUDIT_ENGINE_VERSION, CHECK_REGISTRY_VERSION, SCORING_VERSION } from '../platform/version';

export function validControlBearer(header: string | undefined, secret: string | undefined): boolean {
  if (!secret || secret.length < 32 || !header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function allowedWorkerControlUrl(value: string | undefined, kind: 'render' | 'cloudflare' | 'preview'): string | null {
  try {
    const url = new URL(value || '');
    const path = kind === 'render' ? '/control/wake' : '/control/wake';
    const hostAllowed = kind === 'render' ? url.hostname === 'seointel-audit-worker.onrender.com'
      : /^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname);
    if (!hostAllowed || url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
      || (url.pathname !== '/' && url.pathname !== path)) return null;
    url.pathname = path;
    return url.toString();
  } catch { return null; }
}

const pending = new Map<string, Promise<void>>();
const lastAttempt = new Map<string, number>();
const secondaryCapabilities = new Map<string, { at: number; compatible: boolean }>();

export function compatibleSecondaryCapability(value: unknown): boolean {
  const item = value as Record<string, unknown> | null;
  return Boolean(item && item.service === 'crawlio-secondary-audit' && item.executorType === 'cloudflare'
    && item.status === 'configured' && item.queueConsumer === true && item.apiSchemaVersion === API_SCHEMA_VERSION
    && item.processingVersion === 2 && item.auditScopeVersion === 1 && item.auditEngineVersion === AUDIT_ENGINE_VERSION
    && item.scoringVersion === SCORING_VERSION && item.checkRegistryVersion === CHECK_REGISTRY_VERSION);
}

export async function verifySecondaryWakeCapability(url: string, fetcher: typeof fetch): Promise<boolean> {
  const cached = secondaryCapabilities.get(url);
  if (cached && Date.now() - cached.at < 60_000) return cached.compatible;
  const response = await fetcher(new URL('/capability', url), { redirect: 'error', signal: AbortSignal.timeout(2_000) });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) { await response.body?.cancel(); return false; }
  if (Number(response.headers.get('content-length') || 0) > 16_384) { await response.body?.cancel(); return false; }
  const reader = response.body?.getReader();
  if (!reader) return false;
  const decoder = new TextDecoder();
  let text = '', bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16_384) { await reader.cancel(); return false; }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  const compatible = compatibleSecondaryCapability(JSON.parse(text));
  if (secondaryCapabilities.size > 10) secondaryCapabilities.clear();
  secondaryCapabilities.set(url, { at: Date.now(), compatible });
  return compatible;
}

export async function wakeConfiguredWorkers(fetcher: typeof fetch = fetch): Promise<void> {
  const configs = [
    { kind: 'render' as const, url: process.env.AUDIT_WORKER_WAKE_URL, secret: process.env.AUDIT_WORKER_CONTROL_SECRET },
    { kind: 'cloudflare' as const, url: process.env.SECONDARY_AUDIT_WORKER_URL, secret: process.env.SECONDARY_AUDIT_CONTROL_SECRET },
  ];
  await Promise.all(configs.map(async config => {
    const url = allowedWorkerControlUrl(config.url, config.kind);
    if (!url || !config.secret || config.secret.length < 32) return;
    if (pending.has(url)) return pending.get(url);
    const elapsed = Date.now() - (lastAttempt.get(url) || 0);
    if (elapsed >= 0 && elapsed < 2_000) return;
    lastAttempt.set(url, Date.now());
    const operation = (async () => {
      try {
        if (config.kind === 'cloudflare' && !await verifySecondaryWakeCapability(url, fetcher)) {
          console.warn(JSON.stringify({ event: 'audit_worker_wake_incompatible', executor: config.kind }));
          return;
        }
        const response = await fetcher(url, { method: 'POST', redirect: 'error',
          headers: { authorization: `Bearer ${config.secret}` }, signal: AbortSignal.timeout(3_000) });
        await response.body?.cancel();
        if (!response.ok) console.warn(JSON.stringify({ event: 'audit_worker_wake_failed', executor: config.kind, status: response.status }));
      } catch { console.warn(JSON.stringify({ event: 'audit_worker_wake_unconfirmed', executor: config.kind })); }
    })().finally(() => pending.delete(url));
    pending.set(url, operation);
    return operation;
  }));
}

export function createInterruptibleIdleWait() {
  let release: (() => void) | undefined;
  let signalled = false;
  return {
    wake() { signalled = true; release?.(); },
    wait(milliseconds: number) {
      if (signalled) { signalled = false; return Promise.resolve(); }
      return new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); release = undefined; signalled = false; resolve(); };
        const timer = setTimeout(finish, milliseconds);
        release = finish;
      });
    },
  };
}
