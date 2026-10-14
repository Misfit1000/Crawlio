import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedWorkerControlUrl, createInterruptibleIdleWait, validControlBearer, wakeConfiguredWorkers } from './worker-wake';

test('wake endpoints fail closed and bearer comparison does not accept prefixes', () => {
  const secret='a'.repeat(48);
  assert.equal(validControlBearer(`Bearer ${secret}`,secret),true);
  assert.equal(validControlBearer(`Bearer ${secret}extra`,secret),false);
  assert.equal(validControlBearer('Bearer short','short'),false);
  assert.equal(allowedWorkerControlUrl('https://seointel-audit-worker.onrender.com/','render'),'https://seointel-audit-worker.onrender.com/control/wake');
  for (const url of ['http://localhost/','https://evil.example/','https://seointel-audit-worker.onrender.com@evil.example/','https://seointel-audit-worker.onrender.com/?target=private']) assert.equal(allowedWorkerControlUrl(url,'render'),null);
});
test('idle wake interrupts the sleep but never starts another claim loop', async () => {
  const idle=createInterruptibleIdleWait();
  const started=Date.now(); const sleeping=idle.wait(4000); idle.wake(); await sleeping;
  assert.ok(Date.now()-started<500);
  idle.wake(); await idle.wait(4000);
});
test('failed wake is bounded and does not fail a committed audit', async () => {
  const previous={url:process.env.AUDIT_WORKER_WAKE_URL,secret:process.env.AUDIT_WORKER_CONTROL_SECRET};
  process.env.AUDIT_WORKER_WAKE_URL='https://seointel-audit-worker.onrender.com/';
  process.env.AUDIT_WORKER_CONTROL_SECRET='s'.repeat(48);
  let calls=0;
  try {
    await wakeConfiguredWorkers(async () => {calls++; throw new Error('offline');});
    assert.equal(calls,1);
  } finally {
    if(previous.url===undefined) delete process.env.AUDIT_WORKER_WAKE_URL; else process.env.AUDIT_WORKER_WAKE_URL=previous.url;
    if(previous.secret===undefined) delete process.env.AUDIT_WORKER_CONTROL_SECRET; else process.env.AUDIT_WORKER_CONTROL_SECRET=previous.secret;
  }
});
