import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

test('authenticated live subscriptions initialize access and reconcile final evidence', async context => {
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const savedDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const hooks = registerHooks({
    load(url, options, nextLoad) {
      if (/\/supabase\/client\.ts$/.test(url)) return { format: 'module', shortCircuit: true, source: 'export const getSupabaseBrowserClient = () => globalThis.__liveStartupFixture.client;' };
      if (/\/http\/safe-json\.ts$/.test(url)) return { format: 'module', shortCircuit: true, source: 'export const safeJsonFetch = (...args) => globalThis.__liveStartupFixture.read(...args);' };
      if (/\/api\/auth-headers\.ts$/.test(url)) return { format: 'module', shortCircuit: true, source: 'export const getAuditAccessHeaders = async () => ({ Authorization: "fixture-only" });' };
      return nextLoad(url, options);
    },
  });
  context.after(() => {
    hooks.deregister();
    for (const [key, descriptor] of [['window', savedWindow], ['document', savedDocument]] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    Reflect.deleteProperty(globalThis, '__liveStartupFixture');
  });
  const { subscribeToAuditLiveData } = await import('./live-supabase-client');
  const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };

  function fixture() {
    const calls: string[] = [];
    const timers = new Map<number, () => void>();
    const listeners = new Map<string, () => void>();
    let nextTimer = 0;
    let sessionResolve!: (value: any) => void;
    let subscribed!: (status: string) => void;
    const handlers = new Map<string, (payload: any) => void>();
    const replies: any[] = [];
    const channel = {
      on(_type: string, input: { table: string }, handler: (payload: any) => void) { handlers.set(input.table, handler); return channel; },
      subscribe(handler: (status: string) => void) { calls.push('subscribe'); subscribed = handler; return channel; },
    };
    const client = {
      auth: { getSession: () => { calls.push('session'); return new Promise(resolve => { sessionResolve = resolve; }); } },
      realtime: { setAuth: async (token: string) => { assert.equal(token, 'fixture-token'); calls.push('authenticate'); } },
      channel: () => channel,
      removeChannel: () => { calls.push('remove'); },
    };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      requestAnimationFrame: (callback: () => void) => { const id = ++nextTimer; queueMicrotask(callback); return id; },
      cancelAnimationFrame: () => {},
      setTimeout: (callback: () => void) => { const id = ++nextTimer; timers.set(id, callback); return id; },
      clearTimeout: (id: number) => timers.delete(id),
    } });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: {
      hidden: false,
      addEventListener: (name: string, handler: () => void) => listeners.set(name, handler),
      removeEventListener: (name: string) => listeners.delete(name),
    } });
    (globalThis as any).__liveStartupFixture = { client, read: async () => {
      calls.push('read');
      assert.ok(replies.length, 'No unexpected status request is permitted.');
      return replies.shift();
    } };
    const audit = { id: 'fixture-audit', userId: 'fixture-owner', status: 'running', updatedAt: '2026-10-03T00:00:00Z', pagesCrawled: 1, issuesFound: 2 };
    const snapshot = { audit, latestEvents: [], latestPages: [], latestIssues: [], finalReport: null } as any;
    return { calls, timers, listeners, handlers, replies, snapshot,
      resolveSession: (session: any = { access_token: 'fixture-token' }) => sessionResolve({ data: { session }, error: null }),
      connected: () => subscribed('SUBSCRIBED'),
      fireTimer: () => { const entry = timers.entries().next().value; assert.ok(entry); timers.delete(entry[0]); entry[1](); },
    };
  }

  await context.test('joins only after current session authentication and cancels pending startup', async () => {
    const f = fixture();
    const stop = subscribeToAuditLiveData('fixture-audit', () => {}, undefined, undefined, f.snapshot);
    assert.deepEqual(f.calls, ['session']);
    stop(); f.resolveSession(); await settle();
    assert.deepEqual(f.calls, ['session', 'remove']);
    assert.equal(f.listeners.size, 0);
  });
  await context.test('final score received during setup reconciles the terminal row without periodic polling', async () => {
    const f = fixture();
    const received: any[] = [];
    const stop = subscribeToAuditLiveData('fixture-audit', value => received.push(value), undefined, undefined, f.snapshot);
    f.resolveSession(); await settle();
    assert.deepEqual(f.calls, ['session', 'authenticate', 'subscribe']);
    f.replies.push({ success: true, data: { ...f.snapshot, latestEvents: [{ id: 'final-score', type: 'score_updated', data: { scoreState: 'final' } }] } });
    f.connected(); await settle();
    assert.equal(f.calls.filter(call => call === 'read').length, 1);
    assert.equal(f.timers.size, 1);
    f.replies.push({ success: true, data: { ...f.snapshot, audit: { ...f.snapshot.audit, status: 'completed' }, finalReport: { scores: { overall: 72 } } } });
    f.fireTimer(); await settle();
    assert.equal(received.at(-1).audit.status, 'completed');
    assert.equal(received.at(-1).finalReport.scores.overall, 72);
    assert.equal(f.timers.size, 0);
    f.handlers.get('audits')!({ new: { id: 'fixture-audit', status: 'running' } });
    assert.equal(received.at(-1).audit.status, 'completed', 'Delayed active rows cannot restore an active audit.');
    stop();
  });
  await context.test('ordinary preliminary evidence adds no reconciliation timer', async () => {
    const f = fixture();
    const stop = subscribeToAuditLiveData('fixture-audit', () => {}, undefined, undefined, f.snapshot);
    f.resolveSession(); await settle();
    f.replies.push({ success: true, data: f.snapshot });
    f.connected(); await settle();
    f.handlers.get('audit_events')!({ new: { id: 'page-score', type: 'score_updated', data: { scoreState: 'provisional' } } });
    assert.equal(f.timers.size, 0);
    assert.equal(f.calls.filter(call => call === 'read').length, 1);
    stop();
  });
  await context.test('permanent access errors close the channel without retries', async () => {
    const f = fixture();
    const stop = subscribeToAuditLiveData('fixture-audit', () => {}, () => {}, undefined, f.snapshot);
    f.resolveSession(); await settle();
    f.replies.push({ success: false, status: 403, error: 'Access denied' });
    f.connected(); await settle();
    assert.ok(f.calls.includes('remove'));
    assert.equal(f.timers.size, 0);
    stop();
  });
});
