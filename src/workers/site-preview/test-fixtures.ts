import assert from 'node:assert/strict';
import type { BrowserContext, BrowserPage, BrowserRoute, CaptureBrowser, CaptureClaim, DurableState, PreviewEnv, Runtime } from './contracts';
import { CAPTURE_POLICY } from '../../lib/preview/capture-policy';

export const JOB: CaptureClaim = { id: '00000000-0000-4000-8000-000000000001', target_url: 'https://target.example.com/', generation: 2 };
export const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
export const flush = () => new Promise<void>(resolve => setImmediate(resolve));
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
export function mockWebp(width: number, height: number, length = 30): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  new DataView(bytes.buffer).setUint32(4, length - 8, true);
  bytes.set(new TextEncoder().encode('WEBPVP8X'), 8);
  new DataView(bytes.buffer).setUint32(16, 10, true);
  for (let at = 0; at < 3; at++) {
    bytes[24 + at] = ((width - 1) >> (8 * at)) & 255;
    bytes[27 + at] = ((height - 1) >> (8 * at)) & 255;
  }
  return bytes;
}

export class ManualClock {
  time = 1_000_000;
  private nextId = 0;
  private timers = new Map<number, { at: number; callback: () => void }>();
  now = () => this.time;
  setTimer = (callback: () => void, ms: number) => {
    const id = ++this.nextId;
    this.timers.set(id, { at: this.time + ms, callback });
    return id as unknown as ReturnType<typeof setTimeout>;
  };
  clearTimer = (id: ReturnType<typeof setTimeout>) => { this.timers.delete(id as unknown as number); };
  async advance(ms: number) {
    const target = this.time + ms;
    for (;;) {
      await flush();
      const next = [...this.timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.time = next[1].at;
      this.timers.delete(next[0]);
      next[1].callback();
    }
    this.time = target;
    await flush();
  }
}

export class MemoryState implements DurableState {
  data = new Map<string, unknown>();
  alarmAt: number | null = null;
  waits: Promise<unknown>[] = [];
  storage = {
    get: async <T>(key: string) => this.data.get(key) as T | undefined,
    put: async <T>(key: string, value: T) => { this.data.set(key, value); },
    delete: async (key: string) => this.data.delete(key),
    getAlarm: async () => this.alarmAt,
    setAlarm: async (time: number) => { this.alarmAt = time; },
  };
  waitUntil(promise: Promise<unknown>) { this.waits.push(promise); }
}

interface ContextRecord {
  options: Record<string, any>;
  route?: (route: BrowserRoute) => Promise<void>;
  websocket?: (socket: { close(): Promise<void> }) => Promise<void>;
  scripts: string[];
  contextEvents: Map<string, (...args: any[]) => void>;
  pageEvents: Map<string, (...args: any[]) => void>;
  page?: BrowserPage;
  commands: Array<{ method: string; params?: Record<string, any> }>;
}

export class Fixture {
  calls: Array<{ url: URL; init: RequestInit; body: any }> = [];
  contexts: ContextRecord[] = [];
  launches = 0;
  closes = 0;
  nativeRequests = 0;
  directRouteCalls = 0;
  missingWebSocketGuard = false;
  extraRequests: Array<{ url: string; type: string; method?: string }> = [];
  gotoGate?: Promise<void>;
  closeGate?: Promise<void>;
  launchGate?: Promise<CaptureBrowser>;
  launchError?: unknown;
  screenshotSize: (quality: number) => number = () => 30;
  job: CaptureClaim | null = { ...JOB };
  complete: unknown = true;
  current: unknown[] = [];
  cleanup: unknown[] = [];
  deleteFails = false;
  completeFails = false;
  proxy: (body: any) => Promise<Response> = async body => jsonResponse({
    results: body.requests.map((request: any) => ({ url: request.url, status: 200,
      headers: { 'content-type': request.resourceType === 'document' ? 'text/html' : 'image/png' }, bodyBase64: btoa('<html>public</html>') })),
  });
  env: PreviewEnv = {
    SITE_PREVIEW_ENABLED: 'true', PREVIEW_PROXY_URL: `https://control.example.com${CAPTURE_POLICY.proxyPath}`,
    PREVIEW_CONTROL_SECRET: 'control-only-secret-at-least-thirty-two-characters',
    SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role-fixture-only',
    BROWSER: { fetch: async () => jsonResponse({}) },
    SITE_PREVIEW_COORDINATOR: { idFromName: name => name, get: () => ({ fetch: async () => jsonResponse({}) }) },
  };

