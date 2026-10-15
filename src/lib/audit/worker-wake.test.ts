import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedWorkerControlUrl, compatibleSecondaryCapability, createInterruptibleIdleWait, validControlBearer, wakeConfiguredWorkers } from './worker-wake';

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

test('secondary wake requires the exact engine, scope and scoring contract', () => {
  const capability={service:'crawlio-secondary-audit',executorType:'cloudflare',status:'configured',queueConsumer:true,apiSchemaVersion:16,processingVersion:2,auditScopeVersion:1,auditEngineVersion:'2026.09',scoringVersion:'2.2',checkRegistryVersion:'3.1'};
  assert.equal(compatibleSecondaryCapability(capability),true);
  for(const patch of [{queueConsumer:false},{auditScopeVersion:0},{scoringVersion:'other'},{apiSchemaVersion:15},{executorType:'preview'}]) assert.equal(compatibleSecondaryCapability({...capability,...patch}),false);
});

test('Render failure does not suppress compatible secondary wake, and incompatible executors receive no secret', async context => {
  const keys=['AUDIT_WORKER_WAKE_URL','AUDIT_WORKER_CONTROL_SECRET','SECONDARY_AUDIT_WORKER_URL','SECONDARY_AUDIT_CONTROL_SECRET'] as const;
  const original=keys.map(key=>[key,process.env[key]] as const);
  context.after(()=>{for(const [key,value] of original) {if(value===undefined) delete process.env[key];else process.env[key]=value;}});
  process.env.AUDIT_WORKER_WAKE_URL='https://seointel-audit-worker.onrender.com/control/wake';
  process.env.AUDIT_WORKER_CONTROL_SECRET='r'.repeat(48);
  process.env.SECONDARY_AUDIT_CONTROL_SECRET='s'.repeat(48);
  let time=Date.now()+5000;
  context.mock.method(Date,'now',()=>time);
  for(const compatible of [true,false]) {
    process.env.SECONDARY_AUDIT_WORKER_URL=`https://${compatible?'compatible':'incompatible'}.fixture.workers.dev/control/wake`;
    let render=0, claims=0;
    await wakeConfiguredWorkers(async (input,init)=>{
      const url=new URL(String(input));
      if(url.hostname.endsWith('onrender.com')) {render++;throw new Error('Render sleeping');}
      if(url.pathname==='/capability') {
        assert.equal(new Headers(init?.headers).has('authorization'),false);
        return Response.json({service:'crawlio-secondary-audit',executorType:'cloudflare',status:'configured',queueConsumer:true,apiSchemaVersion:16,processingVersion:2,auditScopeVersion:1,auditEngineVersion:'2026.09',scoringVersion:compatible?'2.2':'wrong',checkRegistryVersion:'3.1'});
      }
      assert.equal(new Headers(init?.headers).get('authorization'),`Bearer ${'s'.repeat(48)}`);
      claims++; return Response.json({scheduled:true});
    });
    assert.equal(render,1);assert.equal(claims,compatible?1:0);
    time+=5000;
  }
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
