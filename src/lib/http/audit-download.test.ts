import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAuditExportDownloader } from './download';
test('concurrent exports prepare/download once and stay isolated by account',async()=>{
  let token='first',requests=0,saves=0;
  const phases:string[]=[];
  const download=createAuditExportDownloader({headers:async()=>({Authorization:token}),isActive:()=>true,
    save:()=>{saves++;},request:async()=>{requests++;await new Promise(setImmediate);return new Response('complete',{headers:{'content-disposition':'attachment; filename="fixture.json"'}});}});
  await Promise.all([download('fixture','json',{onState:s=>phases.push(s.phase)}),download('fixture','json')]);
  assert.equal(requests,1);assert.equal(saves,1);assert.ok(phases.includes('ready'));
  token='second';await download('fixture','json');assert.equal(requests,2);assert.equal(saves,2);
});
test('queued exports use status and prepared download, not another preparation',async()=>{
  const urls:string[]=[],states:string[]=[];
  const download=createAuditExportDownloader({headers:async()=>({}),isActive:()=>true,sleep:async()=>{},save:()=>{},
    request:async url=>{urls.push(url);return urls.length===1 ? new Response('{"success":true,"data":{"state":"queued"}}',{status:202,headers:{'content-type':'application/json'}}) : new Response('ready');}});
  await download('fixture','json',{onState:s=>states.push(s.phase)});
  assert.equal(urls.length,3);
  assert.match(urls[1],/export-status/);assert.match(urls[2],/prepared=1/);
  assert.ok(states.includes('queued'));assert.equal(states.at(-1),'ready');
});
