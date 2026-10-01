import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { classifyOperationalFailure, csvCell, presentAdminOperations, redactAdminValues } from './admin-presentation';
import { validatePlatformControls } from './admin-config';

test('health states use recorded evidence, not an inferred sleeping state', () => {
  const now = Date.now();
  const expected = { commitIdentifier: 'abcdef12345', apiSchemaVersion: 15, auditEngineVersion: '2026.09', scoringVersion: '2.2' };
  const raw = { database: { api_schema_version: 15 }, workerDeployment: { api_schema_version: 15 },
    queue: { queued: 0, running: 0, oldestQueuedSeconds: null, staleLeases: 0 }, metrics: {},
    workers: [{ id: 'worker', value: { status: 'idle', databaseConnected: true, lastSeenAt: new Date(now).toISOString(), version: 'abcdef12345', auditEngineVersion: '2026.09', scoringVersion: '2.2' } }] };
  assert.equal(presentAdminOperations(raw, expected, now).status, 'healthy');
  assert.equal(presentAdminOperations({ ...raw, workers: [] }, expected, now).status, 'unknown');
  assert.equal(presentAdminOperations({ ...raw, queue: { ...raw.queue, oldestQueuedSeconds: 400 } }, expected, now).status, 'degraded');
  assert.equal(presentAdminOperations({ ...raw, queue: { ...raw.queue, oldestQueuedSeconds: 901 } }, expected, now).status, 'critical');
  assert.equal(presentAdminOperations(raw, { ...expected, scoringVersion: '9' }, now).status, 'critical');
  const stale = { ...raw, workers: [{ ...raw.workers[0], value: { ...raw.workers[0].value, lastSeenAt: new Date(now - 120000).toISOString() } }] };
  assert.equal(presentAdminOperations(stale, expected, now).workers[0].state, 'degraded');
  assert.equal(presentAdminOperations({ ...raw, workers: [{ ...raw.workers[0], value: { ...raw.workers[0].value, status: 'stopped' } }] }, expected, now).workers[0].state, 'offline');
  assert.equal(classifyOperationalFailure('TARGET_403'), 'target-site');
  assert.equal(classifyOperationalFailure('WORKER_CRASH'), 'system');
  assert.equal(classifyOperationalFailure('SSRF_REJECTED'), 'security-policy');
  assert.equal(csvCell(' \t=SUM(A1)'), '"\' \t=SUM(A1)"');
  assert.deepEqual(redactAdminValues({ token: 'hidden', ip_hash: 'hidden', plan: 'paid' }), { plan: 'paid' });
  assert.throws(() => validatePlatformControls({ hardQueueLimit: -1 }));
  assert.throws(() => validatePlatformControls({ dispatchSecret: 'hidden' }));
});

