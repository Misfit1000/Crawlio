import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';
import express from 'express';
import { ApiError } from '../../lib/api/errors';
import { safeAdminAction } from '../../lib/operations/admin-presentation';
import { adminReason, adminRequestId, createAdminOperationsRouter, operationRpc } from './operations-routes';
import { createAdminReadRouter } from './read-routes';

const actorId = randomUUID();
const healthUrl = 'https://seointel-audit-worker.onrender.com/health';
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

async function fixture(context: TestContext, run: (state: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  async function setup() {
    const saved = Object.fromEntries(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PRODUCTION_WORKER_HEALTH_URL'].map(key => [key, process.env[key]]));
    process.env.SUPABASE_URL = 'https://admin-routes-test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-service-role-key';
    process.env.PRODUCTION_WORKER_HEALTH_URL = healthUrl;
    const state = { events: [] as string[], requests: [] as URL[], rpcs: [] as Array<{ name: string; args: Record<string, unknown> }>,
      actions: new Map<string, Record<string, any>>(), failInsert: false, failUpdate: false, healthStatus: 200, healthThrows: false, guardCode: '' };
    const nativeFetch = globalThis.fetch;
    context.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === '127.0.0.1') return nativeFetch(input, init);
      state.requests.push(url);
      if (url.href === healthUrl) {
        state.events.push('health');
        assert.equal(init?.redirect, 'error');
        assert.ok(init?.signal);
        if (state.healthThrows) throw new Error('fixture timeout');
        return json({}, state.healthStatus);
      }
      assert.equal(url.hostname, 'admin-routes-test.supabase.co');
      const request = new Request(input, init);
      const body = request.method === 'GET' ? null : JSON.parse(await request.text());
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const name = url.pathname.split('/').at(-1)!;
        if (name === 'consume_api_rate_limit') return json({ allowed: true });
        state.rpcs.push({ name, args: body });
        if (state.guardCode) return json({ code: 'P0001', message: state.guardCode }, 400);
        return json({ outcome: name === 'admin_retention_apply' ? 'applied' : 'recorded' });
      }
      assert.equal(url.pathname, '/rest/v1/admin_actions');
      if (request.method === 'POST') {
        state.events.push('insert');
        if (state.failInsert) return json({ code: 'XX000', message: 'fixture insert failure' }, 500);
        if (state.actions.has(body.request_id)) return json({ code: '23505', message: 'unique request' }, 409);
        const row = { id: randomUUID(), created_at: new Date().toISOString(), ...body };
        state.actions.set(body.request_id, row);
        return json({ id: row.id }, 201);
      }
      if (request.method === 'PATCH') {
        state.events.push('update');
        if (state.failUpdate) return json({ code: 'XX000', message: 'fixture update failure' }, 500);
        const row = state.actions.get(url.searchParams.get('request_id')!.slice(3))!;
        assert.equal(url.searchParams.get('id'), `eq.${row.id}`);
        assert.equal(url.searchParams.get('admin_user_id'), `eq.${actorId}`);
        Object.assign(row, body);
        return json({ id: row.id });
      }
      const requestId = url.searchParams.get('request_id')?.slice(3);
      const rows = requestId ? [state.actions.get(requestId)].filter(Boolean) : Array.from(state.actions.values());
      const select = url.searchParams.get('select')!.split(',');
      const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 50);
      return json(rows.slice(offset, offset + limit).map(row => Object.fromEntries(select.map(key => [key, row![key]]))));
    });
    const app = express();
    app.use(express.json());
    const guard = async (req: express.Request, res: express.Response) => {
      if (req.get('authorization') !== 'Bearer admin') { res.status(403).json({ success: false }); return null; }
      return { userId: actorId };
    };
    app.use('/admin', createAdminOperationsRouter(guard));
    app.use('/read', createAdminReadRouter(guard));
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(error instanceof ApiError ? error.status : 500).json({ success: false, code: error instanceof ApiError ? error.code : 'INTERNAL' });
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { ...state, state, base, saved, server,
      post: (path: string, body: unknown) => fetch(`${base}/admin/${path}`, { method: 'POST', headers: { authorization: 'Bearer admin', 'content-type': 'application/json' }, body: JSON.stringify(body) }) };
  }
  const value = await setup();
  try { await run(value); } finally {
    await new Promise<void>((resolve, reject) => value.server.close(error => error ? reject(error) : resolve()));
    for (const [key, old] of Object.entries(value.saved)) {
      if (old === undefined) delete process.env[key]; else process.env[key] = old;
    }
  }
}

