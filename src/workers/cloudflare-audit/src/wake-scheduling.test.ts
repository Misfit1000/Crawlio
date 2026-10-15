import assert from 'node:assert/strict';
import test from 'node:test';
import { expediteIdleAlarm } from './wake-scheduling';

test('a wake expedites an idle alarm without overlapping an active slice or postponing an earlier alarm', async () => {
  for (const [alarm,running,expected] of [[31000,false,1010],[null,false,1010],[1005,false,null],[31000,true,null]] as const) {
    let written:number|null=null, reads=0;
    await expediteIdleAlarm({getAlarm:async()=>{reads++;return alarm;},setAlarm:async at=>{written=at;}},running,()=>1000);
    assert.equal(written,expected);assert.equal(reads,running?0:1);
  }
});
