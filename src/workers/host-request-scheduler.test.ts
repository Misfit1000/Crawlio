import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HostRequestScheduler } from './host-request-scheduler';

test('a synchronous operation failure releases capacity for queued requests', async () => {
  const scheduler = new HostRequestScheduler(1, 0);
  const failure = new Error('synchronous transport failure');
  const first = scheduler.schedule('https://example.com/first', () => { throw failure; });
  const second = scheduler.schedule('https://example.com/second', async () => 'second');
  await assert.rejects(first, error => error === failure);
  assert.equal(await second, 'second');
  assert.equal(await scheduler.schedule('https://example.com/third', async () => 'third'), 'third');
});

test('asynchronous failures preserve the per-host concurrency bound', async () => {
  const scheduler = new HostRequestScheduler(1, 0);
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const started: string[] = [];
  const first = scheduler.schedule('https://example.com/first', async () => {
    started.push('first');
    await blocked;
    throw new Error('asynchronous transport failure');
  });
  const rejected = assert.rejects(first, /asynchronous transport failure/);
  const second = scheduler.schedule('https://example.com/second', async () => { started.push('second'); return 2; });
  assert.equal(await scheduler.schedule('https://other.example/page', async () => 3), 3);
  assert.deepEqual(started, ['first']);
  release();
  await rejected;
  assert.equal(await second, 2);
  assert.deepEqual(started, ['first', 'second']);
});

test('queued requests retain the minimum start interval after a failure', async context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000 });
  const scheduler = new HostRequestScheduler(2, 150);
  const started: number[] = [];
  const first = scheduler.schedule('https://example.com/first', () => {
    started.push(Date.now());
    throw new Error('failed request');
  });
  const second = scheduler.schedule('https://example.com/second', async () => { started.push(Date.now()); return 2; });
  await assert.rejects(first, /failed request/);
  context.mock.timers.tick(149);
  await Promise.resolve();
  assert.deepEqual(started, [1_000]);
  context.mock.timers.tick(1);
  assert.equal(await second, 2);
  assert.deepEqual(started, [1_000, 1_150]);
});