test('migration 028 validates actions, real leases, retries, atomic logs and retention', async () => {
  const db = new PGlite();
  const migration = (name: string) => readFile(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8');
  const rpc = async <T = any>(name: string, args: unknown[]): Promise<T> => (await db.query<{ result: T }>(`select ${name}(${args.map((_, i) => `$${i+1}`).join(',')}) as result`, args)).rows[0].result;
  const admin = randomUUID(), otherAdmin = randomUUID(), user = randomUUID();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean);`);
    const baseline = await migration('001_resource_light_audit.sql');
    await db.exec(baseline.slice(baseline.indexOf('create or replace function'), baseline.indexOf('alter publication')));
    await db.exec(baseline.slice(baseline.indexOf('create table if not exists public.user_profiles')));
    const plans = await migration('003_plans_admin_limits.sql');
    await db.exec(plans.slice(plans.indexOf('create or replace function')));
    for (const name of ['009_audit_page_preview_metadata.sql','010_audit_resilience_and_failures.sql','011_production_robustness.sql','022_last_active_administrator.sql','025_scalable_audits.sql','026_scalable_frontier_hash.sql','027_audit_presentation.sql']) await db.exec(await migration(name));
    await db.exec(`create table audit_finding_workflow(id uuid primary key,audit_id uuid references audits on delete cascade);
      create table report_shares(id uuid primary key,audit_id uuid references audits on delete cascade);
      create function public.admin_retention_apply(uuid,text,text,text) returns jsonb language sql as $$ select '{"legacy":true}'::jsonb $$;`);
    await db.exec(await migration('028_admin_operations.sql'));
    await db.exec(await migration('028_admin_operations.sql'));
    assert.equal((await db.query<any>(`select to_regprocedure('public.admin_retention_apply(uuid,text,text,text)') old_signature,
      count(*)::int signatures from pg_proc where pronamespace='public'::regnamespace and proname='admin_retention_apply'`)).rows[0].signatures,1);
    assert.equal((await db.query<any>(`select to_regprocedure('public.admin_retention_apply(uuid,text,text,text)') signature`)).rows[0].signature,null);
    await db.query('insert into auth.users values($1),($2),($3)', [admin,user,otherAdmin]);
    await db.query(`insert into user_profiles(id,email,role,plan) values($1,'admin@example.test','admin','admin'),($2,'user@example.test','user','paid'),($3,'other-admin@example.test','admin','admin')`,[admin,user,otherAdmin]);
    await assert.rejects(rpc('admin_operations_snapshot',[user,7]), /ADMIN_REQUIRED/);
    await assert.rejects(rpc('admin_update_account',[admin,admin,JSON.stringify({ disabled: true }),'Support review',randomUUID()]), /SELF_ROLE_CHANGE_FORBIDDEN/);
    await assert.rejects(rpc('admin_update_account',[admin,user,JSON.stringify({ role: 'owner' }),'Support review',randomUUID()]), /INVALID_ADMIN_UPDATE/);
    const request = randomUUID();
    const accountResult = await rpc('admin_update_account',[admin,user,JSON.stringify({ plan: 'agency' }),'Plan correction',request]);
    assert.deepEqual(await rpc('admin_update_account',[admin,user,JSON.stringify({ plan: 'agency' }),'Plan correction',request]),accountResult);
    for (const [actor,target,patch] of [[otherAdmin,user,{ plan: 'agency' }],[admin,otherAdmin,{ plan: 'agency' }],[admin,user,{ plan: 'paid' }]] as const) {
      await assert.rejects(rpc('admin_update_account',[actor,target,JSON.stringify(patch),'Plan correction',request]),/ADMIN_REQUEST_CONFLICT/);
    }
    assert.equal((await db.query<any>('select plan from user_profiles where id=$1',[user])).rows[0].plan,'agency');
    assert.equal((await db.query<any>('select count(*)::int n from admin_actions where request_id=$1',[request])).rows[0].n,1);
    await rpc('admin_update_account',[admin,user,JSON.stringify({ plan: 'paid' }),'Plan correction',randomUUID()]);
    const configurationRequest = randomUUID(), configurationPatch = JSON.stringify({ max_pages_standard: 100, priority: 10 });
    const configurationResult = await rpc('admin_update_configuration',[admin,'plan','paid',configurationPatch,'Raise standard allowance',configurationRequest]);
    assert.deepEqual(await rpc('admin_update_configuration',[admin,'plan','paid',JSON.stringify({ priority: 10, max_pages_standard: 100 }),'Raise standard allowance',configurationRequest]),configurationResult);
    for (const [actor,kind,key,patch] of [[otherAdmin,'plan','paid',configurationPatch],[admin,'platform','paid',configurationPatch],
      [admin,'plan','free',configurationPatch],[admin,'plan','paid',JSON.stringify({ max_pages_standard: 101 })]] as const) {
      await assert.rejects(rpc('admin_update_configuration',[actor,kind,key,patch,'Configuration review',configurationRequest]),/ADMIN_REQUEST_CONFLICT/);
    }
    await assert.rejects(rpc('admin_update_configuration',[admin,'plan','paid',configurationPatch,'Configuration review',request]),/ADMIN_REQUEST_CONFLICT/);
    assert.equal((await db.query<any>(`select max_pages_standard from plan_limits where plan='paid'`)).rows[0].max_pages_standard,100);
    await assert.rejects(rpc('admin_update_configuration',[admin,'plan','paid',JSON.stringify({ max_pages_standard: 501 }),'Invalid allowance',randomUUID()]),/INVALID_ADMIN_UPDATE/);
    const id = randomUUID();
    await db.query(`insert into audits(id,user_id,submitted_input,normalized_url,hostname,plan,requested_mode,effective_mode,processing_version) values($1,$2,'https://test.example/','https://test.example/','test.example','paid','standard','standard',2)`,[id,user]);
    const claim = await rpc('claim_scalable_audit',['fixture-worker',true]);
    await assert.rejects(rpc('admin_audit_operation',[admin,id,'requeue','Inspect expired lease',randomUUID(),'normal']), /AUDIT_NOT_STALE/);
    await db.query(`update audit_crawl_runs set lease_until=now()-interval '1 second' where audit_id=$1`,[id]);
    await rpc('admin_audit_operation',[admin,id,'requeue','Inspect expired lease',randomUUID(),'normal']);
    assert.equal((await db.query<any>(`select state,generation from audit_crawl_runs where audit_id=$1`,[id])).rows[0].state,'waiting');
    await assert.rejects(rpc('scalable_audit_commit',[id,'fixture-worker',claim.run.generation,'{}']), /AUDIT_OWNERSHIP_LOST/);
    const cancelRequest = randomUUID();
    const cancelResult = await rpc('admin_audit_operation',[admin,id,'cancel','Customer requested cancellation',cancelRequest,'normal']);
    assert.deepEqual(await rpc('admin_audit_operation',[admin,id,'cancel','Customer requested cancellation',cancelRequest,'normal']),cancelResult);
    for (const [actor,target,action] of [[otherAdmin,id,'cancel'],[admin,randomUUID(),'cancel'],[admin,id,'retry']] as const) {
      await assert.rejects(rpc('admin_audit_operation',[actor,target,action,'Customer requested cancellation',cancelRequest,'normal']),/ADMIN_REQUEST_CONFLICT/);
    }
    await assert.rejects(rpc('admin_audit_operation',[admin,id,'cancel','Customer requested cancellation',request,'normal']),/ADMIN_REQUEST_CONFLICT/);
    await assert.rejects(rpc('admin_update_account',[admin,user,JSON.stringify({ plan: 'paid' }),'Plan correction',cancelRequest]),/ADMIN_REQUEST_CONFLICT/);
    await assert.rejects(rpc('admin_audit_operation',[admin,id,'cancel','Customer requested cancellation',randomUUID(),'normal']), /AUDIT_NOT_CANCELLABLE/);
    await db.query(`update audits set status='failed',completed_at=now() where id=$1`,[id]);
    await db.exec(`insert into audit_scalable_workers(worker_id,commit_id,deep_enabled) values('fixture-worker','fixture',true)`);
    const retry = await rpc('admin_audit_operation',[admin,id,'retry','Controlled retry',randomUUID(),'normal']);
    assert.notEqual(retry.auditId,id);
    assert.equal((await db.query<any>('select status from audits where id=$1',[id])).rows[0].status,'failed');
    assert.equal((await db.query<any>('select retry_of_audit_id,page_limit from audits where id=$1',[retry.auditId])).rows[0].page_limit,100);
    const snapshot = await rpc('admin_operations_snapshot',[admin,7]);
    assert.equal(snapshot.queue.queued,1);
    assert.ok(snapshot.recentActions.some((action: any) => action.request_id===cancelRequest));
    const priorityRequest = randomUUID();
    const priorityResult = await rpc('admin_audit_operation',[admin,retry.auditId,'priority','Test temporary priority',priorityRequest,'urgent']);
    assert.deepEqual(await rpc('admin_audit_operation',[admin,retry.auditId,'priority','Test temporary priority',priorityRequest,'urgent']),priorityResult);
    await assert.rejects(rpc('admin_audit_operation',[admin,retry.auditId,'priority','Test temporary priority',priorityRequest,'normal']),/ADMIN_REQUEST_CONFLICT/);
    assert.equal((await db.query<any>('select admin_priority_boost from audits where id=$1',[retry.auditId])).rows[0].admin_priority_boost,20);
    const guest = randomUUID();
    await db.query(`insert into audits(id,submitted_input,normalized_url,hostname,status,created_at) values($1,'https://old.example','https://old.example','old.example','failed',now()-interval '20 days')`,[guest]);
    const preview = await rpc('admin_retention_preview',[admin]);
    assert.equal(preview.audits,1);
    await assert.rejects(rpc('admin_retention_apply',[user,preview.fingerprint,'Cleanup approved','APPLY RETENTION']),/ADMIN_REQUIRED/);
    await assert.rejects(rpc('admin_retention_apply',[admin,preview.fingerprint,'Cleanup approved','DELETE']),/CONFIRMATION_REQUIRED/);
    const legacyRetention = await rpc('admin_retention_apply',[admin,preview.fingerprint,'Cleanup approved','APPLY RETENTION']);
    assert.equal(legacyRetention.auditsDeleted,1);
    assert.match(legacyRetention.requestId,/^[0-9a-f-]{36}$/);
    assert.equal((await db.query<any>('select target_id from admin_actions where request_id=$1',[legacyRetention.requestId])).rows[0].target_id,preview.fingerprint);
    await assert.rejects(rpc('admin_retention_apply',[admin,preview.fingerprint,'Cleanup approved','APPLY RETENTION']),/PREVIEW_EXPIRED/);
    const nextGuest = randomUUID();
    await db.query(`insert into audits(id,submitted_input,normalized_url,hostname,status,created_at) values($1,'https://old2.example','https://old2.example','old2.example','failed',now()-interval '20 days')`,[nextGuest]);
    const nextPreview = await rpc('admin_retention_preview',[admin]), retentionRequest = randomUUID();
    await assert.rejects(rpc('admin_retention_apply',[admin,nextPreview.fingerprint,'Cleanup approved','APPLY RETENTION',null]),/ADMIN_REASON_REQUIRED/);
    await assert.rejects(rpc('admin_retention_apply',[admin,nextPreview.fingerprint,'Cleanup approved','APPLY RETENTION',request]),/ADMIN_REQUEST_CONFLICT/);
    const retentionResult = await rpc('admin_retention_apply',[admin,nextPreview.fingerprint,'Cleanup approved','APPLY RETENTION',retentionRequest]);
    assert.equal(retentionResult.auditsDeleted,1);
    assert.equal(retentionResult.requestId,retentionRequest);
    await db.query(`update admin_retention_previews set expires_at=now()-interval '1 second' where fingerprint=$1`,[nextPreview.fingerprint]);
    assert.deepEqual(await rpc('admin_retention_apply',[admin,nextPreview.fingerprint,'Cleanup approved','APPLY RETENTION',retentionRequest]),retentionResult);
    await assert.rejects(rpc('admin_retention_apply',[otherAdmin,nextPreview.fingerprint,'Cleanup approved','APPLY RETENTION',retentionRequest]),/ADMIN_REQUEST_CONFLICT/);
    const differentPreview = await rpc('admin_retention_preview',[admin]);
    await assert.rejects(rpc('admin_retention_apply',[admin,differentPreview.fingerprint,'Cleanup approved','APPLY RETENTION',retentionRequest]),/ADMIN_REQUEST_CONFLICT/);
    assert.equal((await db.query<any>('select applied_at from admin_retention_previews where fingerprint=$1',[differentPreview.fingerprint])).rows[0].applied_at,null);
    await assert.rejects(rpc('admin_update_account',[admin,user,JSON.stringify({ plan: 'paid' }),'Plan correction',retentionRequest]),/ADMIN_REQUEST_CONFLICT/);
    await assert.rejects(rpc('admin_update_configuration',[admin,'plan','paid',configurationPatch,'Configuration review',retentionRequest]),/ADMIN_REQUEST_CONFLICT/);
    await assert.rejects(rpc('admin_audit_operation',[admin,retry.auditId,'cancel','Customer requested cancellation',retentionRequest,'normal']),/ADMIN_REQUEST_CONFLICT/);
    assert.equal((await db.query<any>('select count(*)::int n from admin_actions where request_id=$1',[retentionRequest])).rows[0].n,1);
    const retentionSnapshot = await rpc('admin_operations_snapshot',[admin,7]);
    assert.ok(retentionSnapshot.recentActions.some((action: any) => action.request_id===retentionRequest));
    const inventory = await rpc('admin_resource_inventory',[admin]);
    assert.ok(inventory.relations.every((row: any) => row.bytes >= 0));
    await db.exec('set role anon');
    await assert.rejects(rpc('admin_operations_snapshot',[admin,7]),/permission denied/);
    await assert.rejects(rpc('admin_retention_apply',[admin,differentPreview.fingerprint,'Cleanup approved','APPLY RETENTION']),/permission denied/);
  } finally { await db.close(); }
});
