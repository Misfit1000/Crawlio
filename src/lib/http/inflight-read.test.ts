import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { clearInflightReads, inflightRead } from './inflight-read';

afterEach(clearInflightReads);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('one consumer can cancel without cancelling a shared read', async () => {
  const result = deferred<number>();
  let calls = 0;
  let underlying!: AbortSignal;
  const read = (signal: AbortSignal) => { calls++; underlying = signal; return result.promise; };
  const first = new AbortController();
  const a = inflightRead('/projects', { Authorization: 'user-a' }, read, first.signal);
  const b = inflightRead('/projects', { Authorization: 'user-a' }, read);
  await Promise.resolve();
  first.abort();
  await assert.rejects(a, { name: 'AbortError' });
  assert.equal(underlying.aborted, false);
  result.resolve(42);
  assert.equal(await b, 42);
  assert.equal(calls, 1);
});

test('last cancellation aborts the work; a later attempt starts fresh', async () => {
  const signal = new AbortController();
  let underlying!: AbortSignal;
  const value = inflightRead('/history', {}, async shared => {
    underlying = shared;
    await new Promise((_, reject) => shared.addEventListener('abort', () => reject(new DOMException('', 'AbortError')), { once: true }));
  }, signal.signal);
  await Promise.resolve();
  signal.abort();
  await assert.rejects(value, { name: 'AbortError' });
  assert.equal(underlying.aborted, true);
  assert.equal(await inflightRead('/history', {}, async () => 3), 3);
});

test('parameters and session headers isolate requests; responses are not cached', async () => {
  let calls = 0;
  const read = async () => ++calls;
  await Promise.all([
    inflightRead('/history?page=1', { Authorization: 'a' }, read),
    inflightRead('/history?page=2', { Authorization: 'a' }, read),
    inflightRead('/history?page=1', { Authorization: 'b' }, read),
  ]);
  assert.equal(calls, 3);
  await inflightRead('/history?page=1', { Authorization: 'a' }, read);
  assert.equal(calls, 4);
});

test('account invalidation rejects old consumers even when their loader ignores abort', async () => {
  const result = deferred<number>();
  const old = inflightRead('/profile', { Authorization: 'old' }, () => result.promise);
  clearInflightReads();
  await assert.rejects(old, { name: 'AbortError' });
  result.resolve(7);
  assert.equal(await inflightRead('/profile', { Authorization: 'new' }, async () => 8), 8);
});
