import { timingSafeEqual } from 'node:crypto';

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

export async function wakeConfiguredWorkers(fetcher: typeof fetch = fetch): Promise<void> {
  const configs = [
    { kind: 'render' as const, url: process.env.AUDIT_WORKER_WAKE_URL, secret: process.env.AUDIT_WORKER_CONTROL_SECRET },
    { kind: 'cloudflare' as const, url: process.env.SECONDARY_AUDIT_WORKER_URL, secret: process.env.SECONDARY_AUDIT_CONTROL_SECRET },
  ];
  await Promise.all(configs.map(async config => {
    const url = allowedWorkerControlUrl(config.url, config.kind);
    if (!url || !config.secret || config.secret.length < 32) return;
    if (pending.has(url)) return pending.get(url);
    if (Date.now() - (lastAttempt.get(url) || 0) < 2_000) return;
    lastAttempt.set(url, Date.now());
    const operation = (async () => {
      try {
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
