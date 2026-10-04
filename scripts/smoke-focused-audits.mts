import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { AUDIT_CHECK_GROUPS, AUDIT_GROUP_DETAILS, auditScopeFingerprint, auditScopesComparable, makeAuditScope, normalizeAuditScope, scopeScoreCategories } from '../src/lib/audit/audit-scope';
import { selectedCheckModules, analyseScalableItem } from '../src/workers/scalable-audit-worker';
import { CHECKS } from '../src/lib/seo/checks/runner';
import { calculateTransparentAuditScore } from '../src/lib/audit/audit-scoring';
import { HostRequestScheduler } from '../src/workers/host-request-scheduler';
import { frontierItem, type CrawlRun } from '../src/lib/supabase/scalable-audit-repository';
import { toAuditDocument } from '../src/lib/supabase/audit-repository';
import { buildPublicAuditExport } from '../src/lib/report/export';

const fixture = (url: string, scope = makeAuditScope('security')) => toAuditDocument({ id: randomUUID(), normalized_url: url, hostname: new URL(url).hostname,
  submitted_input: url, status: 'running', plan: 'free', effective_mode: 'quick', requested_mode: 'quick', processing_tier: 'free',
  processing_version: 2, page_limit: scope.coverage === 'page' ? 1 : 5, plan_page_limit: 5, audit_scope: scope })!;
for (const group of AUDIT_CHECK_GROUPS) {
  assert.equal(makeAuditScope(group).coverage, 'page');
  const modules = selectedCheckModules(fixture('https://example.com',makeAuditScope(group)), '2.2');
  assert.deepEqual(modules.map(check => check.id).sort(), [...AUDIT_GROUP_DETAILS[group].modules].sort());
}
assert.equal(makeAuditScope().coverage,'site');
assert.equal(normalizeAuditScope(undefined,'security')?.focus,'security');
assert.throws(() => normalizeAuditScope({ ...makeAuditScope('custom'), checkGroups: [] }));
assert.throws(() => normalizeAuditScope({ ...makeAuditScope('security'), checkGroups: ['seo'] }));
assert.notEqual(auditScopeFingerprint(makeAuditScope('custom')),auditScopeFingerprint(makeAuditScope()),'full Quick and explicit custom checks have different execution semantics');
assert.equal(auditScopeFingerprint(makeAuditScope('custom','page',['security'])),auditScopeFingerprint(makeAuditScope('security')));
assert.equal(auditScopesComparable(fixture('https://example.com'),fixture('https://example.com',makeAuditScope('security','site'))),false);

