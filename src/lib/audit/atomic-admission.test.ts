import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

test('migration 037 commits admission once, preserves scope/quotas, and fences preview budgets', async () => {
  const db = new PGlite();
  const migration = (name: string) => readFile(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8');
  try {
    const base = await migration('001_resource_light_audit.sql');
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean);`);
    await db.exec(base.slice(base.indexOf('create or replace function'),base.indexOf('alter publication')));
    await db.exec(`alter table audits add column deleted_at timestamptz, add column requested_mode text,
      add column effective_mode text,add column plan text,add column processing_tier text,add column plan_page_limit int,
      add column queue_priority int,add column processing_version int,add column audit_scope jsonb,
      add column scope_fingerprint text,add column quota_counted boolean,add column estimated_wait_seconds int;
      create table user_profiles(id uuid primary key,plan text,disabled boolean default false,audit_quota_used_daily int default 0,
        audit_quota_used_monthly int default 0,quota_reset_daily_at timestamptz,quota_reset_monthly_at timestamptz,updated_at timestamptz);
      create table plan_limits(plan text primary key,allowed_modes jsonb,max_pages_quick int,max_pages_standard int,max_pages_deep int,
        daily_audits int,monthly_audits int,concurrency int,priority int);
      insert into plan_limits values('free','["quick"]',10,0,0,3,30,1,10),('paid','["quick","standard"]',25,500,0,25,500,2,50);
      create table audit_scalable_workers(worker_id text primary key,processing_version int,scope_version int,scope_commit_id text,commit_id text,deep_enabled boolean,seen_at timestamptz);
      insert into audit_scalable_workers values('render',2,1,'commit','commit',true,now());
      create table deployment_versions(component text primary key,api_schema_version int,audit_engine_version text,scoring_version text,check_registry_version text,commit_identifier text,updated_at timestamptz);
      insert into deployment_versions(component,api_schema_version,audit_engine_version,scoring_version,check_registry_version)
        values('database',14,null,null,null),('worker',16,'2026.09','2.2','3.1');
      create table audit_crawl_frontier(audit_id uuid);
      create function claim_scoped_audit(text,boolean) returns jsonb language sql as $$ select null::jsonb $$;
      create table projects(id uuid primary key,user_id uuid,hostname text);
      create table audit_usage_events(user_id uuid,audit_id uuid,plan text,mode text,pages_limit int);
      create table platform_settings(id text,key text,value jsonb,updated_at timestamptz);
      create table audit_admissions(audit_id uuid,user_id uuid,guest_key_hash text,ip_hash text,normalized_domain text,normalized_url text,
        audit_mode text,scope_fingerprint text,decision text,decision_code text,created_at timestamptz default now());
      create function release_audit_admission(p_audit_id uuid,p_reason text) returns void language sql as $$
        update audit_admissions set decision='released' where audit_id=p_audit_id $$;`);
    const scoped = await migration('034_focused_audits.sql');
    await db.exec(scoped.slice(scoped.indexOf('create or replace function public.admit_scoped_audit_submission('),scoped.indexOf('-- Preserve the old URL')));
    await db.exec(await migration('037_audit_preview_and_admission.sql'));
    assert.equal((await db.query<any>("select api_schema_version from deployment_versions where component='database'")).rows[0].api_schema_version,16);
    const user = randomUUID(), other = randomUUID();
    await db.query(`insert into user_profiles(id,plan) values($1,'paid'),($2,'free')`,[user,other]);
    const scope = { version: 1, focus: 'security', coverage: 'page', checkGroups: ['security'] };
    const submit = async (url = 'https://example.com/', owner: string | null = user, override: any = scope, project: string | null = null, sleeping = false) => {
      const result = await db.query<{result:any}>(`select submit_audit_job($1,$2,$3,case when $2::uuid is null then 'guest-network' else 'network' end,$4,$4,'example.com','quick',$5,$6,false,2,100,50,$7) result`,
        [randomUUID(),owner,owner ? null : 'guest',url,JSON.stringify(override),project,sleeping]);
      return result.rows[0].result;
    };
    const accepted = await submit();
    assert.equal(accepted.allowed,true);
    assert.equal(accepted.audit.page_limit,1);
    assert.equal(accepted.audit.plan_page_limit,25);
    assert.equal(accepted.audit.estimated_wait_seconds,null);
    const duplicate = await submit();
    assert.equal(duplicate.auditId,accepted.auditId);
    assert.equal(duplicate.reusedExistingAudit,true);
    assert.equal((await db.query<any>('select count(*)::int count from audit_usage_events')).rows[0].count,1);
    assert.equal((await db.query<any>('select count(*)::int count from audit_events')).rows[0].count,1);
    assert.equal((await db.query<any>('select audit_quota_used_monthly n from user_profiles where id=$1',[user])).rows[0].n,1);
    await db.query(`update audits set status='completed'`);
    await db.query(`update user_profiles set audit_quota_used_monthly=500,quota_reset_monthly_at=now()+interval '1 day' where id=$1`,[user]);
    assert.equal((await submit('https://example.com/monthly')).code,'MONTHLY_QUOTA_REACHED');
    assert.equal((await db.query<any>(`select count(*)::int count from audits`)).rows[0].count,1);
    await db.query(`update user_profiles set audit_quota_used_monthly=0,disabled=true where id=$1`,[user]);
    assert.equal((await submit()).code,'ACCOUNT_SUSPENDED');
    await db.query(`update user_profiles set disabled=false where id=$1`,[user]);
    assert.equal((await submit('https://example.com/',user,scope,randomUUID())).code,'PROJECT_NOT_FOUND');
    await assert.rejects(submit('https://example.com/',user,{...scope,checkGroups:['security','seo']}),/INVALID_AUDIT_SCOPE/);
    await db.exec(`update audit_scalable_workers set seen_at=now()-interval '5 minutes'`);
    assert.equal((await submit()).code,'COMPATIBLE_WORKER_UNAVAILABLE');
    assert.equal((await submit('https://example.com/sleeping',user,scope,null,true)).allowed,true);
    await db.exec(`update audits set status='completed'; update audit_scalable_workers set seen_at=now()`);
    const guest = await submit('https://example.com/',null);
    assert.equal(guest.allowed,true);
    assert.equal(guest.audit.plan,'free');
    const rpc = async (name: string,args: unknown[]) => (await db.query<any>(`select ${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args)).rows[0].result;
    const queued = await rpc('request_audit_preview',[accepted.auditId]);
    const same = await rpc('request_audit_preview',[guest.auditId]);
    assert.equal(queued.id,same.id,'anonymous public capture is reused, access links stay private');
    const claimed = await rpc('claim_site_preview',['capture-a']);
    assert.equal(claimed.status,'running');
    assert.equal(await rpc('claim_site_preview',['capture-b']),null,'one browser globally');
    assert.equal(await rpc('complete_site_preview',[claimed.id,claimed.generation+1,JSON.stringify({status:'unavailable',durationMs:10})]),false);
    const prefix = `${claimed.id}/${claimed.generation}/`;
    assert.equal(await rpc('complete_site_preview',[claimed.id,claimed.generation,JSON.stringify({status:'captured',durationMs:8000,
      finalUrl:'https://example.com/',desktopPath:prefix+'desktop.webp',mobilePath:prefix+'mobile.webp',desktopBytes:100,mobileBytes:100})]),true);
    const usage=(await db.query<any>('select * from preview_daily_usage')).rows[0];
    assert.equal(usage.reserved_ms,0); assert.equal(usage.consumed_ms,8000);
    assert.equal((await rpc('request_audit_preview',[accepted.auditId])).status,'captured');
    await db.exec(`update site_preview_captures set fresh_until=now()-interval '1 second'; update preview_daily_usage set consumed_ms=480000`);
    await rpc('request_audit_preview',[accepted.auditId]);
    assert.equal(await rpc('claim_site_preview',['capture-a']),null);
    assert.equal((await db.query<any>('select status from site_preview_captures')).rows[0].status,'quota_exhausted');
    await db.exec(`set role anon`);
    await assert.rejects(db.query('select * from site_preview_captures'),/permission denied/);
    await assert.rejects(rpc('request_audit_preview',[accepted.auditId]),/permission denied/);
    await assert.rejects(submit(),/permission denied/);
  } finally { await db.close(); }
});
