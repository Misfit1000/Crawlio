import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test, type TestContext } from 'node:test';
import { maintainScalableWorker } from './scalable-audit-worker';
import {
  cleanupScalableExportsOnce, createScalableExportMaintenance, processExportChunk, runScalableExportWorkerOnce,
  EXPORT_POLL_INTERVAL_MS, EXPORT_CLEANUP_INTERVAL_MS,
} from './scalable-export-worker';
import type { ExportJob } from '../lib/report/scalable-exports';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function setup(context: TestContext) {
  const saved = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].map(key => [key, process.env[key]] as const);
  process.env.SUPABASE_URL = 'https://maintenance-fixture.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only';
  context.after(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json' },
});
const job: ExportJob = {
  id: 'export-fixture', audit_id: 'audit', format: 'pages.csv', state: 'running', owner: 'owner',
  lease_until: '2099-01-01T00:00:00Z', expires_at: '2099-01-02T00:00:00Z', created_at: '2026-10-03T00:00:00Z',
  cursor: null, section: 'pages', part: 0, object_prefix: '00000000-0000-0000-0000-000000000001', error: null,
};

test('idle maintenance reduces empty polling and cleanup without changing audit admission ticks', async context => {
  let now = 0, exports = 0, cleanups = 0, admissions = 0;
  const maintenance = createScalableExportMaintenance('worker', () => true, {
    now: () => now,
    runExport: async () => { exports++; return false; },
    cleanup: async () => { cleanups++; return 0; },
  });
  for (now = 0; now < 300_000; now += 4_000) {
    admissions++;
    await maintenance.tick();
  }
  assert.deepEqual({ admissions, exports, cleanups }, { admissions: 75, exports: 19, cleanups: 1 });
  context.diagnostic('Controlled 5-minute idle window: admission 75 -> 75, empty export reads 75 -> 19, cleanup scans 5 -> 1; 0 writes.');
  now = EXPORT_CLEANUP_INTERVAL_MS;
  await maintenance.tick();
  assert.equal(cleanups, 2);
});

test('maintenance is single-flight, serializes export and cleanup, and yields to audit admission', async () => {
  let idle = true, now = 0, exports = 0, cleanups = 0;
  const entered = deferred(), release = deferred();
  const maintenance = createScalableExportMaintenance('worker', () => idle, {
    now: () => now,
    runExport: async (_worker, canRun) => {
      exports++;
      entered.resolve();
      await release.promise;
      assert.equal(canRun(), false);
      return true;
    },
    cleanup: async () => { cleanups++; return 0; },
  });
  const first = maintenance.tick();
  await entered.promise;
  assert.equal(maintenance.tick(), first);
  idle = false;
  now = EXPORT_POLL_INTERVAL_MS * 2;
  release.resolve();
  await first;
  await maintenance.tick();
  assert.deepEqual({ exports, cleanups }, { exports: 1, cleanups: 0 });
});

test('failed maintenance attempts observe cadence and do not create a rapid retry loop', async () => {
  let now = 0, calls = 0;
  const maintenance = createScalableExportMaintenance('worker', () => true, {
    now: () => now,
    runExport: async () => { calls++; throw new Error('unavailable'); },
    cleanup: async () => 0,
  });
  await assert.rejects(maintenance.tick(), /unavailable/);
  now = 4_000;
  await maintenance.tick();
  assert.equal(calls, 1);
  now = EXPORT_POLL_INTERVAL_MS;
  await assert.rejects(maintenance.tick(), /unavailable/);
  assert.equal(calls, 2);
});

test('registration shares one in-flight write and keeps a per-worker 30-second attempt cadence', async context => {
  setup(context);
  let now = 0, writes = 0, fail = false;
  context.mock.method(Date, 'now', () => now);
  const entered = deferred(), release = deferred();
  context.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(url.hostname, 'maintenance-fixture.supabase.co');
    assert.equal(url.pathname, '/rest/v1/audit_scalable_workers');
    assert.equal(request.method, 'POST');
    writes++;
    entered.resolve();
    await release.promise;
    return fail ? json({ message: 'database unavailable' }, 503) : new Response(null, { status: 201 });
  });
  const first = maintainScalableWorker('registration-concurrent');
  await entered.promise;
  now = 60_000;
  assert.equal(maintainScalableWorker('registration-concurrent'), first);
  assert.equal(writes, 1);
  release.resolve();
  await first;
  await maintainScalableWorker('registration-concurrent');
  assert.equal(writes, 1, 'slow writes retain a full cooldown after completion');
  now += 30_000;
  await maintainScalableWorker('registration-concurrent');
  assert.equal(writes, 2);
  await maintainScalableWorker('registration-concurrent');
  assert.equal(writes, 2);
  await maintainScalableWorker('registration-other');
  assert.equal(writes, 3, 'a second worker must not inherit the first worker cooldown');
  now += 30_000;
  fail = true;
  await assert.rejects(maintainScalableWorker('registration-concurrent'), /unavailable/);
  const failedWrites = writes;
  now += 4_000;
  await maintainScalableWorker('registration-concurrent');
  assert.equal(writes, failedWrites, 'failed registration must not write again on every audit slice');
});