test('reason and request IDs reject coercion and align with SQL028 reason bounds', () => {
  const req = (body: unknown) => ({ body } as express.Request);
  assert.equal(adminReason(req({ reason: '  Approved support review  ' })), 'Approved support review');
  assert.equal(adminReason(req({ reason: 'x'.repeat(500) })).length, 500);
  for (const reason of [undefined, null, 1234, ['review'], {}, '', '   ', 'abc', 'x'.repeat(501)]) {
    assert.throws(() => adminReason(req({ reason })), (error: ApiError) => error.code === 'ADMIN_REASON_REQUIRED');
  }
  const requestId = randomUUID();
  assert.equal(adminRequestId(req({ requestId })), requestId);
  assert.match(adminRequestId(req({})), /^[0-9a-f-]{36}$/);
  for (const requestId of [null, '', 0, false, ['invalid'], {}, 'not-a-uuid']) {
    assert.throws(() => adminRequestId(req({ requestId })), (error: ApiError) => error.code === 'INVALID_ADMIN_REQUEST_ID');
  }
});

test('authorized mutations propagate context, including retention request IDs and replay conflicts', async context => fixture(context, async f => {
  const id = randomUUID(), reason = 'Approved support review';
  const paths = [`audits/${id}/action`, `users/${id}/update`, `users/${id}/reset-quota`, 'workers/wake', 'retention/apply'];
  for (const path of paths) {
    assert.equal((await f.post(path, { reason: ['not valid'], requestId: randomUUID() })).status, 400);
  }
  assert.equal(f.rpcs.length, 0);
  assert.equal(f.events.length, 0);
  for (const [path, rpc, extra] of [
    [`audits/${id}/action`, 'admin_audit_operation', { action: 'cancel' }],
    [`users/${id}/update`, 'admin_update_account', { patch: { plan: 'paid' } }],
    [`users/${id}/reset-quota`, 'admin_update_account', {}],
  ] as const) {
    const requestId = randomUUID();
    const response = await f.post(path, { ...extra, reason: ` ${reason} `, requestId });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.requestId, requestId);
    assert.equal(f.rpcs.at(-1)!.name, rpc);
    assert.equal(f.rpcs.at(-1)!.args.p_reason, reason);
    assert.equal(f.rpcs.at(-1)!.args.p_request, requestId);
    assert.equal(f.rpcs.at(-1)!.args.p_actor, actorId);
  }
  const retentionRequestId = randomUUID();
  const retentionBody = { reason, requestId: retentionRequestId, fingerprint: 'a'.repeat(64), confirmation: 'APPLY RETENTION' };
  const callsBeforeInvalid = f.rpcs.length;
  assert.equal((await f.post('retention/apply', { ...retentionBody, requestId: '' })).status, 400);
  assert.equal(f.rpcs.length, callsBeforeInvalid);
  const retention = await f.post('retention/apply', retentionBody);
  assert.equal(retention.status, 200);
  assert.equal((await retention.json()).data.requestId, retentionRequestId);
  assert.deepEqual(f.rpcs.at(-1), { name: 'admin_retention_apply', args: { p_actor: actorId, p_fingerprint: 'a'.repeat(64), p_reason: reason, p_confirmation: 'APPLY RETENTION', p_request: retentionRequestId } });
  for (const code of ['PLAN_NOT_FOUND', 'CONFIGURATION_NOT_FOUND', 'UNSUPPORTED_ADMIN_ACTION', 'INVALID_RANGE']) {
    f.state.guardCode = code;
    await assert.rejects(operationRpc('fixture_guard', {}), (error: ApiError) => error.code === code && error.status !== 503);
  }
  f.state.guardCode = 'ADMIN_REQUEST_CONFLICT';
  const conflict = await f.post('retention/apply', retentionBody);
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, 'ADMIN_REQUEST_CONFLICT');
}));