  fetch: Runtime['fetch'] = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    this.calls.push({ url, init, body });
    if (url.origin === 'https://control.example.com') return this.proxy(body);
    assert.equal(url.origin, this.env.SUPABASE_URL, 'worker fetch must never contact the target');
    if (url.pathname.endsWith('/claim_site_preview')) return jsonResponse(this.job);
    if (url.pathname.endsWith('/complete_site_preview')) {
      if (this.completeFails) throw new Error('outage');
      return jsonResponse(this.complete);
    }
    if (url.pathname.endsWith('/preview_storage_cleanup')) return jsonResponse(this.cleanup);
    if (url.pathname.endsWith('/finish_preview_cleanup')) return jsonResponse(true);
    if (url.pathname === '/rest/v1/site_preview_captures') return jsonResponse(this.current);
    if (init.method === 'DELETE') return jsonResponse({}, this.deleteFails ? 503 : 200);
    if (init.method === 'POST' && url.pathname.includes('/storage/v1/object/')) {
      assert.equal(new Headers(init.headers).get('x-upsert'), 'false');
      assert.equal(new Headers(init.headers).get('content-type'), 'image/webp');
      return jsonResponse({});
    }
    throw new Error(`Unexpected fixture endpoint: ${url.pathname}`);
  };

  browser: CaptureBrowser = {
    close: async () => { this.closes++; await this.closeGate; },
    newContext: async options => {
      const record: ContextRecord = { options, scripts: [], contextEvents: new Map(), pageEvents: new Map(), commands: [] };
      this.contexts.push(record);
      let currentUrl = 'about:blank';
      const page: BrowserPage = {
        close: async () => {},
        url: () => currentUrl,
        on: (name, handler) => { record.pageEvents.set(name, handler); },
        evaluate: async () => {},
        goto: async (url, _options) => {
          await this.gotoGate;
          assert.ok(record.websocket && record.scripts.length, 'install guards before navigation');
          if (!record.route) { this.nativeRequests++; throw new Error('Native navigation prohibited'); }
          const request = async (resourceUrl: string, type: string, method = 'GET') => {
            let fulfilled: any, aborted = false;
            await record.route!({
              request: () => ({ url: () => resourceUrl, method: () => method, resourceType: () => type,
                isNavigationRequest: () => type === 'document', frame: () => ({ page: () => page }),
                headers: () => ({ cookie: 'audit-session=secret', authorization: 'Bearer audit-credential' }),
              }),
              abort: async () => { aborted = true; },
              fulfill: async value => { fulfilled = value; },
              continue: async () => { this.directRouteCalls++; throw new Error('Direct network'); },
              fetch: async () => { this.directRouteCalls++; throw new Error('Direct network'); },
            } as BrowserRoute);
            if (aborted || !fulfilled) {
              if (type === 'document') throw new Error('net::ERR_BLOCKED_BY_CLIENT');
              return null;
            }
            return fulfilled;
          };
          let response: any;
          for (let redirects = 0; redirects < 5; redirects++) {
            response = await request(url, 'document');
            if (response.status >= 300 && response.status < 400 && response.headers.location) url = response.headers.location;
            else break;
          }
          currentUrl = url;
          await Promise.all(this.extraRequests.map(extra => request(extra.url, extra.type, extra.method)));
          return { status: () => response.status };
        },
      };
      record.page = page;
      return {
        on: (name, handler) => { record.contextEvents.set(name, handler); },
        route: async (_pattern, handler) => { record.route = handler; },
        routeWebSocket: this.missingWebSocketGuard ? undefined : async (_pattern, handler) => { record.websocket = handler; },
        addInitScript: async ({ content }) => { record.scripts.push(content); },
        newPage: async () => { record.contextEvents.get('page')?.(page); return page; },
        newCDPSession: async () => ({
          send: async (method, params) => {
            record.commands.push({ method, params });
            if (method !== 'Page.captureScreenshot') return {};
            const { width, height } = options.viewport as { width: number; height: number };
            return { data: Buffer.from(mockWebp(width, height, this.screenshotSize(params!.quality as number))).toString('base64') };
          },
          detach: async () => {},
        }),
      } as BrowserContext;
    },
  };

  runtime(clock?: ManualClock): Runtime {
    return {
      fetch: this.fetch,
      launch: async (_binding, options) => {
        this.launches++;
        assert.deepEqual(options, { guardrails: { allowedDomains: [] } });
        if (this.launchError) throw this.launchError;
        return this.launchGate ?? this.browser;
      },
      now: clock?.now ?? (() => Date.now()),
      setTimer: clock?.setTimer ?? ((callback, ms) => setTimeout(callback, ms)),
      clearTimer: clock?.clearTimer ?? (timer => clearTimeout(timer)),
    };
  }
}
