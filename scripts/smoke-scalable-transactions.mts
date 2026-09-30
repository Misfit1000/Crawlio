import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const migration = (name: string) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema storage; create table storage.buckets(id text primary key,name text,public boolean);
`);
const baseline = await migration('001_resource_light_audit.sql');
await db.exec(baseline.slice(baseline.indexOf('create or replace function'), baseline.indexOf('alter publication')));
await db.exec(await migration('009_audit_page_preview_metadata.sql'));
await db.exec(await migration('010_audit_resilience_and_failures.sql'));
await db.exec(`
  alter table audits drop constraint audits_status_check;
  alter table audits add column plan text default 'paid', add column effective_mode text default 'standard',
    add column queue_priority integer default 50, add column started_at timestamptz,
    add column worker_runtime text;
  create table plan_limits(plan text primary key,allowed_modes jsonb,max_pages_quick int,max_pages_standard int,max_pages_deep int);
  insert into plan_limits values ('admin','["quick","standard","deep"]',1000,1000,1000),('paid','["quick","standard"]',25,50,0);
`);
await db.exec(await migration('025_scalable_audits.sql'));
await db.exec(await migration('026_scalable_frontier_hash.sql'));
const rpc = async (name: string, args: unknown[]) => {
  const result = await db.query<{ result: any }>(`select ${name}(${args.map((_, i) => `$${i+1}`).join(',')}) as result`, args);
  return result.rows[0].result;
};
const key = (url: string) => createHash('sha256').update(`page:${url}`).digest('hex');

try {
  for (const limit of [500,1000,5000]) {
    const id = randomUUID();
    const root = `https://fixture-${limit}.example/`;
    await db.query(`insert into audits(id,submitted_input,normalized_url,hostname,plan,page_limit,processing_version)
      values($1,$2,$2,$3,$4,$5,2)`, [id,root,`fixture-${limit}.example`,limit>500?'admin':'paid',limit]);
    const seeded = await db.query<{key:string}>(`select key from audit_crawl_frontier where audit_id=$1`,[id]);
    assert.equal(seeded.rows[0].key,key(root),'database frontier hash must match the worker without pgcrypto');
    let claim = await rpc('claim_scalable_audit',['worker-a',true]);
    assert.equal(claim.audit.id,id);
    const commit = (payload: unknown, generation = claim.run.generation) => rpc('scalable_audit_commit',[id,'worker-a',generation,JSON.stringify(payload)]);
    for (let offset=0;offset<limit;offset+=100) {
      await commit({items:[{key:key(root),discoveryOnly:true,children:Array.from({length:Math.min(100,limit-offset)},(_,i)=>{
        const url=offset+i===0?root:`${root}${offset+i}`;
        return {key:key(url),url,kind:'page',depth:1};
      })}]});
    }
    for (let i=0;i<limit;i++) {
      const url=i===0?root:`${root}${i}`;
      const payload={items:[{key:key(url),page:{id:`${id}-${i}`,audit_id:id,url,status_code:200,response_time_ms:10,
        page_size_bytes:100,title:'Fixture',meta_description:'Fixture',h1:'Fixture',word_count:100,crawl_depth:1,
        issue_count:1,crawled_at:new Date().toISOString(),fetch_status:'success',canonical_url:'',site_name:'',favicon_url:'',
        open_graph_image:'',theme_color:'',screenshot_url:'',retryable:false,attempt_count:1,recovered_after_retry:false},
        issues:[{id:`${id}-issue-${i}`,audit_id:id,severity:'low',category:'seo',title:'Fixture finding',description:'Evidence',
          affected_url:url,evidence:'Measured',recommendation:'Fix',detected_at:new Date().toISOString(),source_urls:[],affected_page_count:1}],
        groups:[{key:'seo|fixture',category:'seo',title:'Fixture finding',severity:'low',rank:2}],checks:10,children:[]}]};
      const result=await commit(payload);
      assert.equal(result.analysed,i+1);
      if (i===0) assert.equal((await commit(payload)).analysed,1,'duplicate commit must be idempotent');
      if (i===25) {
        const oldGeneration=claim.run.generation;
        await db.query(`update audit_crawl_runs set lease_until=now()-interval '1 second' where audit_id=$1`,[id]);
        claim=await rpc('claim_scalable_audit',['worker-a',true]);
        await assert.rejects(commit(payload,oldGeneration),/AUDIT_OWNERSHIP_LOST/);
      }
      if ((i+1)%50===0 && i+1<limit) {
        assert.equal(await rpc('scalable_audit_finish_slice',[id,'worker-a',claim.run.generation,null,null]),true);
        claim=await rpc('claim_scalable_audit',['worker-a',true]);
      }
    }
    const counts=await db.query<any>(`select (select count(*) from audit_pages where audit_id=$1)::int pages,
      (select count(*) from audit_issues where audit_id=$1)::int issues,
      (select affected_pages from audit_score_groups where audit_id=$1) affected`,[id]);
    assert.deepEqual(counts.rows[0],{pages:limit,issues:limit,affected:limit});
    assert.deepEqual(await rpc('scalable_comparison_counts',[id,id]),{new:0,resolved:0,persistent:limit});
    if (limit === 5000) {
      assert.equal(await rpc('scalable_audit_finish_slice',[id,'worker-a',claim.run.generation,
        JSON.stringify({scores:{overall:80},summary:'Complete',top_issues:[],pages:[],exports:{}}),'page_limit_reached']),true);
      const terminal = await db.query<{status:string}>(`select status from audits where id=$1`,[id]);
      assert.equal(terminal.rows[0].status,'completed');
      await assert.rejects(commit({}),/AUDIT_OWNERSHIP_LOST/);
    }
    await db.query(`update audits set status='cancelled' where id=$1`,[id]);
    await assert.rejects(commit({}),/AUDIT_OWNERSHIP_LOST/);
    console.log(`${limit} pages: atomic evidence, resume, idempotency, fencing and cancellation passed`);
  }
  await db.exec('set role anon');
  await assert.rejects(db.query('select * from audit_crawl_runs'),/permission denied/);
  await assert.rejects(rpc('claim_scalable_audit',['untrusted',true]),/permission denied/);
  console.log('Migration 025 execution and privilege checks passed');
} finally {
  await db.close();
}
