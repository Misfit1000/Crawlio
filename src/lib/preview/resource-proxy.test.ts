import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { previewResponse, proxyPreviewResources } from './resource-proxy';
import { previewTargetAllowed } from './server';
import type { SafePublicResponse } from '../security/safe-public-fetch';

const id='12345678-1234-1234-1234-123456789abc';
const fixture=(patch: Partial<SafePublicResponse>={}): SafePublicResponse => ({ requestedUrl:'https://example.com/',finalUrl:'https://example.com/',
  status:200,headers:{'set-cookie':'secret=never-forward','authorization':'do-not-forward'},contentType:'text/html',body:'<h1>Real page</h1>',bodyBytes:18,redirectCount:0,durationMs:1,...patch });
test('preview proxy strips credentials and preserves safe redirects and bounded compressed data',()=>{
  const response=previewResponse(fixture(),'https://example.com/');
  assert.deepEqual(Object.keys(response.headers).sort(),['cache-control','content-type']);
  assert.equal(Buffer.from(response.bodyBase64,'base64').toString(),'<h1>Real page</h1>');
  assert.equal(previewResponse(fixture({finalUrl:'https://example.com/landing'}),'https://example.com/').headers.location,'https://example.com/landing');
  assert.equal(Buffer.from(previewResponse(fixture({bodyBuffer:gzipSync('actual'),headers:{'content-encoding':'gzip'}}),'https://example.com/').bodyBase64,'base64').toString(),'actual');
  assert.throws(()=>previewResponse(fixture({bodyBuffer:gzipSync('a'.repeat(600000)),headers:{'content-encoding':'gzip'}}),'https://example.com/'));
});
test('sensitive URLs and credentials cannot create screenshots',()=>{
  assert.equal(previewTargetAllowed('https://example.com/landing'),true);
  for(const value of ['https://example.com/?access_token=private','https://user:secret@example.com/','file:///secret']) assert.equal(previewTargetAllowed(value),false);
});
test('unauthorized or stale capture cannot use protected fetch transport',async()=>{
  const old=process.env.PREVIEW_CONTROL_SECRET; process.env.PREVIEW_CONTROL_SECRET='s'.repeat(48);
  let calls=0; const fetcher=async()=>{calls++;return fixture();};
  const body={captureId:id,generation:1,requests:[{url:'https://example.com/main.css',resourceType:'stylesheet'}]};
  try {
    await assert.rejects(proxyPreviewResources('Bearer wrong',body,fetcher,async()=>({id,target_url:'https://example.com/'})),/Not authorized/);
    await assert.rejects(proxyPreviewResources(`Bearer ${'s'.repeat(48)}`,body,fetcher,async()=>null),/no longer active/);
    assert.equal(calls,0);
    const result=await proxyPreviewResources(`Bearer ${'s'.repeat(48)}`,body,fetcher,async()=>({id,target_url:'https://example.com/'}));
    assert.equal(result.results.length,1); assert.equal(calls,1);
    const privateResult=await proxyPreviewResources(`Bearer ${'s'.repeat(48)}`,{...body,requests:[{url:'http://127.0.0.1/private',resourceType:'fetch'}]},undefined,async()=>({id,target_url:'https://example.com/'}));
    assert.equal(privateResult.results[0].error,'PRIVATE_NETWORK_TARGET');
  } finally {if(old===undefined)delete process.env.PREVIEW_CONTROL_SECRET;else process.env.PREVIEW_CONTROL_SECRET=old;}
});
