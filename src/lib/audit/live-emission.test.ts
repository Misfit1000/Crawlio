import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLiveEmissionScheduler } from './live-emission';
test('bursts render once per frame; hidden work pauses and terminal state flushes immediately',()=>{
  let hidden=false, emits=0, next=0;
  const frames=new Map<number,()=>void>();
  const scheduler=createLiveEmissionScheduler({emit:()=>{emits++;},hidden:()=>hidden,
    requestFrame:callback=>{frames.set(++next,callback);return next;},cancelFrame:id=>{frames.delete(id);}});
  scheduler.request();scheduler.request();scheduler.request();
  assert.equal(frames.size,1); assert.equal(emits,0);
  for(const callback of frames.values()) callback(); frames.clear();
  assert.equal(emits,1);
  hidden=true;scheduler.request();assert.equal(frames.size,0);
  scheduler.request(true);assert.equal(emits,2);
  hidden=false;scheduler.request();scheduler.dispose();
  assert.equal(frames.size,0);scheduler.request(true);assert.equal(emits,2);
});