test('wake logs before network, is replay-safe, fails closed and never infers a healthy worker', async context => fixture(context, async f => {
  const reason = 'Investigate queued audits', requestId = randomUUID();
  const denied = await fetch(`${f.base}/admin/workers/wake`, { method: 'POST' });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('cache-control'), 'private, no-store');
  assert.equal(f.requests.length, 0);
  assert.equal((await f.post('workers/wake', { reason, requestId: '' })).status, 400);
  assert.equal(f.events.length, 0);
  process.env.PRODUCTION_WORKER_HEALTH_URL = 'https://evil.example/health';
  assert.equal((await f.post('workers/wake', { reason, requestId })).status, 503);
  assert.equal(f.events.length, 0);
  process.env.PRODUCTION_WORKER_HEALTH_URL = healthUrl;
  f.state.failInsert = true;
  assert.equal((await f.post('workers/wake', { reason, requestId })).status, 503);
  assert.deepEqual(f.events, ['insert']);
  f.state.failInsert = false;
  f.events.length = 0;
  const response = await f.post('workers/wake', { reason: ` ${reason} `, requestId });
  assert.equal(response.status, 200);
  const result = (await response.json()).data;
  assert.deepEqual(result, { requested: true, outcome: 'health_request_responded', state: 'verification_pending', requestId });
  assert.deepEqual(f.events, ['insert', 'health', 'update']);
  assert.equal(f.actions.get(requestId)!.metadata.reason, reason);
  const replay = await f.post('workers/wake', { reason, requestId });
  assert.deepEqual((await replay.json()).data, result);
  assert.equal(f.events.filter(event => event === 'health').length, 1);
  assert.equal((await f.post('workers/wake', { reason: 'Different purpose', requestId })).status, 409);
  const collision = randomUUID();
  f.actions.set(collision, { admin_user_id: randomUUID(), action: 'worker_wake_requested', target_type: 'worker', target_id: 'audit-engine', metadata: { reason } });
  assert.equal((await f.post('workers/wake', { reason, requestId: collision })).status, 409);
  for (const [status, throws, outcome] of [[503, false, 'health_request_failed'], [200, true, 'request_timed_out']] as const) {
    f.state.healthStatus = status; f.state.healthThrows = throws;
    const response = await f.post('workers/wake', { reason });
    assert.equal(response.status, 200);
    const data = (await response.json()).data;
    assert.equal(data.outcome, outcome);
    assert.equal(data.state, 'unknown');
    assert.ok(f.actions.has(data.requestId));
  }
  f.state.healthThrows = false; f.state.failUpdate = true;
  const pendingId = randomUUID();
  assert.equal((await f.post('workers/wake', { reason, requestId: pendingId })).status, 503);
  assert.equal(f.actions.get(pendingId)!.metadata.outcome, 'health_request_pending');
  const healthCount = f.events.filter(event => event === 'health').length;
  const pending = await f.post('workers/wake', { reason, requestId: pendingId });
  assert.equal((await pending.json()).data.state, 'unknown');
  assert.equal(f.events.filter(event => event === 'health').length, healthCount);
}));

test('both action lists and CSV retain request correlation and bounded safe projections', async context => fixture(context, async f => {
  const requestId = randomUUID();
  for (let index = 0; index < 101; index++) {
    f.actions.set(index === 0 ? requestId : randomUUID(), { id: randomUUID(), request_id: index === 0 ? requestId : null,
      admin_user_id: actorId, action: 'worker_wake_requested', target_type: 'worker', target_id: 'audit-engine', created_at: new Date().toISOString(),
      metadata: { reason: '=review', outcome: 'health_request_responded', before: { token: 'private', plan: 'paid' } } });
  }
  const headers = { authorization: 'Bearer admin' };
  const beforeDenied = f.requests.length;
  assert.equal((await fetch(`${f.base}/admin/actions`)).status, 403);
  assert.equal(f.requests.length, beforeDenied);
  const list = await fetch(`${f.base}/admin/actions`, { headers });
  assert.equal(list.headers.get('cache-control'), 'private, no-store');
  const page = (await list.json()).data;
  assert.equal(page.rows.length, 50);
  assert.equal(page.hasMore, true);
  assert.equal(page.rows[0].requestId, requestId);
  assert.deepEqual(page.rows[0].before, { plan: 'paid' });
  assert.equal(f.requests.at(-1)!.searchParams.get('limit'), '51');
  const maximum = await fetch(`${f.base}/admin/actions?limit=1000`, { headers });
  assert.equal((await maximum.json()).data.rows.length, 100);
  const csv = await (await fetch(`${f.base}/admin/actions/export`, { headers })).text();
  assert.match(csv, /^actor,action,target_type,target_id,request_id,reason,outcome,created_at\r\n/);
  assert.ok(csv.includes(`"${requestId}"`));
  assert.ok(csv.includes('"\'=review"'));
  const read = await fetch(`${f.base}/read/actions?limit=1000`, { headers });
  assert.equal((await read.json()).data[0].request_id, requestId);
  assert.equal(f.requests.at(-1)!.searchParams.get('limit'), '50');
  assert.equal(safeAdminAction({ metadata: {} }).requestId, undefined);
}));