const requests: string[] = [];
const server = createServer((req,res) => {
  requests.push(req.url || '/');
  if (req.url === '/robots.txt') { res.setHeader('content-type','text/plain'); res.end('User-agent: *\nAllow: /\nSitemap: /sitemap.xml'); return; }
  if (req.url === '/sitemap.xml') { res.setHeader('content-type','application/xml'); res.end('<urlset><url><loc>https://example.com/</loc></url></urlset>'); return; }
  res.setHeader('content-type','text/html'); res.end('<!doctype html><html><head><title>Fixture page</title></head><body><h1>Fixture</h1><a href="/child">Child</a><input><img src="/picture.png"></body></html>');
});
await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
process.env.SEOINTEL_ALLOW_PRIVATE_TEST_TARGETS='true';
const origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
const run = { metadata: { scoringVersion:'2.2',sitemapInspected:true,robots:{rules:[],sitemaps:[]} } } as unknown as CrawlRun;
const originals = CHECKS.map(check => check.run);
try {
  for (const focus of [...AUDIT_CHECK_GROUPS,'custom'] as const) {
    const scope = focus === 'custom' ? makeAuditScope('custom','page',['seo','performance']) : makeAuditScope(focus);
    const audit = fixture(`${origin}/`,scope);
    const invoked: string[]=[];
    CHECKS.forEach((check,index) => { check.run = (...args) => { invoked.push(check.id); return originals[index](...args); }; });
    const result = await analyseScalableItem(audit,run,frontierItem(audit.normalizedUrl,'page'),new HostRequestScheduler(2,0));
    assert.deepEqual(invoked.sort(),scope.checkGroups.flatMap(group => AUDIT_GROUP_DETAILS[group].modules).sort());
    assert.deepEqual(result.children,[],'page coverage must not enqueue internal links');
    assert.ok(result.page,'the requested page should be analysed');
    const categories = scopeScoreCategories(scope);
    const groups = result.groups as Array<{category:string}>;
    assert.ok(groups.every(group => categories.includes(group.category as any) || group.category === 'mobile' && scope.checkGroups.includes('technical')));
    const score = calculateTransparentAuditScore({issues:[],pages:[],selectedCategories:categories,measuredCategories:result.measuredCategories as any,
      aggregate:{pageCount:1,errorPages:0,redirectPages:0,slowPages:1,largePages:1,groups:[]},scoringVersion:'2.2'});
    assert.ok(score.measuredChecks.every(category => categories.includes(category as any)));
    assert.ok(score.deductions.every(deduction => categories.includes(deduction.category)));
    if (focus === 'security') {
      assert.equal(score.categories.onPage.score,null);
      const exported = buildPublicAuditExport({audit,latestPages:[(await import('../src/lib/supabase/audit-repository')).toAuditPage(result.page)!],latestIssues:[],latestEvents:[],finalReport:null})!;
      assert.equal('title' in exported.pages[0],false);
      assert.equal('responseTimeMs' in exported.pages[0],false);
      assert.deepEqual(Object.keys(exported.pages[0].toolEvidence as object).sort(),['securityHeaders','version']);
    }
  }
  const site = fixture(`${origin}/`,makeAuditScope('seo','site'));
  const result = await analyseScalableItem(site,run,frontierItem(site.normalizedUrl,'page'),new HostRequestScheduler(2,0));
  assert.equal((result.children as any[]).length,1,'site coverage retains discovery');
  assert.equal(requests.filter(url => url !== '/').length,0,'page checking must not request unrelated providers or documents');
} finally {
  CHECKS.forEach((check,index) => {check.run=originals[index];});
  delete process.env.SEOINTEL_ALLOW_PRIVATE_TEST_TARGETS;
  await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
}
console.log('PASS focus validation, exact runner dispatch, page/site discovery, selected deductions and export isolation');

