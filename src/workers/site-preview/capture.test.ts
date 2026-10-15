import assert from 'node:assert/strict';
import test from 'node:test';
import { capturePair } from './capture';
import { PreviewApi, SubrequestBudget } from './io';
import { authorized, SitePreviewCoordinator } from './coordinator';
import { Fixture, JOB, ManualClock, MemoryState, deferred, flush, jsonResponse } from './test-fixtures';

const capture = (fixture: Fixture, clock?: ManualClock) => capturePair(JOB,
  new PreviewApi(fixture.env, fixture.fetch, new SubrequestBudget()), fixture.runtime(clock));

test('desktop and mobile are separate isolated captures, with no native target requests', async () => {
  const f = new Fixture();
  const outcome = await capture(f);
  assert.equal(outcome.result.status, 'captured');
  assert.equal(outcome.closureConfirmed, true);
  assert.equal(f.launches, 1);
  assert.equal(f.closes, 1);
  assert.equal(f.nativeRequests + f.directRouteCalls, 0);
  assert.deepEqual(f.contexts.map(c => c.options.viewport), [{ width: 1440, height: 900 }, { width: 390, height: 844 }]);
  assert.deepEqual(f.contexts.map(c => [c.options.isMobile, c.options.hasTouch]), [[false, false], [true, true]]);
  for (const c of f.contexts) {
    assert.equal(c.options.serviceWorkers, 'block');
    assert.equal(c.options.acceptDownloads, false);
    assert.deepEqual(c.options.storageState, { cookies: [], origins: [] });
  }
  const proxy = f.calls.filter(c => c.url.hostname === 'control.example.com');
  assert.ok(proxy.length);
  assert.deepEqual(new Set(proxy.flatMap(c => c.body.requests.map((r: any) => r.viewport))), new Set(['desktop', 'mobile']));
  assert.doesNotMatch(JSON.stringify(proxy.map(c => c.body)), /audit-session|audit-credential/);
  assert.equal(f.calls.filter(c => c.url.pathname.includes('/storage/v1/object/')).length, 2);
});

test('unsafe subresources and absent browser guards fail closed before artifact upload', async () => {
  for (const setup of [(f: Fixture) => { f.extraRequests = [{ url: 'http://127.0.0.1/private', type: 'image' }]; },
    (f: Fixture) => { f.missingWebSocketGuard = true; }]) {
    const f = new Fixture(); setup(f);
    const outcome = await capture(f);
    assert.notEqual(outcome.result.status, 'captured');
    assert.equal(f.nativeRequests + f.directRouteCalls, 0);
    assert.equal(f.calls.filter(c => c.url.pathname.includes('/storage/v1/object/')).length, 0);
    assert.equal(f.closes, 1);
  }
});

test('redirect destinations pass through the protected proxy again', async () => {
  const f = new Fixture();
  f.proxy = async body => jsonResponse({ results: body.requests.map((r: any) => ({ url: r.url,
    status: r.url === JOB.target_url ? 302 : 200,
    headers: r.url === JOB.target_url ? { location: 'https://final.example.com/' } : { 'content-type': 'text/html' },
    bodyBase64: r.url === JOB.target_url ? '' : btoa('<html>final</html>') })) });
  const outcome = await capture(f);
  assert.equal(outcome.result.status, 'captured');
  assert.equal(outcome.result.finalUrl, 'https://final.example.com/');
  assert.ok(f.calls.some(c => c.body?.requests?.some((r: any) => r.url === 'https://final.example.com/')));
});

test('deadline closes the browser and never uploads a partial pair', async () => {
  const f = new Fixture(), clock = new ManualClock();
  f.gotoGate = deferred<void>().promise;
  const pending = capture(f, clock);
  await flush(); await clock.advance(18000);
  const outcome = await pending;
  assert.equal(outcome.result.failureCode, 'CAPTURE_DEADLINE');
  assert.equal(outcome.closureConfirmed, true);
  assert.equal(f.closes, 1);
  assert.equal(f.calls.filter(c => c.url.pathname.includes('/storage/v1/object/')).length, 0);
});

test('unconfirmed browser closure blocks subsequent captures', async () => {
  const f = new Fixture(), clock = new ManualClock(), state = new MemoryState();
  f.closeGate = deferred<void>().promise;
  const coordinator = new SitePreviewCoordinator(state, f.env, f.runtime(clock));
  const pending = coordinator.alarm();
  for (let i = 0; i < 8; i++) await clock.advance(10);
  await clock.advance(20000);
  await pending;
  assert.equal(state.data.get('browserSafetyBlocked'), true);
  await coordinator.alarm();
  assert.equal(f.launches, 1);
});

test('wake authorization and completion recovery do not expose or delete committed images', async () => {
  const f = new Fixture(), state = new MemoryState();
  assert.equal(await authorized(new Request('https://worker/control/wake'), f.env.PREVIEW_CONTROL_SECRET), false);
  const coordinator = new SitePreviewCoordinator(state, f.env, f.runtime());
  assert.equal((await coordinator.fetch(new Request('https://worker/control/wake', { method: 'POST' }))).status, 401);
  f.job = null; f.complete = false;
  const desktop = `${JOB.id}/${JOB.generation}/desktop.webp`, mobile = `${JOB.id}/${JOB.generation}/mobile.webp`;
  f.current = [{ desktop_path: desktop, mobile_path: mobile }];
  state.data.set('completion', { job: JOB, result: { status: 'captured', desktopPath: desktop, mobilePath: mobile,
    desktopBytes: 30, mobileBytes: 30, durationMs: 200 }, cleanupPaths: [] });
  await coordinator.alarm();
  assert.equal(state.data.has('completion'), false);
  assert.equal(f.calls.filter(c => c.init.method === 'DELETE').length, 0);
});

test('restart cleans incomplete uploads without deleting committed artifacts or launching an unconfirmed browser', async () => {
  for (const committed of [false, true]) {
    const f = new Fixture(), state = new MemoryState();
    f.job = null;
    const desktop = `${JOB.id}/${JOB.generation}/desktop.webp`, mobile = `${JOB.id}/${JOB.generation}/mobile.webp`;
    state.data.set('uploadIntent', { job: JOB, closureConfirmed: committed });
    f.current = committed ? [{ desktop_path: desktop, mobile_path: mobile }] : [];
    await new SitePreviewCoordinator(state, f.env, f.runtime()).alarm();
    assert.equal(state.data.has('uploadIntent'), false);
    assert.equal(f.calls.filter(c => c.init.method === 'DELETE').length, committed ? 0 : 1);
    assert.equal(Boolean(state.data.get('browserSafetyBlocked')), !committed);
    assert.equal(f.launches, 0);
  }
});