test('an audit admitted during evidence reading prevents export upload and progress writes', async () => {
  let idle = true, uploads = 0, commits = 0, checks = 0;
  await assert.rejects(processExportChunk(job, {
    shouldContinue: () => idle,
    check: async () => { checks++; },
    header: async () => '',
    read: async () => { idle = false; return { items: [], nextCursor: null }; },
    upload: async () => { uploads++; }, commit: async () => { commits++; },
  }), /EXPORT_MAINTENANCE_YIELDED/);
  assert.deepEqual({ checks, uploads, commits }, { checks: 1, uploads: 0, commits: 0 });
});

test('yield after an immutable upload preserves the checkpoint for the next lease', async () => {
  let idle = true, uploads = 0, commits = 0;
  await assert.rejects(processExportChunk(job, {
    shouldContinue: () => idle, check: async () => {}, header: async () => '',
    read: async () => ({ items: [], nextCursor: null }),
    upload: async () => { uploads++; idle = false; }, commit: async () => { commits++; },
  }), /EXPORT_MAINTENANCE_YIELDED/);
  assert.deepEqual({ uploads, commits }, { uploads: 1, commits: 0 });
  assert.equal(job.part, 0);
});

test('export yield does not write errors or release a checkpoint during active audit work', async context => {
  setup(context);
  let idle = true;
  const requests: string[] = [];
  context.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(url.hostname, 'maintenance-fixture.supabase.co');
    requests.push(`${request.method} ${url.pathname}`);
    if (request.method === 'PATCH') return json(job);
    if (url.pathname.endsWith('/audit_export_jobs')) {
      return json(url.searchParams.get('select') === 'id' ? { id: job.id } : [{ ...job, state: 'queued', lease_until: null }]);
    }
    assert.equal(url.pathname, '/rest/v1/audit_pages');
    idle = false;
    return json([]);
  });
  assert.equal(await runScalableExportWorkerOnce('worker', () => idle), true);
  assert.equal(requests.filter(item => item.startsWith('PATCH')).length, 1, 'only the existing claim write is allowed');
  assert.equal(requests.length, 4);
});

test('cleanup does no work when busy and stops before storage removal if an audit starts', async context => {
  setup(context);
  let idle = false, requests = 0;
  context.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(url.hostname, 'maintenance-fixture.supabase.co');
    requests++;
    if (url.pathname.endsWith('/audit_export_jobs')) return json(request.method === 'PATCH' ? { id: job.id } : [{ ...job, lease_until: null }]);
    assert.equal(url.pathname, '/storage/v1/object/list/audit-exports');
    idle = false;
    return json([{ name: '000000.part' }]);
  });
  assert.equal(await cleanupScalableExportsOnce(() => idle), 0);
  assert.equal(requests, 0);
  idle = true;
  assert.equal(await cleanupScalableExportsOnce(() => idle), 0);
  assert.equal(requests, 3, 'no storage delete or follow-up database write after audit admission');
});

test('main worker retains admission polling and never waits for background export maintenance', async () => {
  const source = await readFile(new URL('./audit-worker.ts', import.meta.url), 'utf8');
  assert.match(source, /auditAdmissionIdle = false;\s*const claimed = await runOneAudit/);
  assert.match(source, /if \(!claimed\) \{\s*auditAdmissionIdle = true;\s*await wait\(config.pollIntervalMs\)/);
  assert.match(source, /exportTask = maintenance.tick\(\)/);
  const pollingLoop = source.slice(source.indexOf('while (!shutdownRequested)'));
  assert.doesNotMatch(pollingLoop.slice(0, pollingLoop.indexOf('clearInterval(heartbeatTimer)')), /await exportTask|await maintenance/);
});