const db = new PGlite();
const migration = (name:string) => readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');
try {
  await db.exec('create role anon; create role authenticated; create role service_role; create schema storage; create table storage.buckets(id text primary key,name text,public boolean);');
  const baseline = await migration('001_resource_light_audit.sql');
  await db.exec(baseline.slice(baseline.indexOf('create or replace function'),baseline.indexOf('alter publication')));
  await db.exec(await migration('009_audit_page_preview_metadata.sql'));
  await db.exec(await migration('010_audit_resilience_and_failures.sql'));
  await db.exec(`alter table audits drop constraint audits_status_check;
    alter table audits add column plan text default 'free',add column effective_mode text default 'quick',add column queue_priority int default 10,
      add column started_at timestamptz,add column worker_runtime text,add column admin_priority_boost int default 0,add column admin_priority_expires_at timestamptz;
    create table plan_limits(plan text primary key,allowed_modes jsonb,max_pages_quick int,max_pages_standard int,max_pages_deep int);
    create table platform_settings(id text,key text,value jsonb,updated_at timestamptz);
    create table audit_admissions(audit_id uuid,user_id uuid,guest_key_hash text,ip_hash text,normalized_domain text,normalized_url text,audit_mode text,decision text,decision_code text,created_at timestamptz default now());`);
  for (const file of ['025_scalable_audits.sql','026_scalable_frontier_hash.sql','027_audit_presentation.sql','033_performance_optimization.sql']) await db.exec(await migration(file));
  await db.exec('create table user_profiles(id uuid,plan text,disabled boolean); create table admin_actions(request_id uuid,admin_user_id uuid,action text,target_type text,target_id text,metadata jsonb);');
  const operations=await migration('028_admin_operations.sql');
  const retry=operations.slice(operations.indexOf('create or replace function public.admin_audit_operation('),operations.indexOf('create or replace function',operations.indexOf('create or replace function public.admin_audit_operation(')+1));
  await db.exec(retry);
  await db.exec(await migration('034_focused_audits.sql'));
  await db.exec(await migration('034_focused_audits.sql'));
  const retryBody=await db.query<{body:string}>("select prosrc body from pg_proc where proname='admin_audit_operation'");
  assert.match(retryBody.rows[0].body,/plan_page_limit/);
  assert.match(retryBody.rows[0].body,/scope_version=1/);
  for (const value of [{},{version:1}, {...makeAuditScope('security'),checkGroups:null}, {...makeAuditScope('custom'),checkGroups:['seo','seo']}]) {
    const valid = await db.query<{valid:boolean}>('select valid_audit_scope($1) valid',[JSON.stringify(value)]);
    assert.equal(valid.rows[0].valid,false);
  }
  for (const focus of ['full',...AUDIT_CHECK_GROUPS,'custom'] as const) {
    const scope=makeAuditScope(focus);
    const result=await db.query<{fingerprint:string}>('select audit_scope_fingerprint($1) fingerprint',[JSON.stringify(scope)]);
    assert.equal(result.rows[0].fingerprint,auditScopeFingerprint(scope));
  }
  const id=randomUUID(); const scope=makeAuditScope('crawlability');
  await db.query(`insert into audits(id,submitted_input,normalized_url,hostname,page_limit,plan_page_limit,processing_version,audit_scope)
    values($1,'https://example.com/','https://example.com/','example.com',1,5,2,$2)`,[id,JSON.stringify(scope)]);
  await assert.rejects(db.query('update audits set audit_scope=null where id=$1',[id]),/AUDIT_SCOPE_IMMUTABLE/);
  const legacy=await db.query<{result:any}>('select claim_scalable_audit($1,true) result',['old-worker']);
  assert.equal(legacy.rows[0].result,null,'legacy workers must never claim a scoped audit');
  await assert.rejects(db.query('select claim_scoped_audit($1,true)',['old-worker']),/SCOPED_WORKER_UNAVAILABLE/);
  await db.exec(`insert into audit_scalable_workers(worker_id,commit_id,scope_commit_id,scope_version,deep_enabled) values('new-worker','new','new',1,true)`);
  const claimed=await db.query<{result:any}>('select claim_scoped_audit($1,true) result',['new-worker']);
  assert.equal(claimed.rows[0].result.audit.id,id);
  await db.query(`insert into audit_crawl_frontier(audit_id,key,url,kind,depth) values($1,'sitemap','https://example.com/sitemap.xml','sitemap',0)`,[id]);
  const frontier=await db.query<{result:any[]}>('select read_scoped_audit_frontier($1,2) result',[id]);
  assert.equal(frontier.rows[0].result[0].kind,'sitemap');
  await db.query('update audit_scalable_workers set commit_id=$1 where worker_id=$2',['old','new-worker']);
  await assert.rejects(db.query('select claim_scoped_audit($1,true)',['new-worker']),/SCOPED_WORKER_UNAVAILABLE/);
  const args=[randomUUID(),null,'guest','ip','fixture.example','https://fixture.example/','quick','free',10,10,1,10,true,auditScopeFingerprint(makeAuditScope('security'))];
  const admit = (values:unknown[]) => db.query<{result:any}>(`select admit_scoped_audit_submission(${values.map((_,i)=>`$${i+1}`).join(',')}) result`,values);
  const admitted=await admit(args); assert.equal(admitted.rows[0].result.allowed,true);
  const duplicate=await admit([randomUUID(),...args.slice(1)]); assert.equal(duplicate.rows[0].result.auditId,args[0]);
  const conflict=await admit([randomUUID(),...args.slice(1,-1),auditScopeFingerprint(makeAuditScope('seo'))]);
  assert.equal(conflict.rows[0].result.allowed,false); assert.equal(conflict.rows[0].result.code,'ACTIVE_AUDIT_EXISTS');
  await db.exec('set role anon');
  await assert.rejects(db.query('select claim_scoped_audit($1,true)',['new-worker']),/permission denied/);
  await assert.rejects(db.query('select read_scoped_audit_frontier($1,2)',[id]),/permission denied/);
  console.log('PASS migration 034 validation, repeat application, immutable snapshots, worker fencing, document ordering, scoped deduplication and privileges');
} finally { await db.close(); }
